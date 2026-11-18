import type { Hex } from "viem";
import { acteCategory } from "../rac/engine";
import { centsToToken, providerIdHash, invoiceHash } from "../ids";
import type { LlmPort } from "../llm";
import type { ApprovalSigner, HistoryPort, RegistryPort } from "../ports";
import { Category, type Breakdown, type Invoice, type InvoiceInput, type PaymentOrder, type RiskReason, type RiskReport } from "../types";

export interface SecurityConfig {
  escalateFrom: number;
  blockFrom: number;
}

/**
 * Agent sécurité — score de risque + veto + signature EIP-712.
 * Il relit lui-même la facture BRUTE (jamais le résumé de l'orchestrateur)
 * pour qu'une injection qui piège l'orchestrateur ne se propage pas.
 * Pouvoir : signer un accord. Il n'envoie aucune transaction.
 */
export class SecurityAgent {
  constructor(
    private deps: { registry: RegistryPort; signer: ApprovalSigner; llm: LlmPort; history: HistoryPort },
    private cfg: SecurityConfig = { escalateFrom: 30, blockFrom: 70 },
  ) {}

  async review(raw: InvoiceInput, invoice: Invoice, b: Breakdown): Promise<RiskReport> {
    const reasons: RiskReason[] = [];
    const { registry, llm, history } = this.deps;
    const category = acteCategory(invoice.acte);

    const [provider, used, now, threshold] = await Promise.all([
      registry.getProvider(providerIdHash(invoice.providerId)),
      registry.isInvoiceUsed(invoiceHash(invoice)),
      registry.nowSeconds(),
      registry.approvalThreshold(),
    ]);

    // Règles bloquantes
    if (used) reasons.push({ code: "DOUBLON", points: "BLOQUANT", message: "Cette facture a déjà été payée." });
    if (!provider.exists) {
      reasons.push({ code: "SOIGNANT_INCONNU", points: "BLOQUANT", message: "Ce soignant n'est pas dans votre liste." });
    } else {
      if (now < provider.activeAt)
        reasons.push({ code: "DELAI_48H", points: "BLOQUANT", message: "Soignant ajouté il y a moins de 48 h." });
      if (provider.category !== category)
        reasons.push({ code: "CATEGORIE", points: "BLOQUANT", message: "L'acte ne correspond pas à la spécialité du soignant." });
    }

    // Règles à points
    if (category === Category.MEDECIN && provider.exists && provider.sector === 1 && b.depassementCents > 0)
      reasons.push({ code: "DEPASSEMENT_S1", points: 40, message: "Dépassement d'honoraires chez un médecin de secteur 1." });
    if (category !== Category.MEDECIN && b.brssCents > 0 && invoice.montantCents > b.brssCents * 1.2)
      reasons.push({ code: "MONTANT_ANORMAL", points: 30, message: "Montant supérieur de plus de 20 % au tarif habituel." });
    if (category === Category.PARAMEDICAL && history.countSameProviderSameDay(invoice.providerId, invoice.date) >= 1)
      reasons.push({ code: "FREQUENCE", points: 25, message: "Deuxième séance chez ce soignant le même jour." });
    if (!b.remboursable)
      reasons.push({ code: "NON_REMBOURSABLE", points: 20, message: "Acte non remboursé par la Sécurité sociale." });

    const suspicion = await llm.detectSuspicious(
      raw.kind === "pdf" ? { pdfBase64: raw.base64 } : { text: JSON.stringify(raw.data) },
    );
    if (suspicion.suspicious)
      reasons.push({ code: "TEXTE_SUSPECT", points: 40, message: `Contenu suspect : ${suspicion.reasons.join(", ")}.` });

    const blocking = reasons.some((r) => r.points === "BLOQUANT");
    const score = reasons.reduce((s, r) => s + (typeof r.points === "number" ? r.points : 0), 0);
    const decision = blocking || score >= this.cfg.blockFrom ? "block" : score >= this.cfg.escalateFrom ? "escalate" : "pay";

    if (decision === "pay" && centsToToken(invoice.montantCents) > threshold)
      reasons.push({ code: "SEUIL", points: 0, message: "Montant au-dessus du seuil : le coffre attendra votre validation." });

    return { score, decision, blocking, reasons };
  }

  /** Signe l'accord seulement si la décision le permet. Une escalade attend la confirmation de l'aidante. */
  async approve(order: PaymentOrder, report: RiskReport, guardianConfirmed = false): Promise<Hex | null> {
    if (report.decision === "block") return null;
    if (report.decision === "escalate" && !guardianConfirmed) return null;
    return this.deps.signer.signApproval(order);
  }

  /** Démo uniquement : agent sécurité compromis qui signe tout */
  async signBlindly(order: PaymentOrder): Promise<Hex> {
    return this.deps.signer.signApproval(order);
  }
}
