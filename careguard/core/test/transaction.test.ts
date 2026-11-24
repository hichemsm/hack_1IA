import { readFileSync } from "node:fs";
import type { Hex } from "viem";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { CONTRACT_ERRORS, TransactionAgent } from "../src/agents/transaction";
import { Category, type PaymentOrder } from "../src/types";
import { FakeVault } from "./fakes";

const order: PaymentOrder = {
  invoiceHash: `0x${"11".repeat(32)}`,
  providerId: `0x${"22".repeat(32)}`,
  category: Category.MEDECIN,
  amount: 30_000_000n, // 30 € en tUSD8 (6 décimales)
  breakdown: { secu: 18_000_000n, mutuelle: 10_000_000n, resteACharge: 2_000_000n },
  baremeHash: `0x${"33".repeat(32)}`,
  deadline: 1_800_000_900n,
};
const sig: Hex = `0x${"5a".repeat(65)}`;

let vault: FakeVault;
let agent: TransactionAgent;

beforeEach(() => {
  vault = new FakeVault();
  agent = new TransactionAgent(vault);
});

describe("TransactionAgent — simulation réussie", () => {
  it("exécuté tout de suite → paid avec le txHash", async () => {
    vault.simulateOk(true);
    const r = await agent.execute(order, sig);
    expect(r).toEqual({ status: "paid", txHash: FakeVault.TX_HASH });
    expect(vault.sendPayCount).toBe(1);
    expect(vault.sendCalls[0]).toBe(order);
  });

  it("non exécuté (au-dessus du seuil) → queued avec le pendingId", async () => {
    vault.simulateOk(false, 7n);
    const r = await agent.execute(order, sig);
    expect(r).toEqual({ status: "queued", txHash: FakeVault.TX_HASH, pendingId: 7n });
    expect(vault.sendPayCount).toBe(1);
  });
});

describe("TransactionAgent — simulation refusée", () => {
  it.each(Object.entries(CONTRACT_ERRORS))("%s → reverted avec le message traduit", async (errorName, message) => {
    vault.simulateRevert(errorName);
    const r = await agent.execute(order, sig);
    expect(r).toEqual({ status: "reverted", errorName, reason: message });
    expect(vault.sendPayCount).toBe(0);
  });

  it("erreur inconnue → message générique qui cite le nom de l'erreur", async () => {
    vault.simulateRevert("Foo");
    const r = await agent.execute(order, sig);
    expect(r.status).toBe("reverted");
    if (r.status !== "reverted") return;
    expect(r.errorName).toBe("Foo");
    expect(r.reason).toContain("Foo");
    expect(vault.sendPayCount).toBe(0);
  });

  it("sendPay n'est JAMAIS appelé quand la simulation échoue", async () => {
    for (const name of [...Object.keys(CONTRACT_ERRORS), "Foo", "Inconnu"]) {
      vault.simulateRevert(name);
      await agent.execute(order, sig);
    }
    expect(vault.simulateCalls.length).toBe(Object.keys(CONTRACT_ERRORS).length + 2);
    expect(vault.sendPayCount).toBe(0);
  });
});

describe("CONTRACT_ERRORS couvre CareVault.sol", () => {
  // Erreurs qui ne peuvent pas survenir lors d'un agentPay : réservées à l'aidante ou au constructeur
  const HORS_AGENT = new Set(["NotGuardian", "ZeroAddress", "NotPending"]);

  it("chaque erreur déclarée dans le contrat a sa traduction", () => {
    const sol = readFileSync(
      fileURLToPath(new URL("../../bridge/contracts/src/CareVault.sol", import.meta.url)),
      "utf8",
    );
    const declared = [...sol.matchAll(/^\s*error\s+(\w+)\s*\(/gm)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(0);
    const missing = declared.filter((n) => !HORS_AGENT.has(n) && !(n in CONTRACT_ERRORS));
    expect(missing).toEqual([]);
  });
});
