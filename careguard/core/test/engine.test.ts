import { describe, expect, it } from "vitest";
import { computeBreakdown } from "../src/rac/engine";
import type { BeneficiaryProfile } from "../src/types";

const profil: BeneficiaryProfile = { ald: false, medecinTraitant: true, mutuelleBrssPct: 100, exonereRetenues: false };
const zero = { participationsCents: 0, franchisesCents: 0 };

describe("moteur de reste à charge (barème 2026-11)", () => {
  it("généraliste 30 € avec médecin traitant : 19 € Sécu, 9 € mutuelle, 2 € de reste à charge", () => {
    const b = computeBreakdown({ acte: "GENERALISTE_CONSULT", montantCents: 3000, quantite: 1, profile: profil, counters: zero });
    expect([b.secuCents, b.mutuelleCents, b.resteAChargeCents]).toEqual([1900, 900, 200]);
  });

  it("séance de kiné 16,13 € : 8,68 € Sécu, 6,45 € mutuelle, 1 € de reste à charge", () => {
    const b = computeBreakdown({ acte: "KINE_SEANCE", montantCents: 1613, quantite: 1, profile: profil, counters: zero });
    expect([b.secuCents, b.mutuelleCents, b.resteAChargeCents]).toEqual([868, 645, 100]);
  });

  it("ALD : Sécu à 100 %, seule la participation forfaitaire reste à charge", () => {
    const b = computeBreakdown({ acte: "GENERALISTE_CONSULT", montantCents: 3000, quantite: 1, profile: { ...profil, ald: true }, counters: zero });
    expect([b.secuCents, b.mutuelleCents, b.resteAChargeCents]).toEqual([2800, 0, 200]);
  });

  it("plafond annuel des participations atteint : plus de retenue", () => {
    const b = computeBreakdown({
      acte: "GENERALISTE_CONSULT", montantCents: 3000, quantite: 1, profile: profil,
      counters: { participationsCents: 7000, franchisesCents: 0 },
    });
    expect(b.retenueCents).toBe(0);
    expect(b.resteAChargeCents).toBe(0);
  });

  it("acte non remboursable : tout reste à charge", () => {
    const b = computeBreakdown({ acte: "NON_REMBOURSABLE", montantCents: 5000, quantite: 1, profile: profil, counters: zero });
    expect(b.remboursable).toBe(false);
    expect(b.resteAChargeCents).toBe(5000);
  });

  it("dépassement d'honoraires : détecté, non couvert par une mutuelle à 100 %", () => {
    const b = computeBreakdown({ acte: "GENERALISTE_CONSULT", montantCents: 5000, quantite: 1, profile: profil, counters: zero });
    expect(b.depassementCents).toBe(2000);
    expect(b.resteAChargeCents).toBe(2200);
  });
});
