import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AmountsAgent } from "../src/agents/amounts";
import { buildOrder, Orchestrator } from "../src/agents/orchestrator";
import { SecurityAgent } from "../src/agents/security";
import { TransactionAgent } from "../src/agents/transaction";
import { InvoiceSchema } from "../src/invoice";
import { computeBreakdown } from "../src/rac/engine";
import { Category, type BeneficiaryProfile, type InvoiceInput, type PaymentOrder } from "../src/types";
import {
  FakeRegistry, FakeSigner, FakeVault, HOUR, InMemoryHistory, NOT_PENDING, NOW, OfflineLlm,
} from "./fakes";

const facture = (nom: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(`../../demo/factures/${nom}.json`, import.meta.url), "utf8"));
const json = (data: unknown): InvoiceInput => ({ kind: "json", data });

const KINE = facture("kine");
const PIEGEE = facture("piegee");
/** Kiné facturé 25 € pour un tarif de 16,13 € : MONTANT_ANORMAL (30 points) → escalade */
const KINE_ESCALADE = { ...KINE, invoiceNo: "K-2026-0413", montantCents: 2500 };

const profile: BeneficiaryProfile = { ald: false, medecinTraitant: true, mutuelleBrssPct: 100, exonereRetenues: false };

let registry: FakeRegistry;
let vault: FakeVault;
let signer: FakeSigner;
let amounts: AmountsAgent;
let orchestrator: Orchestrator;

