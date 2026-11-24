import { concat, encodeAbiParameters, keccak256, size, slice, type Hex } from "viem";
import { centsToToken, invoiceHash, providerIdHash } from "../src/ids";
import type { ApprovalSigner, RegistryPort, SimulationResult, VaultPort } from "../src/ports";
import { Category, type Invoice, type PaymentOrder, type ProviderInfo } from "../src/types";

export { InMemoryHistory } from "../src/ports";
export { OfflineLlm } from "../src/llm";

/** Heure courante par défaut des tests (en secondes) */
export const NOW = 1_800_000_000;
export const HOUR = 3_600;
export const DAY = 86_400;

/** pendingId renvoyé par le contrat quand le paiement est exécuté tout de suite (type(uint256).max) */
export const NOT_PENDING = 2n ** 256n - 1n;

export interface FakeProvider {
  category: Category;
  /** 1 = secteur 1 (pas de dépassement autorisé), 2 = secteur 2 */
  sector?: number;
  /** Date d'activation (secondes). Par défaut : actif depuis 3 jours */
  activeAt?: number;
  payout?: Hex;
}

const UNKNOWN_PROVIDER: ProviderInfo = {
  exists: false,
  payout: "0x0000000000000000000000000000000000000000",
  category: 0,
  sector: 0,
  activeAt: 0,
};

/**
 * Faux registre du coffre : soignants, factures déjà payées, seuil de validation et heure courante,
 * tous configurables. Les soignants sont déclarés par leur identifiant texte (ex. « kine-dupont »).
 * Un FakeVault construit avec ce registre partage le même état (soignants, factures payées, seuil, heure).
 */
export class FakeRegistry implements RegistryPort {
  readonly providers = new Map<Hex, ProviderInfo>();
  readonly used = new Set<Hex>();
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
    return this.providers.get(providerId) ?? UNKNOWN_PROVIDER;
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

/**
 * Faux signataire : signature vérifiable de 65 octets, comme une signature ECDSA.
 * Format : keccak256(adresse, champs signés) (32 o) ‖ adresse du signataire (20 o) ‖ 13 octets nuls.
 * Les champs signés sont ceux de APPROVAL_TYPEHASH dans CareVault.sol.
 */
export class FakeSigner implements ApprovalSigner {
  static readonly DEFAULT_ADDRESS: Hex = "0x000000000000000000000000000000000000a11c";
  readonly calls: PaymentOrder[] = [];

  constructor(readonly address: Hex = FakeSigner.DEFAULT_ADDRESS) {}

  get callCount(): number {
    return this.calls.length;
  }

  static sign(order: PaymentOrder, address: Hex): Hex {
    const digest = keccak256(
      encodeAbiParameters(
        [
          { type: "address" }, { type: "bytes32" }, { type: "bytes32" },
          { type: "uint8" }, { type: "uint256" }, { type: "uint256" },
        ],
        [address, order.invoiceHash, order.providerId, order.category, order.amount, order.deadline],
      ),
    );
    return concat([digest, address, `0x${"00".repeat(13)}`]);
  }

  /**
   * Équivalent de ECDSA.recover : renvoie l'adresse du signataire, ou une adresse quelconque si la
   * signature ne correspond pas à l'ordre. Une longueur ≠ 65 octets lève ECDSAInvalidSignatureLength.
   */
  static recover(order: PaymentOrder, sig: Hex): Hex {
    if (size(sig) !== 65) throw new ContractError("ECDSAInvalidSignatureLength");
    const claimed = slice(sig, 32, 52);
    return FakeSigner.sign(order, claimed) === sig ? claimed : "0x00000000000000000000000000000000000bad00";
  }

  async signApproval(order: PaymentOrder): Promise<Hex> {
    this.calls.push(order);
    return FakeSigner.sign(order, this.address);
  }
}

/** Revert du contrat, porté par son nom d'erreur Solidity */
export class ContractError extends Error {
  constructor(readonly errorName: string) {
    super(`Revert ${errorName}`);
  }
}

interface Rule {
  perTxCap: bigint;
  dailyCap: bigint;
}

/**
 * Faux coffre. Par défaut il reproduit CareVault.agentPay : mêmes vérifications, dans le même ordre
 * que _checkAuth puis _checkAndConsumeLimits, et mêmes noms d'erreur. Il partage l'état du registre.
 * simulateOk / simulateRevert forcent le résultat de la simulation (tests de l'agent transaction seul).
 *
 * Non simulé : NotTransactionAgent (pas de msg.sender ici, l'appelant est toujours l'agent transaction).
 */
export class FakeVault implements VaultPort {
  static readonly TX_HASH: Hex = `0x${"ab".repeat(32)}`;
  /** Résultat forcé ; null = comportement du contrat */
  simulation: SimulationResult | null = null;
  readonly simulateCalls: PaymentOrder[] = [];
  readonly sendCalls: PaymentOrder[] = [];

