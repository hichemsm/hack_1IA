import type { BeneficiaryProfile, ProcessResult } from "@careguard/core";
import type { TxItem } from "./types";

/**
 * État du foyer côté serveur, en mémoire (suffisant pour la démo).
 * La source de vérité des paiements reste les events on-chain de CareVault.
 */
interface Store {
  beneficiaire: string;
  profile: BeneficiaryProfile;
  txs: TxItem[];
}

const g = globalThis as unknown as { __careguardStore?: Store };

export const store: Store = (g.__careguardStore ??= {
  beneficiaire: "Papa",
  profile: { ald: false, medecinTraitant: true, mutuelleBrssPct: 150, exonereRetenues: false },
  txs: [],
});

const LABELS: Record<string, string> = {
  GENERALISTE_CONSULT: "Généraliste",
  KINE_SEANCE: "Kiné",
  PHARMACIE_SMR_MAJEUR: "Pharmacie",
  NON_REMBOURSABLE: "Acte non remboursé",
};

export function recordResult(r: ProcessResult): TxItem {
  const status: TxItem["status"] =
    r.tx.status === "paid" ? "paid"
    : r.tx.status === "queued" ? "queued"
    : r.tx.status === "not_sent" && r.risk.decision === "escalate" ? "escalate"
    : "blocked";

  const item: TxItem = {
    id: `${r.invoice.invoiceNo}-${Date.now()}`,
    label: LABELS[r.invoice.acte] ?? r.invoice.acte,
    montantCents: r.invoice.montantCents,
    status,
    txHash: "txHash" in r.tx ? r.tx.txHash : undefined,
    pendingId: r.tx.status === "queued" ? r.tx.pendingId.toString() : undefined,
    at: new Date().toISOString(),
  };
  store.txs.push(item);
  if (store.txs.length > 50) store.txs.shift();
  return item;
}