beforeEach(() => {
  // buildOrder calcule la deadline avec Date.now() : on aligne l'horloge sur celle du coffre
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW * 1000);

  // Même configuration que bridge/contracts/script/Deploy.s.sol
  registry = new FakeRegistry()
    .addProvider("medecin-martin", { category: Category.MEDECIN })
    .addProvider("kine-dupont", { category: Category.PARAMEDICAL })
    .setThresholdCents(5_000);
  vault = new FakeVault(registry)
    .setRuleCents(Category.MEDECIN, 6_000, 12_000)
    .setRuleCents(Category.PARAMEDICAL, 4_000, 8_000);
  signer = new FakeSigner();

  const llm = new OfflineLlm();
  const history = new InMemoryHistory();
  amounts = new AmountsAgent();
  orchestrator = new Orchestrator({
    llm,
    amounts,
    security: new SecurityAgent({ registry, signer, llm, history }),
    transaction: new TransactionAgent(vault),
    history,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Orchestrateur + 4 agents — parcours normaux", () => {
  it("kine.json → payé, Sécu 868 / mutuelle 645 / reste 100", async () => {
    const r = await orchestrator.process(json(KINE), { profile });
    expect(r.tx).toEqual({ status: "paid", txHash: FakeVault.TX_HASH });
    expect(r.breakdown).toMatchObject({ secuCents: 868, mutuelleCents: 645, resteAChargeCents: 100 });
    expect(r.risk.decision).toBe("pay");
    expect(vault.sendPayCount).toBe(1);
    expect(vault.executed).toEqual([r.order]);
  });

  it("la même facture deux fois → la 2e est bloquée par l'agent sécurité (DOUBLON), jamais envoyée", async () => {
    await orchestrator.process(json(KINE), { profile });
    const r = await orchestrator.process(json(KINE), { profile });
    expect(r.risk.decision).toBe("block");
    expect(r.risk.reasons.map((x) => x.code)).toContain("DOUBLON");
    expect(r.tx.status).toBe("not_sent");
    expect(vault.sendPayCount).toBe(1);
    expect(vault.simulateCalls.length).toBe(1);
    expect(signer.callCount).toBe(1);
  });

  it("piegee.json → not_sent, décision block, aucun appel à sendPay", async () => {
    const r = await orchestrator.process(json(PIEGEE), { profile });
    expect(r.risk.decision).toBe("block");
    expect(r.risk.reasons.map((x) => x.code)).toEqual(expect.arrayContaining(["SOIGNANT_INCONNU", "TEXTE_SUSPECT"]));
    expect(r.tx.status).toBe("not_sent");
    expect(signer.callCount).toBe(0);
    expect(vault.simulateCalls.length).toBe(0);
    expect(vault.sendPayCount).toBe(0);
  });

  it("facture au-dessus du seuil → queued avec un pendingId", async () => {
    registry.setThresholdCents(1_000); // 10 € : la séance à 16,13 € passe au-dessus
    const r = await orchestrator.process(json(KINE), { profile });
    expect(r.risk.reasons.map((x) => x.code)).toContain("SEUIL");
    expect(r.tx).toEqual({ status: "queued", txHash: FakeVault.TX_HASH, pendingId: 0n });
    expect(vault.pending).toEqual([r.order]);
    expect(vault.executed).toEqual([]);
  });

  it("facture escaladée : 1er passage not_sent, 2e avec guardianConfirmed → paid", async () => {
    const r1 = await orchestrator.process(json(KINE_ESCALADE), { profile });
    expect(r1.risk.decision).toBe("escalate");
    expect(r1.risk.reasons.map((x) => x.code)).toContain("MONTANT_ANORMAL");
    expect(r1.tx).toEqual({ status: "not_sent", reason: "En attente de votre validation." });
    expect(vault.sendPayCount).toBe(0);

    const r2 = await orchestrator.process(json(KINE_ESCALADE), { profile, guardianConfirmed: true });
    expect(r2.risk.decision).toBe("escalate");
    expect(r2.tx.status).toBe("paid");
    expect(vault.sendPayCount).toBe(1);
  });
});

describe("Orchestrateur — démos d'agents compromis", () => {
  it("démo « orchestrateur » → reverted, signature de l'agent sécurité manquante", async () => {
    const r = await orchestrator.process(json(KINE), { profile, demo: "orchestrateur" });
    expect(r.tx.status).toBe("reverted");
    if (r.tx.status !== "reverted") return;
    expect(r.tx.errorName).toBe("ECDSAInvalidSignatureLength");
    expect(r.tx.reason.toLowerCase()).toContain("signature de l'agent sécurité manquante");
    expect(signer.callCount).toBe(0);
    expect(vault.sendPayCount).toBe(0);
  });

  it("démo « orchestrateur+securite » avec piegee.json → reverted, Soignant inconnu", async () => {
    const r = await orchestrator.process(json(PIEGEE), { profile, demo: "orchestrateur+securite" });
    expect(signer.callCount).toBe(1); // l'agent sécurité compromis a bien signé
    expect(r.tx.status).toBe("reverted");
    if (r.tx.status !== "reverted") return;
    expect(r.tx.errorName).toBe("UnknownProvider");
    expect(r.tx.reason).toContain("Soignant inconnu");
    expect(vault.sendPayCount).toBe(0);
  });
});

describe("Orchestrateur — effets de bord", () => {
  it("après un paiement, AmountsAgent.snapshot() a fait avancer le compteur des franchises", async () => {
    expect(amounts.snapshot()).toEqual({ participationsCents: 0, franchisesCents: 0 });
    await orchestrator.process(json(KINE), { profile });
    expect(amounts.snapshot()).toEqual({ participationsCents: 0, franchisesCents: 100 });
  });

  it("les compteurs n'avancent pas quand le paiement est bloqué ou mis en attente", async () => {
    await orchestrator.process(json(PIEGEE), { profile });
    registry.setThresholdCents(1_000);
    await orchestrator.process(json(KINE), { profile });
    expect(amounts.snapshot()).toEqual({ participationsCents: 0, franchisesCents: 0 });
  });

  it("la trace suit l'ordre orchestrateur → montants → sécurité → transaction → aidante", async () => {
    const r = await orchestrator.process(json(KINE), { profile });
    expect(r.trace.map((m) => `${m.from}→${m.to}`)).toEqual([
      "orchestrateur→montants",
      "montants→orchestrateur",
      "orchestrateur→securite",
      "securite→orchestrateur",
      "securite→transaction",
      "transaction→orchestrateur",
      "orchestrateur→aidante",
    ]);
    expect(r.trace.at(-1)?.summary).toBe(r.explanation);
  });
});

describe("FakeVault reproduit les vérifications de CareVault.sol", () => {
  const order = (data: Record<string, unknown>): PaymentOrder => {
    const inv = InvoiceSchema.parse(data);
    const b = computeBreakdown({ ...inv, profile, counters: { participationsCents: 0, franchisesCents: 0 } });
    return buildOrder(inv, b, BigInt(NOW));
  };
  const signed = async (o: PaymentOrder) => ({ o, sig: await signer.signApproval(o) });
  const errorOf = async (o: PaymentOrder, sig: `0x${string}`) => {
    const r = await vault.simulatePay(o, sig);
    return r.ok ? "ok" : r.errorName;
  };

  it("ordre signé et valide → exécuté, et la simulation ne modifie pas l'état", async () => {
    const { o, sig } = await signed(order(KINE));
    expect(await vault.simulatePay(o, sig)).toEqual({ ok: true, executed: true, pendingId: NOT_PENDING });
    expect(await vault.simulatePay(o, sig)).toEqual({ ok: true, executed: true, pendingId: NOT_PENDING });
    expect(registry.used.size).toBe(0);
    await vault.sendPay(o, sig);
    expect(registry.used.has(o.invoiceHash)).toBe(true);
    expect(await errorOf(o, sig)).toBe("InvoiceAlreadyUsed");
  });

  it("agents révoqués ou expirés", async () => {
    const { o, sig } = await signed(order(KINE));
    vault.agentsExpiry = NOW - 1;
    expect(await errorOf(o, sig)).toBe("AgentsExpired");
    vault.agentsRevoked = true;
    expect(await errorOf(o, sig)).toBe("AgentsAreRevoked");
  });

  it("deadline dépassée → ApprovalExpired, vérifiée avant la signature", async () => {
    const o = order(KINE);
    registry.now = NOW + 16 * 60;
    expect(await errorOf(o, "0x")).toBe("ApprovalExpired");
  });

  it("signature absente, d'un autre signataire, ou d'un autre ordre", async () => {
    const { o, sig } = await signed(order(KINE));
    expect(await errorOf(o, "0x")).toBe("ECDSAInvalidSignatureLength");
    expect(await errorOf(o, FakeSigner.sign(o, "0x000000000000000000000000000000000000b0b0"))).toBe("BadSecuritySignature");
    expect(await errorOf({ ...o, amount: o.amount * 10n }, sig)).toBe("BadSecuritySignature");
  });

  it("la signature est vérifiée avant le soignant", async () => {
    const o = order(PIEGEE);
    expect(await errorOf(o, "0x")).toBe("ECDSAInvalidSignatureLength");
    expect(await errorOf(o, await signer.signApproval(o))).toBe("UnknownProvider");
  });

  it("soignant pas encore actif, catégorie, montant nul", async () => {
    registry.addProvider("kine-neuf", { category: Category.PARAMEDICAL, activeAt: NOW + 24 * HOUR });
    const neuf = await signed(order({ ...KINE, providerId: "kine-neuf" }));
    expect(await errorOf(neuf.o, neuf.sig)).toBe("ProviderNotYetActive");

    const mauvaiseCategorie = await signed(order({ ...KINE, providerId: "medecin-martin" }));
    expect(await errorOf(mauvaiseCategorie.o, mauvaiseCategorie.sig)).toBe("CategoryMismatch");

    const nul = await signed({ ...order(KINE), amount: 0n });
    expect(await errorOf(nul.o, nul.sig)).toBe("ZeroAmount");
  });

  it("plafond par paiement (40 €) et plafond journalier (80 €) du paramédical", async () => {
    const tropCher = await signed(order({ ...KINE, montantCents: 4_100 }));
    expect(await errorOf(tropCher.o, tropCher.sig)).toBe("AboveTxCap");

    for (const n of [1, 2]) {
      const { o, sig } = await signed(order({ ...KINE, invoiceNo: `K-J-${n}`, montantCents: 3_000 }));
      await vault.sendPay(o, sig);
    }
    const troisieme = await signed(order({ ...KINE, invoiceNo: "K-J-3", montantCents: 3_000 }));
    expect(await errorOf(troisieme.o, troisieme.sig)).toBe("AboveDailyCap");

    registry.now = NOW + 24 * HOUR; // jour suivant : le cumul repart à zéro
    const lendemain = await signed({ ...troisieme.o, deadline: BigInt(registry.now + 900) });
    expect(await errorOf(lendemain.o, lendemain.sig)).toBe("ok");
  });
});
