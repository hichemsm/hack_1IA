import { encodeAbiParameters, keccak256, toBytes, type Hex } from "viem";
import { BAREME } from "./rac/engine";
import type { Invoice } from "./types";

/** Identifiant on-chain d'un soignant : keccak256 de son identifiant texte */
export const providerIdHash = (providerId: string): Hex => keccak256(toBytes(providerId));

/**
 * Empreinte d'une facture : n° + soignant + date + montant.
 * Aucune donnée de santé (acte, bénéficiaire) n'entre dans le hash publié on-chain.
 */
export const invoiceHash = (inv: Invoice): Hex =>
  keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "string" }, { type: "string" }, { type: "uint256" }],
      [inv.invoiceNo, inv.providerId, inv.date, BigInt(inv.montantCents)],
    ),
  );

/** Empreinte de la version du barème, citée dans chaque paiement */
export const baremeHash: Hex = keccak256(toBytes(JSON.stringify(BAREME)));

/** Centimes d'euro → unités tUSD8 (6 décimales) */
export const centsToToken = (cents: number): bigint => BigInt(Math.round(cents)) * 10_000n;

export const formatEuros = (cents: number): string =>
  (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
