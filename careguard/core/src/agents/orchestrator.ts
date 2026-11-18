import type { Hex } from "viem";
import { acteCategory } from "../rac/engine";
import { baremeHash, centsToToken, formatEuros, invoiceHash, providerIdHash } from "../ids";
import { InvoiceSchema } from "../invoice";
import type { LlmPort } from "../llm";
import type { HistoryPort } from "../ports";
import type { AmountsAgent } from "./amounts";
import type { SecurityAgent } from "./security";
import type { TransactionAgent } from "./transaction";
import type {
  AgentMessage, AgentName, BeneficiaryProfile, Breakdown, DemoMode, Invoice, InvoiceInput,
  PaymentOrder, ProcessResult, RiskReport, TxResult,
} from "../types";

export interface ProcessOptions {
  profile: BeneficiaryProfile;
  /** L'aidante a validé une facture escaladée */
  guardianConfirmed?: boolean;
  /** Vidéo de démo : simuler un ou deux agents compromis */
  demo?: DemoMode;
}

const APPROVAL_TTL_SECONDS = 15n * 60n;

/**
 * Orchestrateur — lit la facture, répartit le travail, rédige l'explication.
 * Pouvoir : aucun. Il n'a ni clé de paiement ni clé de signature.
 */
export class Orchestrator {
  constructor(
    private d: {
      llm: LlmPort;
      amounts: AmountsAgent;
      security: SecurityAgent;
      transaction: TransactionAgent;
      history: HistoryPort;
    },
  ) {}

  async process(input: InvoiceInput, opts: ProcessOptions): Promise<ProcessResult> {
    const trace: AgentMessage[] = [];
    const log = (from: AgentName, to: AgentName | "aidante", summary: string) =>
      trace.push({ at: new Date().toISOString(), from, to, summary });

    // 1. Lecture
    const invoice = await this.read(input);
    log("orchestrateur", "montants", `Facture ${invoice.invoiceNo} lue : ${formatEuros(invoice.montantCents)} chez ${invoice.providerId}.`);

    // 2. Montants
    const breakdown = this.d.amounts.compute(invoice, opts.profile);
    log("montants", "orchestrateur",
      `Sécu ${formatEuros(breakdown.secuCents)} · mutuelle ${formatEuros(breakdown.mutuelleCents)} · reste à charge ${formatEuros(breakdown.resteAChargeCents)}.`);

    const order = buildOrder(invoice, breakdown);

    // 3. Sécurité
    let risk: RiskReport;
    let sig: Hex | null;
    if (opts.demo) {
      risk = {
        score: 0, decision: "pay", blocking: false,
        reasons: [{ code: "DEMO", points: 0, message: `Démo : agent(s) compromis (${opts.demo}).` }],
      };
      if (opts.demo === "orchestrateur+securite") {
        sig = await this.d.security.signBlindly(order);
        log("securite", "transaction", "[DÉMO] Agent sécurité compromis : il signe sans vérifier.");
      } else {
        sig = "0x";
        log("orchestrateur", "transaction", "[DÉMO] Orchestrateur compromis : paiement forcé sans signature sécurité.");
      }
    } else {
      log("orchestrateur", "securite", "Demande d'analyse de risque.");
      risk = await this.d.security.review(input, invoice, breakdown);
      log("securite", "orchestrateur", `Score ${risk.score} → ${labelDecision(risk.decision)}.`);
      sig = await this.d.security.approve(order, risk, opts.guardianConfirmed);
      if (sig) log("securite", "transaction", "Accord signé (EIP-712).");
    }

    // 4. Transaction
    let tx: TxResult;
    if (sig) {
      tx = await this.d.transaction.execute(order, sig);
      log("transaction", "orchestrateur", summarizeTx(tx));
      if (tx.status === "paid" || tx.status === "queued") {
        this.d.history.record(invoice);
        if (tx.status === "paid") this.d.amounts.commit(invoice, breakdown);
      }
    } else {
      tx = {
        status: "not_sent",
        reason: risk.decision === "block" ? "Paiement bloqué par l'agent sécurité." : "En attente de votre validation.",
      };
    }

    // 5. Explication (rédigée à partir des faits structurés, jamais à partir du document)
    const resume = defaultSummary(breakdown, risk, tx);
    const explanation = await this.d.llm
      .explain({ resume, montants: breakdown, decision: risk.decision, raisons: risk.reasons.map((r) => r.message), transaction: tx.status })
      .catch(() => resume);
    log("orchestrateur", "aidante", explanation);

    return { invoice, breakdown, risk, order, tx, trace, explanation };
  }

  private async read(input: InvoiceInput): Promise<Invoice> {
    const raw = input.kind === "json" ? input.data : await this.d.llm.extractInvoice(input.base64);
    return InvoiceSchema.parse(raw);
  }
}

export function buildOrder(invoice: Invoice, b: Breakdown, nowSeconds = BigInt(Math.floor(Date.now() / 1000))): PaymentOrder {
  return {
    invoiceHash: invoiceHash(invoice),
    providerId: providerIdHash(invoice.providerId),
    category: acteCategory(invoice.acte),
    amount: centsToToken(invoice.montantCents),
    breakdown: {
      secu: centsToToken(b.secuCents),
      mutuelle: centsToToken(b.mutuelleCents),
      resteACharge: centsToToken(b.resteAChargeCents),
    },
    baremeHash,
    deadline: nowSeconds + APPROVAL_TTL_SECONDS,
  };
}

const labelDecision = (d: RiskReport["decision"]) =>
  d === "pay" ? "paiement autorisé" : d === "escalate" ? "validation de l'aidante requise" : "paiement bloqué";

function summarizeTx(tx: TxResult): string {
  switch (tx.status) {
    case "paid": return `Payé. Transaction ${tx.txHash}.`;
    case "queued": return `En attente de validation on-chain (n° ${tx.pendingId}). Transaction ${tx.txHash}.`;
    case "reverted": return `Refusé par le contrat : ${tx.reason}`;
    default: return tx.reason;
  }
}

function defaultSummary(b: Breakdown, risk: RiskReport, tx: TxResult): string {
  const parts = `Sécu ${formatEuros(b.secuCents)}, mutuelle ${formatEuros(b.mutuelleCents)}, reste à votre charge ${formatEuros(b.resteAChargeCents)}.`;
  if (tx.status === "paid") return `Payé. ${parts}`;
  if (tx.status === "queued") return `Montant élevé : validez le paiement dans le coffre. ${parts}`;
  if (tx.status === "reverted") return `Paiement refusé par le coffre : ${tx.reason}`;
  if (risk.decision === "escalate") return `À valider : ${risk.reasons.map((r) => r.message).join(" ")} ${parts}`;
  return `Bloqué : ${risk.reasons.map((r) => r.message).join(" ")}`;
}
