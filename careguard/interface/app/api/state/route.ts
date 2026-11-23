import { erc20Abi, type Address } from "viem";
import { BAREME } from "@careguard/core";
import { TUSD8_ADDRESS } from "@careguard/bridge";
import { careguard, toJson } from "@/lib/careguard";
import { store } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tout ce que l'écran affiche : droits, plafonds, solde du coffre, transactions récentes */
export async function GET() {
  const cg = careguard();
  let coffre: bigint | null = null;
  try {
    coffre = await cg.client.readContract({
      address: (process.env.TUSD8_ADDRESS as Address | undefined) ?? TUSD8_ADDRESS,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [cg.vault],
    });
  } catch {
    coffre = null; // RPC indisponible : l'écran affiche un tiret
  }

  const body = {
    beneficiaire: store.beneficiaire,
    profile: store.profile,
    counters: cg.amounts.snapshot(),
    plafonds: {
      participationsCents: BAREME.retenues.plafondAnnuelParticipationsCents,
      franchisesCents: BAREME.retenues.plafondAnnuelFranchisesCents,
    },
    coffre,
    txs: [...store.txs].reverse().slice(0, 10),
    vault: cg.vault,
    llmMode: cg.llmMode,
  };
  return new Response(toJson(body), { headers: { "content-type": "application/json" } });
}
