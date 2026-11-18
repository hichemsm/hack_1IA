import type { Hex } from "viem";
import type { Invoice, PaymentOrder, ProviderInfo } from "./types";

/**
 * Ports : ce dont les agents ont besoin du monde extérieur.
 * Le core ne connaît ni la blockchain ni les clés ; c'est bridge/ qui fournit les implémentations.
 */

/** Lecture de l'état du coffre (utilisé par l'agent sécurité) */
export interface RegistryPort {
  getProvider(providerId: Hex): Promise<ProviderInfo>;
  isInvoiceUsed(invoiceHash: Hex): Promise<boolean>;
  approvalThreshold(): Promise<bigint>;
  nowSeconds(): Promise<number>;
}

/** Clé de signature de l'agent sécurité (EIP-712). Ne peut pas envoyer de transaction. */
export interface ApprovalSigner {
  readonly address: Hex;
  signApproval(order: PaymentOrder): Promise<Hex>;
}

export type SimulationResult =
  | { ok: true; executed: boolean; pendingId: bigint }
  | { ok: false; errorName: string };

/** Accès en écriture au coffre (utilisé par l'agent transaction, et lui seul) */
export interface VaultPort {
  simulatePay(order: PaymentOrder, securitySig: Hex): Promise<SimulationResult>;
  sendPay(order: PaymentOrder, securitySig: Hex): Promise<Hex>;
}

/** Historique local minimal, pour la règle de fréquence anormale */
export interface HistoryPort {
  countSameProviderSameDay(providerId: string, date: string): number;
  record(invoice: Invoice): void;
}

export class InMemoryHistory implements HistoryPort {
  private items: Invoice[] = [];
  countSameProviderSameDay(providerId: string, date: string): number {
    return this.items.filter((i) => i.providerId === providerId && i.date === date).length;
  }
  record(invoice: Invoice): void {
    this.items.push(invoice);
  }
}
