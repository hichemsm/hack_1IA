import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { buildOrder } from "../src/agents/orchestrator";
import { SecurityAgent } from "../src/agents/security";
import { InvoiceSchema } from "../src/invoice";
import { computeBreakdown } from "../src/rac/engine";
import { Category, type BeneficiaryProfile, type Invoice, type RiskReport } from "../src/types";
import { FakeRegistry, FakeSigner, HOUR, InMemoryHistory, NOW, OfflineLlm } from "./fakes";

const profil: BeneficiaryProfile = { ald: false, medecinTraitant: true, mutuelleBrssPct: 100, exonereRetenues: false };

function facture(over: Partial<Invoice> = {}): Invoice {
  return {
    invoiceNo: "M-0001",
    providerId: "medecin-martin",
    date: "2026-11-20",
    acte: "GENERALISTE_CONSULT",
    montantCents: 3000,
    quantite: 1,
    beneficiaire: "papa",
    ...over,
  };
}

const kine = (over: Partial<Invoice> = {}) =>
  facture({ invoiceNo: "K-0001", providerId: "kine-dupont", acte: "KINE_SEANCE", montantCents: 1613, ...over });

let registry: FakeRegistry;
let signer: FakeSigner;
let history: InMemoryHistory;
let agent: SecurityAgent;

beforeEach(() => {
  registry = new FakeRegistry()
    .addProvider("medecin-martin", { category: Category.MEDECIN, sector: 1 })
    .addProvider("kine-dupont", { category: Category.PARAMEDICAL });
  signer = new FakeSigner();
  history = new InMemoryHistory();
  agent = new SecurityAgent({ registry, signer, llm: new OfflineLlm(), history });
});

/** Analyse une facture comme le ferait l'orchestrateur (entrée JSON brute = la facture elle-même par défaut) */
async function analyse(invoice: Invoice, raw: unknown = invoice) {
  const b = computeBreakdown({
    acte: invoice.acte, montantCents: invoice.montantCents, quantite: invoice.quantite,
    profile: profil, counters: { participationsCents: 0, franchisesCents: 0 },
  });
  const report = await agent.review({ kind: "json", data: raw }, invoice, b);
  return { report, order: buildOrder(invoice, b, BigInt(NOW)) };
}

const codes = (r: RiskReport) => r.reasons.map((x) => x.code);

describe("agent sécurité — règles bloquantes", () => {
  it("soignant inconnu → block, SOIGNANT_INCONNU", async () => {
    const { report } = await analyse(facture({ providerId: "medecin-inconnu" }));
    expect(report.decision).toBe("block");
    expect(report.blocking).toBe(true);
    expect(codes(report)).toContain("SOIGNANT_INCONNU");
  });

  it("soignant ajouté il y a moins de 48 h → block, DELAI_48H", async () => {
    // ajouté il y a 24 h → actif dans 24 h
    registry.addProvider("medecin-neuf", { category: Category.MEDECIN, activeAt: NOW + 24 * HOUR });
    const { report } = await analyse(facture({ providerId: "medecin-neuf" }));
    expect(report.decision).toBe("block");
    expect(codes(report)).toContain("DELAI_48H");
  });

  it("facture déjà payée → block, DOUBLON", async () => {
    const f = facture();
    registry.markPaid(f);
    const { report } = await analyse(f);
    expect(report.decision).toBe("block");
    expect(codes(report)).toContain("DOUBLON");
  });

  it("acte de kiné chez un soignant enregistré comme médecin → block, CATEGORIE", async () => {
    const { report } = await analyse(kine({ providerId: "medecin-martin" }));
    expect(report.decision).toBe("block");
    expect(codes(report)).toContain("CATEGORIE");
  });
});

