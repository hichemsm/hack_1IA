import { z } from "zod";
import { BAREME } from "./rac/engine";

/** Schéma strict d'une facture : tout ce qui sort du LLM repasse par ici. */
export const InvoiceSchema = z.object({
  invoiceNo: z.string().min(1).max(64),
  providerId: z.string().regex(/^[a-z0-9-]{2,64}$/, "Identifiant de soignant invalide"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ"),
  acte: z.string().refine((a) => a in BAREME.actes, "Acte absent du barème"),
  montantCents: z.number().int().positive().max(1_000_000),
  quantite: z.number().int().positive().max(50).default(1),
  beneficiaire: z.string().min(1).max(64),
});
