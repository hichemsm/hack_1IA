import { describe, expect, it } from "vitest";
import { AmountsAgent } from "../src/agents/amounts";
import type { BeneficiaryProfile, Invoice } from "../src/types";

/**
 * Tests de l'agent montants (barème 2026-11).
 * Rappel des règles du moteur :
 *   secuBrut   = round(BRSS × taux)
 *   secu       = secuBrut − retenue   (retenue = participation ou franchise, plafonnée à 70 €/an)
 *   mutuelle   = min(BRSS × garantie − secuBrut, montant − secuBrut), jamais < 0
 *   resteÀCharge = montant − secu − mutuelle
 */

const profil: BeneficiaryProfile = { ald: false, medecinTraitant: true, mutuelleBrssPct: 100, exonereRetenues: false };

function facture(acte: string, montantCents: number, quantite = 1): Invoice {
  return {
    invoiceNo: `T-${acte}-${montantCents}`,
    providerId: "test",
    date: "2026-11-18",
    acte,
    montantCents,
    quantite,
    beneficiaire: "test",
  };
}

const nouvelAgent = (participationsCents = 0, franchisesCents = 0) =>
  new AmountsAgent({ participationsCents, franchisesCents });

describe("agent montants (barème 2026-11)", () => {
  /*
   * Pharmacie SMR majeur, 2 boîtes à 12,40 € → montant 24,80 €, BRSS = prix facturé = 2480 c
   * secuBrut = 2480 × 65 % = 1612 c
   * franchise = 2 boîtes × 1 € = 200 c   → secu = 1612 − 200 = 1412 c
   * mutuelle 100 % : min(2480 − 1612, 2480 − 1612) = 868 c
   * reste à charge = 2480 − 1412 − 868 = 200 c (la franchise)
   */
  it("pharmacie SMR majeur, 2 boîtes à 12,40 € : franchise de 2 €, Sécu à 65 %", () => {
    const b = nouvelAgent().compute(facture("PHARMACIE_SMR_MAJEUR", 2480, 2), profil);
    expect(b.brssCents).toBe(2480);
    expect(b.retenueCents).toBe(200);
    expect([b.secuCents, b.mutuelleCents, b.resteAChargeCents]).toEqual([1412, 868, 200]);
  });

  /*
   * Généraliste 30 €, pas de mutuelle (0 %)
   * secuBrut = 3000 × 70 % = 2100 c, participation 200 c → secu = 1900 c
   * mutuelle : 3000 × 0 % − 2100 = −2100 → 0 c
   * reste à charge = 3000 − 1900 − 0 = 1100 c
   *   = ticket modérateur (3000 − 2100 = 900 c) + participation (200 c)
   */
  it("pas de mutuelle (0 %) : le ticket modérateur reste à charge", () => {
    const b = nouvelAgent().compute(facture("GENERALISTE_CONSULT", 3000), { ...profil, mutuelleBrssPct: 0 });
    expect(b.mutuelleCents).toBe(0);
    expect(b.secuCents).toBe(1900);
    expect(b.resteAChargeCents).toBe(1100);
  });

  /*
   * Généraliste facturé 50 €, BRSS 30 € → dépassement 20 €
   * secuBrut = 2100 c, participation 200 c → secu = 1900 c
   * mutuelle 200 % : min(3000 × 200 % − 2100, 5000 − 2100) = min(3900, 2900) = 2900 c
   *   (ticket modérateur 900 c + dépassement 2000 c, entièrement couverts)
   * reste à charge = 5000 − 1900 − 2900 = 200 c (seule la participation)
   */
  it("mutuelle à 200 % sur un dépassement d'honoraires", () => {
    const b = nouvelAgent().compute(facture("GENERALISTE_CONSULT", 5000), { ...profil, mutuelleBrssPct: 200 });
    expect(b.depassementCents).toBe(2000);
    expect([b.secuCents, b.mutuelleCents, b.resteAChargeCents]).toEqual([1900, 2900, 200]);
  });

  /*
   * Bénéficiaire exonéré (C2S, AME…), mutuelle 100 %
   * Généraliste 30 € : secu = 2100 c (pas de participation), mutuelle = 3000 − 2100 = 900 c, reste 0
   * Pharmacie 2 × 12,40 € : secu = 1612 c (pas de franchise), mutuelle = 868 c, reste 0
   */
  it("bénéficiaire exonéré : aucune retenue", () => {
    const exonere = { ...profil, exonereRetenues: true };
    const agent = nouvelAgent();

    const g = agent.compute(facture("GENERALISTE_CONSULT", 3000), exonere);
    expect(g.retenueCents).toBe(0);
    expect([g.secuCents, g.mutuelleCents, g.resteAChargeCents]).toEqual([2100, 900, 0]);

    const p = agent.compute(facture("PHARMACIE_SMR_MAJEUR", 2480, 2), exonere);
    expect(p.retenueCents).toBe(0);
    expect([p.secuCents, p.mutuelleCents, p.resteAChargeCents]).toEqual([1612, 868, 0]);
  });

  /*
   * Généraliste 30 €, sans médecin traitant déclaré → taux hors parcours 30 %, mutuelle 100 %
   * secuBrut = 3000 × 30 % = 900 c, participation 200 c → secu = 700 c
   * majoration = 3000 × (70 % − 30 %) = 1200 c, jamais couverte (contrat responsable)
   * mutuelle = min(3000 × 100 % − 3000 × 70 %, 3000 − 900 − 1200) = min(900, 900) = 900 c
   * reste à charge = 3000 − 700 − 900 = 1400 c (majoration 1200 + participation 200)
   */
  it("hors parcours de soins : Sécu à 30 %, la mutuelle ne couvre pas la majoration", () => {
    const b = nouvelAgent().compute(facture("GENERALISTE_CONSULT", 3000), { ...profil, medecinTraitant: false });
    expect(b.retenueCents).toBe(200);
    expect([b.secuCents, b.mutuelleCents, b.resteAChargeCents]).toEqual([700, 900, 1400]);
  });

  /*
   * Généraliste facturé 50 € (dépassement 20 €), hors parcours, mutuelle 200 %
   * secuBrut = 900 c, participation 200 c → secu = 700 c
   * majoration = 1200 c
   * mutuelle = min(3000 × 200 % − 3000 × 70 %, 5000 − 900 − 1200) = min(3900, 2900) = 2900 c
   *   (ticket modérateur 900 + dépassement 2000 : couverts ; majoration : non)
   * reste à charge = 5000 − 700 − 2900 = 1400 c (majoration 1200 + participation 200)
   */
  it("hors parcours avec mutuelle à 200 % : la majoration reste à charge", () => {
    const b = nouvelAgent().compute(facture("GENERALISTE_CONSULT", 5000), {
      ...profil, medecinTraitant: false, mutuelleBrssPct: 200,
    });
    expect(b.depassementCents).toBe(2000);
    expect([b.secuCents, b.mutuelleCents, b.resteAChargeCents]).toEqual([700, 2900, 1400]);
  });

  /*
   * a) Compteurs à 0, une consultation : retenue 200 c → commit → participations = 200 c.
   *    Une pharmacie 2 boîtes : franchise 200 c → commit → franchises = 200 c (participations inchangées).
   * b) Participations à 6900 c : il reste 7000 − 6900 = 100 c avant le plafond
   *    → retenue = min(200, 100) = 100 c, secu = 2100 − 100 = 2000 c, mutuelle 900 c, reste 100 c
   *    → commit → participations = 7000 c
   *    → consultation suivante : retenue = min(200, 0) = 0, secu = 2100 c, reste 0
   */
  it("commit() fait avancer les compteurs, et la retenue tombe à 0 une fois le plafond de 70 € atteint", () => {
    const agent = nouvelAgent();
    const consult = facture("GENERALISTE_CONSULT", 3000);
    agent.commit(consult, agent.compute(consult, profil));
    expect(agent.snapshot()).toEqual({ participationsCents: 200, franchisesCents: 0 });

    const pharma = facture("PHARMACIE_SMR_MAJEUR", 2480, 2);
    agent.commit(pharma, agent.compute(pharma, profil));
    expect(agent.snapshot()).toEqual({ participationsCents: 200, franchisesCents: 200 });

    const presque = nouvelAgent(6900);
    const avant = presque.compute(consult, profil);
    expect(avant.retenueCents).toBe(100);
    expect([avant.secuCents, avant.mutuelleCents, avant.resteAChargeCents]).toEqual([2000, 900, 100]);
    presque.commit(consult, avant);
    expect(presque.snapshot().participationsCents).toBe(7000);

    const apres = presque.compute(consult, profil);
    expect(apres.retenueCents).toBe(0);
    expect([apres.secuCents, apres.resteAChargeCents]).toEqual([2100, 0]);
  });
});