describe("agent sécurité — règles à points", () => {
  it("généraliste secteur 1 qui facture 50 € → +40, DEPASSEMENT_S1, escalate", async () => {
    const { report } = await analyse(facture({ montantCents: 5000 }));
    expect(report.reasons).toContainEqual(expect.objectContaining({ code: "DEPASSEMENT_S1", points: 40 }));
    expect(report.score).toBe(40);
    expect(report.blocking).toBe(false);
    expect(report.decision).toBe("escalate");
  });

  it("deuxième séance de kiné le même jour → +30, FREQUENCE, escalate", async () => {
    history.record(kine({ invoiceNo: "K-0001" }));
    const { report, order } = await analyse(kine({ invoiceNo: "K-0002" }));
    expect(report.reasons).toContainEqual(expect.objectContaining({ code: "FREQUENCE", points: 30 }));
    expect(report.score).toBe(30);
    expect(report.decision).toBe("escalate"); // 30 ≥ escalateFrom : l'aidante doit valider
    expect(await agent.approve(order, report)).toBeNull();
    expect(signer.callCount).toBe(0);
  });

  it("demo/factures/piegee.json → block, avec TEXTE_SUSPECT parmi les raisons", async () => {
    const raw = JSON.parse(readFileSync(new URL("../../demo/factures/piegee.json", import.meta.url), "utf8"));
    const invoice = InvoiceSchema.parse(raw) as Invoice; // le champ « note » est retiré, mais la sécurité relit le brut
    const { report, order } = await analyse(invoice, raw);
    expect(report.decision).toBe("block");
    expect(codes(report)).toEqual(expect.arrayContaining(["TEXTE_SUSPECT", "SOIGNANT_INCONNU", "MONTANT_ANORMAL"]));
    expect(await agent.approve(order, report, true)).toBeNull();
    expect(signer.callCount).toBe(0);
  });

  it("facture normale au-dessus du seuil → pay avec la raison SEUIL", async () => {
    registry.setThresholdCents(2000); // seuil 20 €, facture 30 €
    const { report } = await analyse(facture());
    expect(report.decision).toBe("pay");
    expect(report.score).toBe(0);
    expect(report.reasons).toContainEqual(expect.objectContaining({ code: "SEUIL", points: 0 }));
  });

  it("facture exactement au seuil → pas de SEUIL (le contrat ne met en attente qu'au-dessus)", async () => {
    registry.setThresholdCents(3000);
    const { report } = await analyse(facture());
    expect(report.decision).toBe("pay");
    expect(codes(report)).not.toContain("SEUIL");
  });
});

describe("agent sécurité — approve()", () => {
  it("block → null, même si l'aidante a confirmé", async () => {
    const { report, order } = await analyse(facture({ providerId: "medecin-inconnu" }));
    expect(await agent.approve(order, report)).toBeNull();
    expect(await agent.approve(order, report, true)).toBeNull();
  });

  it("escalate sans confirmation → null", async () => {
    const { report, order } = await analyse(facture({ montantCents: 5000 }));
    expect(report.decision).toBe("escalate");
    expect(await agent.approve(order, report)).toBeNull();
    expect(signer.callCount).toBe(0);
  });

  it("escalate confirmé par l'aidante → signature", async () => {
    const { report, order } = await analyse(facture({ montantCents: 5000 }));
    expect(await agent.approve(order, report, true)).toBe(FakeSigner.SIGNATURE);
    expect(signer.calls).toEqual([order]);
  });

  it("pay → signature", async () => {
    const { report, order } = await analyse(facture());
    expect(report.decision).toBe("pay");
    expect(await agent.approve(order, report)).toBe(FakeSigner.SIGNATURE);
    expect(signer.calls).toEqual([order]);
  });

  it("le signer n'est JAMAIS appelé quand la décision est block", async () => {
    registry.addProvider("medecin-neuf", { category: Category.MEDECIN, activeAt: NOW + 24 * HOUR });
    const doublon = facture({ invoiceNo: "M-DOUBLON" });
    registry.markPaid(doublon);

    const bloquees = [
      facture({ providerId: "medecin-inconnu" }),
      facture({ providerId: "medecin-neuf" }),
      doublon,
      kine({ providerId: "medecin-martin" }),
    ];
    for (const f of bloquees) {
      const { report, order } = await analyse(f);
      expect(report.decision).toBe("block");
      expect(await agent.approve(order, report, false)).toBeNull();
      expect(await agent.approve(order, report, true)).toBeNull();
    }
    expect(signer.callCount).toBe(0);
  });
});
