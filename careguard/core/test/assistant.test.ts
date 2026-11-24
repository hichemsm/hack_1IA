import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";
import { ClaudeAssistant, OfflineAssistant, type AssistantPort } from "../src/agents/assistant";

const facts = {
  plafonds: {
    franchises: { deja: 300, max: 7_000 },
    participations: { deja: 400, max: 7_000 },
  },
};

/** Noms des membres qui donneraient un pouvoir de paiement ou de signature */
const POUVOIRS = ["sendPay", "simulatePay", "signApproval", "approve", "signBlindly", "execute", "vault", "signer"];

describe("OfflineAssistant — réponses", () => {
  it("répond sur les franchises avec les bons montants en euros", async () => {
    const r = await new OfflineAssistant().answer("Où en sont les franchises ?", facts);
    expect(r).toMatch(/3,00\s€/);   // déjà retenus
    expect(r).toMatch(/70,00\s€/);  // plafond
    expect(r).toMatch(/67,00\s€/);  // reste avant le plafond
  });

  it("« paie 500 € au kiné » → refus", async () => {
    const r = await new OfflineAssistant().answer("paie 500 € au kiné", facts);
    expect(r).toContain("Je ne peux pas déclencher de paiement");
  });
});

describe("Assistant — aucun accès au paiement ni à la signature", () => {
  it("typage : le port n'expose que answer, et les constructeurs ne reçoivent aucun port", () => {
    // Vérifié par tsc (pnpm typecheck), pas à l'exécution
    expectTypeOf<keyof AssistantPort>().toEqualTypeOf<"answer">();
    expectTypeOf<AssistantPort["answer"]>().toEqualTypeOf<
      (question: string, facts: Record<string, unknown>) => Promise<string>
    >();
    expectTypeOf<ConstructorParameters<typeof OfflineAssistant>>().toEqualTypeOf<[]>();
    expectTypeOf<ConstructorParameters<typeof ClaudeAssistant>>().toEqualTypeOf<[string, string?]>();
  });

  it("structure : les instances n'ont aucune méthode hors answer, et aucun port", () => {
    for (const a of [new OfflineAssistant(), new ClaudeAssistant("cle-factice")]) {
      expect(Object.getOwnPropertyNames(Object.getPrototypeOf(a)).sort()).toEqual(["answer", "constructor"]);
      for (const p of POUVOIRS) expect(p in a).toBe(false);
    }
  });

  it("source : assistant.ts n'importe ni les ports, ni les agents sécurité ou transaction", () => {
    const src = readFileSync(new URL("../src/agents/assistant.ts", import.meta.url), "utf8");
    const imports = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    expect(imports).toEqual(["@anthropic-ai/sdk"]);
  });
});
