import type { Hex } from "viem";

/** Catégories de soins — mêmes valeurs que `category` dans CareVault.sol */
export enum Category {
  MEDECIN = 1,
  PARAMEDICAL = 2,
  PHARMACIE = 3,
  AIDE_DOMICILE = 4,
  AUTRE = 9,
}

/** Niveau de garantie de la mutuelle, en % de la base de remboursement (BRSS). 0 = pas de mutuelle */
export type MutuelleLevel = 0 | 100 | 150 | 200;

export interface BeneficiaryProfile {
  ald: boolean;
  medecinTraitant: boolean;
  mutuelleBrssPct: MutuelleLevel;
  /** C2S, AME… : exonération des franchises et participations forfaitaires */
  exonereRetenues: boolean;
}

/** Cumuls annuels déjà prélevés, pour appliquer les plafonds (70 € + 70 €) */
export interface AnnualCounters {
  participationsCents: number;
  franchisesCents: number;
}

/** Facture normalisée. Les montants sont en centimes d'euro. */
export interface Invoice {
  invoiceNo: string;
  providerId: string;
  date: string; // AAAA-MM-JJ
  acte: string; // code du barème, ex. KINE_SEANCE
  montantCents: number;
  quantite: number;
  beneficiaire: string;
}

export type InvoiceInput =
  | { kind: "json"; data: unknown }
  | { kind: "pdf"; base64: string };

export interface Breakdown {
  brssCents: number;
  secuCents: number;
  mutuelleCents: number;
  resteAChargeCents: number;
  retenueCents: number;
  remboursable: boolean;
  depassementCents: number;
  baremeVersion: string;
}

export type Decision = "pay" | "escalate" | "block";

export interface RiskReason {
  code: string;
  points: number | "BLOQUANT";
  message: string;
}

export interface RiskReport {
  score: number;
  decision: Decision;
  blocking: boolean;
  reasons: RiskReason[];
}

export interface ProviderInfo {
  exists: boolean;
  payout: Hex;
  category: number;
  sector: number;
  activeAt: number; // timestamp en secondes
}

/** Ordre de paiement tel que l'attend CareVault.agentPay (montants en unités tUSD8, 6 décimales) */
export interface PaymentOrder {
  invoiceHash: Hex;
  providerId: Hex;
  category: number;
  amount: bigint;
  breakdown: { secu: bigint; mutuelle: bigint; resteACharge: bigint };
  baremeHash: Hex;
  deadline: bigint;
}

export type TxResult =
  | { status: "paid"; txHash: Hex }
  | { status: "queued"; txHash: Hex; pendingId: bigint }
  | { status: "reverted"; reason: string; errorName: string }
  | { status: "not_sent"; reason: string };

export type AgentName = "orchestrateur" | "montants" | "securite" | "transaction";

/** Une ligne de la frise « qui a dit quoi » affichée dans l'interface */
export interface AgentMessage {
  at: string;
  from: AgentName;
  to: AgentName | "aidante";
  summary: string;
}

/** Modes de démo pour la vidéo : simuler un ou deux agents compromis */
export type DemoMode = "orchestrateur" | "orchestrateur+securite";

export interface ProcessResult {
  invoice: Invoice;
  breakdown: Breakdown;
  risk: RiskReport;
  order: PaymentOrder;
  tx: TxResult;
  trace: AgentMessage[];
  explanation: string;
}
