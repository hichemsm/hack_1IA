import { careguard, toJson } from "@/lib/careguard";
import type { BeneficiaryProfile, DemoMode, InvoiceInput } from "@careguard/core";

export const runtime = "nodejs";

interface Body {
  input: InvoiceInput;
  profile: BeneficiaryProfile;
  guardianConfirmed?: boolean;
  demo?: DemoMode;
}

/** Point d'entrée unique : la facture part vers l'orchestrateur, qui fait travailler les 3 autres agents */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const result = await careguard().orchestrator.process(body.input, {
      profile: body.profile,
      guardianConfirmed: body.guardianConfirmed,
      demo: body.demo,
    });
    return new Response(toJson(result), { headers: { "content-type": "application/json" } });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
