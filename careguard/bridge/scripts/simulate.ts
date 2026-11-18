/**
 * Simulation de foyers : envoie des factures réalistes et récurrentes à travers les 4 agents,
 * pour produire de l'activité réelle sur le testnet Aevum (comptée au jugement).
 *
 *   pnpm simulate              → 20 factures, une toutes les 30 s
 *   pnpm simulate -- 50 10     → 50 factures, une toutes les 10 s
 */
import { createCareGuard } from "../src/wiring";
import type { BeneficiaryProfile } from "@careguard/core";

const [count = "20", intervalS = "30"] = process.argv.slice(2);

const FOYERS: { nom: string; profile: BeneficiaryProfile }[] = [
  { nom: "papa", profile: { ald: false, medecinTraitant: true, mutuelleBrssPct: 100, exonereRetenues: false } },
  { nom: "mamie", profile: { ald: true, medecinTraitant: true, mutuelleBrssPct: 150, exonereRetenues: false } },
  { nom: "oncle", profile: { ald: false, medecinTraitant: false, mutuelleBrssPct: 0, exonereRetenues: false } },
];

const FACTURES = [
  { providerId: "kine-dupont", acte: "KINE_SEANCE", montantCents: 1613, quantite: 1 },
  { providerId: "medecin-martin", acte: "GENERALISTE_CONSULT", montantCents: 3000, quantite: 1 },
  { providerId: "pharmacie-centrale", acte: "PHARMACIE_SMR_MAJEUR", montantCents: 1240, quantite: 2 },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];

async function main() {
  const { orchestrator } = createCareGuard();
  const run = Date.now().toString(36);

  for (let i = 0; i < Number(count); i++) {
    const foyer = pick(FOYERS);
    const f = pick(FACTURES);
    const data = {
      ...f,
      invoiceNo: `SIM-${run}-${i}`,
      date: new Date().toISOString().slice(0, 10),
      beneficiaire: foyer.nom,
    };
    try {
      const r = await orchestrator.process({ kind: "json", data }, { profile: foyer.profile });
      console.log(`#${i} ${foyer.nom} ${f.acte} → ${r.tx.status}`, "txHash" in r.tx ? r.tx.txHash : r.explanation);
    } catch (e) {
      console.error(`#${i} erreur :`, e instanceof Error ? e.message : e);
    }
    await sleep(Number(intervalS) * 1000);
  }
}

main();