  securitySigner: Hex = FakeSigner.DEFAULT_ADDRESS;
  agentsRevoked = false;
  agentsExpiry: number = Number.MAX_SAFE_INTEGER;
  /** Règles par catégorie. Absente = plafonds à 0, comme le mapping du contrat */
  readonly rules = new Map<number, Rule>();
  /** spentPerDay : clé « catégorie:jour » */
  readonly spentPerDay = new Map<string, bigint>();
  /** Paiements mis en attente de l'aidante ; l'index est le pendingId */
  readonly pending: PaymentOrder[] = [];
  readonly executed: PaymentOrder[] = [];

  constructor(readonly registry: FakeRegistry = new FakeRegistry()) {}

  get sendPayCount(): number {
    return this.sendCalls.length;
  }

  /** Simulation réussie forcée : paiement exécuté tout de suite, ou mis en attente de l'aidante */
  simulateOk(executed: boolean, pendingId: bigint = NOT_PENDING): this {
    this.simulation = { ok: true, executed, pendingId };
    return this;
  }

  /** Simulation refusée forcée avec cette erreur (ex. « UnknownProvider ») */
  simulateRevert(errorName: string): this {
    this.simulation = { ok: false, errorName };
    return this;
  }

  setRuleCents(category: number, perTxCents: number, dailyCents: number): this {
    this.rules.set(category, { perTxCap: centsToToken(perTxCents), dailyCap: centsToToken(dailyCents) });
    return this;
  }

  async simulatePay(order: PaymentOrder, securitySig: Hex): Promise<SimulationResult> {
    this.simulateCalls.push(order);
    if (this.simulation) return this.simulation;
    try {
      const r = this.agentPay(order, securitySig, false);
      return { ok: true, ...r };
    } catch (e) {
      if (e instanceof ContractError) return { ok: false, errorName: e.errorName };
      throw e;
    }
  }

  /** Comme une vraie transaction : un revert lève une ContractError */
  async sendPay(order: PaymentOrder, securitySig: Hex): Promise<Hex> {
    this.sendCalls.push(order);
    if (!this.simulation) this.agentPay(order, securitySig, true);
    return FakeVault.TX_HASH;
  }

  private agentPay(o: PaymentOrder, sig: Hex, commit: boolean): { executed: boolean; pendingId: bigint } {
    this.checkAuth(o, sig);
    this.checkAndConsumeLimits(o, commit);
    if (o.amount > this.registry.threshold) {
      const pendingId = BigInt(this.pending.length);
      if (commit) this.pending.push(o);
      return { executed: false, pendingId };
    }
    if (commit) this.executed.push(o);
    return { executed: true, pendingId: NOT_PENDING };
  }

  private checkAuth(o: PaymentOrder, sig: Hex): void {
    const now = this.registry.now;
    if (this.agentsRevoked) throw new ContractError("AgentsAreRevoked");
    if (now > this.agentsExpiry) throw new ContractError("AgentsExpired");
    if (BigInt(now) > o.deadline) throw new ContractError("ApprovalExpired");
    if (FakeSigner.recover(o, sig) !== this.securitySigner) throw new ContractError("BadSecuritySignature");
  }

  private checkAndConsumeLimits(o: PaymentOrder, commit: boolean): void {
    const now = this.registry.now;
    const p = this.registry.providers.get(o.providerId) ?? UNKNOWN_PROVIDER;
    if (!p.exists) throw new ContractError("UnknownProvider");
    if (now < p.activeAt) throw new ContractError("ProviderNotYetActive");
    if (p.category !== o.category) throw new ContractError("CategoryMismatch");
    if (this.registry.used.has(o.invoiceHash)) throw new ContractError("InvoiceAlreadyUsed");
    if (o.amount === 0n) throw new ContractError("ZeroAmount");

    const r = this.rules.get(o.category) ?? { perTxCap: 0n, dailyCap: 0n };
    if (o.amount > r.perTxCap) throw new ContractError("AboveTxCap");
    const key = `${o.category}:${Math.floor(now / DAY)}`;
    const spent = (this.spentPerDay.get(key) ?? 0n) + o.amount;
    if (spent > r.dailyCap) throw new ContractError("AboveDailyCap");

    if (commit) {
      this.registry.used.add(o.invoiceHash);
      this.spentPerDay.set(key, spent);
    }
  }
}
