import type { Hex } from "viem";
import type { VaultPort } from "../ports";
import type { PaymentOrder, TxResult } from "../types";

/** Raisons de refus du contrat, traduites pour l'aidante */
export const CONTRACT_ERRORS: Record<string, string> = {
  NotTransactionAgent: "Appel refusé : ce n'est pas l'agent transaction.",
  AgentsAreRevoked: "Les agents ont été révoqués par l'aidante.",
  AgentsExpired: "L'autorisation des agents a expiré.",
  ApprovalExpired: "La signature de l'agent sécurité a expiré.",
  BadSecuritySignature: "Signature de l'agent sécurité invalide.",
  ECDSAInvalidSignature: "Signature de l'agent sécurité invalide.",
  ECDSAInvalidSignatureLength: "Signature de l'agent sécurité manquante.",
  ECDSAInvalidSignatureS: "Signature de l'agent sécurité invalide.",
  UnknownProvider: "Soignant inconnu : il n'est pas dans votre liste.",
  ProviderNotYetActive: "Soignant ajouté il y a moins de 48 h.",
  CategoryMismatch: "L'acte ne correspond pas à la spécialité du soignant.",
  InvoiceAlreadyUsed: "Cette facture a déjà été payée.",
  ZeroAmount: "Montant nul.",
  AboveTxCap: "Plafond par paiement dépassé.",
  AboveDailyCap: "Plafond journalier dépassé.",
};

/**
 * Agent transaction — sans LLM.
 * Seul détenteur de la clé de paiement. Il simule, envoie, et rapporte.
 * Il n'exécute rien sans la signature de l'agent sécurité : c'est le contrat qui l'exige.
 */
export class TransactionAgent {
  constructor(private vault: VaultPort) {}

  async execute(order: PaymentOrder, securitySig: Hex): Promise<TxResult> {
    const sim = await this.vault.simulatePay(order, securitySig);
    if (!sim.ok) {
      return {
        status: "reverted",
        errorName: sim.errorName,
        reason: CONTRACT_ERRORS[sim.errorName] ?? `Refusé par le contrat (${sim.errorName}).`,
      };
    }
    const txHash = await this.vault.sendPay(order, securitySig);
    return sim.executed ? { status: "paid", txHash } : { status: "queued", txHash, pendingId: sim.pendingId };
  }
}
