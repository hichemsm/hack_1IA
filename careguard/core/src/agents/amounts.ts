import { computeBreakdown, retenueCounter } from "../rac/engine";
import type { AnnualCounters, BeneficiaryProfile, Breakdown, Invoice } from "../types";

/**
 * Agent montants — sans LLM.
 * Calcule la part Sécu, la part mutuelle et le reste à charge, et tient les cumuls annuels.
 * Pouvoir : aucun (ni clé, ni accès au coffre).
 */
export class AmountsAgent {
  constructor(private counters: AnnualCounters = { participationsCents: 0, franchisesCents: 0 }) {}

  compute(invoice: Invoice, profile: BeneficiaryProfile): Breakdown {
    return computeBreakdown({
      acte: invoice.acte,
      montantCents: invoice.montantCents,
      quantite: invoice.quantite,
      profile,
      counters: this.counters,
    });
  }

  /** À appeler une fois le paiement exécuté, pour faire avancer les plafonds annuels */
  commit(invoice: Invoice, breakdown: Breakdown): void {
    const key = retenueCounter(invoice.acte);
    if (key) this.counters[key] += breakdown.retenueCents;
  }

  snapshot(): AnnualCounters {
    return { ...this.counters };
  }
}
