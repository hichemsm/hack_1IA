import type { BeneficiaryProfile, ProcessResult } from "@careguard/core";

/** Une ligne des transactions en cours (en haut à droite) */
export interface TxItem {
  id: string;
  label: string;
  montantCents: number;
  status: "paid" | "queued" | "escalate" | "blocked";
  txHash?: string;
  pendingId?: string;
  at: string;
}

/** Ce que renvoie GET /api/state */
export interface AppState {
  beneficiaire: string;
  profile: BeneficiaryProfile;
  counters: { participationsCents: number; franchisesCents: number };
  plafonds: { participationsCents: number; franchisesCents: number };
  coffre: string | null; // unités tUSD8 (6 décimales), en texte
  txs: TxItem[];
  vault: string;
  llmMode: string;
}

/** Résultat d'une facture tel que le renvoie /api/invoice (les bigint arrivent en texte) */
export type InvoiceResponse = ProcessResult & { txItem: TxItem };
