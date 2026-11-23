import { BAREME } from "@careguard/core";
import { careguard } from "@/lib/careguard";
import { store } from "@/lib/store";

export const runtime = "nodejs";

/**
 * Questions libres de l'aidante. LECTURE SEULE : cette route n'a accès à aucune
 * fonction de paiement. Un paiement ne part que d'une facture déposée,
 * une validation que d'un clic sur un bouton.
 */
export async function POST(req: Request) {
  try {
    const { question } = (await req.json()) as { question?: string };
    if (!question?.trim()) return Response.json({ error: "Écrivez une question." }, { status: 400 });

    const cg = careguard();
    const facts = {
      beneficiaire: store.beneficiaire,
      profil: store.profile,
      plafonds: {
        franchises: { deja: cg.amounts.snapshot().franchisesCents, max: BAREME.retenues.plafondAnnuelFranchisesCents },
        participations: { deja: cg.amounts.snapshot().participationsCents, max: BAREME.retenues.plafondAnnuelParticipationsCents },
      },
      transactions: store.txs.slice(-10).map((t) => ({ acte: t.label, montantCents: t.montantCents, statut: t.status, date: t.at })),
      bareme: { version: BAREME.version, actes: Object.values(BAREME.actes).map((a) => a.libelle) },
    };

    const answer = await cg.assistant.answer(question.slice(0, 1000), facts);
    return Response.json({ answer });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
