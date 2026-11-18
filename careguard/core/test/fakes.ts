import type { Hex } from "viem";
import { centsToToken, invoiceHash, providerIdHash } from "../src/ids";
import type { ApprovalSigner, RegistryPort } from "../src/ports";
import { Category, type Invoice, type PaymentOrder, type ProviderInfo } from "../src/types";

export { InMemoryHistory } from "../src/ports";
export { OfflineLlm } from "../src/llm";

/** Heure courante par défaut des tests (en secondes) */
export const NOW = 1_800_000_000;
export const HOUR = 3_600;

export interface FakeProvider {
  category: Category;
  /** 1 = secteur 1 (pas de dépassement autorisé), 2 = secteur 2 */
  sector?: number;
  /** Date d'activation (secondes). Par défaut : actif depuis 3 jours */
  activeAt?: number;
  payout?: Hex;
}

/**
 * Faux registre du coffre : soignants, factures déjà payées, seuil de validation et heure courante,
 * tous configurables. Les soignants sont déclarés par leur identifiant texte (ex. « kine-dupont »).
 */
export class FakeRegistry implements RegistryPort {
  private providers = new Map<Hex, ProviderInfo>();
  private used = new Set<Hex>();
  /** Seuil en unités tUSD8 (6 décimales). Par défaut 100 € */
  threshold: bigint = centsToToken(10_000);
  now: number = NOW;

  addProvider(id: string, p: FakeProvider): this {
    this.providers.set(providerIdHash(id), {
      exists: true,
      payout: p.payout ?? "0x000000000000000000000000000000000000beef",
      category: p.category,
      sector: p.sector ?? 1,
      activeAt: p.activeAt ?? this.now - 72 * HOUR,
    });
    return this;
  }

  markPaid(invoice: Invoice): this {
    this.used.add(invoiceHash(invoice));
    return this;
  }

  setThresholdCents(cents: number): this {
    this.threshold = centsToToken(cents);
    return this;
  }

  async getProvider(providerId: Hex): Promise<ProviderInfo> {
    return (
      this.providers.get(providerId) ?? {
        exists: false,
        payout: "0x0000000000000000000000000000000000000000",
        category: 0,
        sector: 0,
        activeAt: 0,
      }
    );
  }

  async isInvoiceUsed(hash: Hex): Promise<boolean> {
    return this.used.has(hash);
  }

  async approvalThreshold(): Promise<bigint> {
    return this.threshold;
  }

  async nowSeconds(): Promise<number> {
    return this.now;
  }
}

/** Faux signataire : renvoie une signature factice et garde la trace de chaque appel */
export class FakeSigner implements ApprovalSigner {
  readonly address: Hex = "0x000000000000000000000000000000000000a11c";
  static readonly SIGNATURE: Hex = `0x${"5a".repeat(65)}`;
  readonly calls: PaymentOrder[] = [];

  get callCount(): number {
    return this.calls.length;
  }

  async signApproval(order: PaymentOrder): Promise<Hex> {
    this.calls.push(order);
    return FakeSigner.SIGNATURE;
  }
}
