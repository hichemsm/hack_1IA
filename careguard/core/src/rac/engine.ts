import bareme from "./bareme-2026-11.json";
import { Category, type AnnualCounters, type BeneficiaryProfile, type Breakdown } from "../types";

/**
 * Moteur de reste à charge — calcul pur, sans IA, reproductible.
 * Estimation indicative : ne remplace pas le décompte ameli ni celui de la mutuelle.
 *
 * Simplifications du MVP :
 * - ALD : on suppose l'acte lié à l'affection (prise en charge à 100 %) ;
 * - pas de plafonds journaliers, pas de règle SMR faible, pas de plafonnement des dépassements (OPTAM).
 */

type RetenueKind = "participation" | "franchiseActe" | "franchiseBoite" | null;

export interface ActeDef {
  libelle: string;
  categorie: keyof typeof Category;
  brssCents: number | null; // null = la base est le prix facturé (pharmacie)
  tauxSecu: number;
  tauxHorsParcours?: number;
  retenue: RetenueKind;
}

export const BAREME = bareme as {
  version: string;
  sources: string[];
  retenues: {
    participationForfaitaireCents: number;
    franchiseActeParamedicalCents: number;
    franchiseBoiteCents: number;
    plafondAnnuelParticipationsCents: number;
    plafondAnnuelFranchisesCents: number;
  };
  actes: Record<string, ActeDef>;
};

export function acteDef(code: string): ActeDef {
  const d = BAREME.actes[code];
  if (!d) throw new Error(`Acte inconnu dans le barème ${BAREME.version} : ${code}`);
  return d;
}

export function acteCategory(code: string): Category {
  return Category[acteDef(code).categorie];
}

export interface BreakdownInput {
  acte: string;
  montantCents: number;
  quantite: number;
  profile: BeneficiaryProfile;
  counters: AnnualCounters;
}

export function computeBreakdown(i: BreakdownInput): Breakdown {
  const d = acteDef(i.acte);
  const q = Math.max(1, Math.floor(i.quantite));
  const brss = d.brssCents === null ? i.montantCents : d.brssCents * q;

  let taux = d.tauxSecu;
  let horsParcours = false;
  if (taux > 0 && i.profile.ald) taux = 100;
  else if (d.categorie === "MEDECIN" && !i.profile.medecinTraitant && d.tauxHorsParcours !== undefined) {
    taux = d.tauxHorsParcours;
    horsParcours = true;
  }

  const secuBrut = Math.round((brss * taux) / 100);
  const retenue = taux === 0 || i.profile.exonereRetenues ? 0 : computeRetenue(d.retenue, q, i.counters);
  const secu = Math.max(0, secuBrut - retenue);

  // La mutuelle complète jusqu'à X % de la BRSS (part Sécu incluse) et ne rembourse jamais les retenues.
  // On suppose un contrat responsable : hors parcours de soins, la mutuelle ne couvre pas la majoration
  // du ticket modérateur. Son plafond se calcule donc avec le taux normal (tauxSecu), et la majoration
  // (BRSS × (tauxSecu − tauxHorsParcours)) reste toujours à la charge du patient.
  const tauxReference = horsParcours ? d.tauxSecu : taux;
  const majoration = horsParcours ? Math.round((brss * (d.tauxSecu - taux)) / 100) : 0;
  const plafondMutuelle = Math.round((brss * i.profile.mutuelleBrssPct) / 100) - Math.round((brss * tauxReference) / 100);
  const mutuelle = taux === 0 ? 0 : clamp0(Math.min(plafondMutuelle, i.montantCents - secuBrut - majoration));

  return {
    brssCents: brss,
    secuCents: secu,
    mutuelleCents: mutuelle,
    resteAChargeCents: i.montantCents - secu - mutuelle,
    retenueCents: retenue,
    remboursable: taux > 0,
    depassementCents: clamp0(i.montantCents - brss),
    baremeVersion: BAREME.version,
  };
}

function computeRetenue(kind: RetenueKind, quantite: number, c: AnnualCounters): number {
  const R = BAREME.retenues;
  switch (kind) {
    case "participation":
      return Math.min(R.participationForfaitaireCents, clamp0(R.plafondAnnuelParticipationsCents - c.participationsCents));
    case "franchiseActe":
      return Math.min(R.franchiseActeParamedicalCents, clamp0(R.plafondAnnuelFranchisesCents - c.franchisesCents));
    case "franchiseBoite":
      return Math.min(R.franchiseBoiteCents * quantite, clamp0(R.plafondAnnuelFranchisesCents - c.franchisesCents));
    default:
      return 0;
  }
}

/** Indique quel compteur annuel une retenue alimente */
export function retenueCounter(acte: string): keyof AnnualCounters | null {
  const k = acteDef(acte).retenue;
  if (k === "participation") return "participationsCents";
  if (k === "franchiseActe" || k === "franchiseBoite") return "franchisesCents";
  return null;
}

const clamp0 = (n: number) => (n < 0 ? 0 : n);
