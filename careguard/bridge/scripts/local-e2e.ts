/**
 * Test de bout en bout contre anvil : les 4 agents, les vrais adaptateurs viem, le vrai CareVault.
 *
 *   Terminal A : pnpm local        (anvil + déploiement + interface/.env.local)
 *   Terminal B : pnpm test:e2e
 *
 * L'état de la chaîne est restauré à la fin (evm_snapshot / evm_revert) : le test se relance à l'identique.
 */
import { readFileSync } from "node:fs";
import {
  createTestClient, createWalletClient, erc20Abi, formatUnits, http, keccak256, parseEventLogs, toBytes,
  type Address, type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { BeneficiaryProfile, InvoiceInput, ProcessResult } from "@careguard/core";
import { createCareGuard, type CareGuardEnv } from "../src/wiring";
import { careVaultAbi } from "../src/abi";
import { aevumTestnet } from "../src/chain";

// Clé de test PUBLIQUE d'anvil, compte 0 = aidante (jamais écrite dans interface/.env.local)
const GUARDIAN_KEY: Hex = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const root = new URL("../../", import.meta.url);
const facture = (nom: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(`demo/factures/${nom}.json`, root), "utf8"));
const json = (data: unknown): InvoiceInput => ({ kind: "json", data });

const KINE = facture("kine");
const PIEGEE = facture("piegee");
/** Pharmacie à 60 € : au-dessus du seuil (50 €), sous le plafond par paiement (80 €), base = prix facturé */
const PHARMA_SEUIL = {
  invoiceNo: "E2E-PH-1", providerId: "pharmacie-centrale", date: KINE.date,
  acte: "PHARMACIE_SMR_MAJEUR", montantCents: 6000, quantite: 1, beneficiaire: "papa",
};
const profile: BeneficiaryProfile = { ald: false, medecinTraitant: true, mutuelleBrssPct: 100, exonereRetenues: false };

function loadEnv(path: URL): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name} — ${detail}`);
}
const describeTx = (r: ProcessResult) =>
  r.tx.status === "reverted" ? `reverted (${r.tx.errorName})`
  : r.tx.status === "not_sent" ? `not_sent [${r.risk.reasons.map((x) => x.code).join(", ")}]`
  : r.tx.status === "queued" ? `queued (pendingId ${r.tx.pendingId})`
  : `paid (${r.tx.txHash})`;
const tusd = (v: bigint) => `${formatUnits(v, 6)} tUSD8`;

async function main() {
  const env = loadEnv(new URL("interface/.env.local", root));
  const rpcUrl = env.AEVUM_RPC_URL ?? "";
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(rpcUrl)) {
    throw new Error(`AEVUM_RPC_URL=${rpcUrl} n'est pas local : lancez d'abord pnpm local.`);
  }
  // Pas d'ANTHROPIC_API_KEY : OfflineLlm, résultat déterministe
  const cgEnv: CareGuardEnv = {
    AEVUM_RPC_URL: rpcUrl,
    CAREVAULT_ADDRESS: env.CAREVAULT_ADDRESS,
    TX_AGENT_PRIVATE_KEY: env.TX_AGENT_PRIVATE_KEY,
    SECURITY_PRIVATE_KEY: env.SECURITY_PRIVATE_KEY,
  };
  const token = env.TUSD8_ADDRESS as Address;
  if (!token) throw new Error("TUSD8_ADDRESS manquant dans interface/.env.local");

  const { orchestrator, client, vault } = createCareGuard(cgEnv);
  const chainId = await client.getChainId();
  if (chainId !== aevumTestnet.id) throw new Error(`chain-id ${chainId}, attendu ${aevumTestnet.id} (anvil --chain-id 44005)`);

  const testClient = createTestClient({ mode: "anvil", chain: aevumTestnet, transport: http(rpcUrl) });
  const snapshot = await testClient.snapshot();

  try {
    const balanceOf = (a: Address) => client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [a] });
    const payoutOf = async (id: string) =>
      (await client.readContract({ address: vault, abi: careVaultAbi, functionName: "providers", args: [keccak256(toBytes(id))] }))[0];

    const payouts = {
      medecin: await payoutOf("medecin-martin"),
      kine: await payoutOf("kine-dupont"),
      pharmacie: await payoutOf("pharmacie-centrale"),
    };
    const before = {
      vault: await balanceOf(vault),
      medecin: await balanceOf(payouts.medecin),
      kine: await balanceOf(payouts.kine),
      pharmacie: await balanceOf(payouts.pharmacie),
    };
    console.log(`Coffre ${vault} : ${tusd(before.vault)}\n`);

    // 1. Facture normale
    const r1 = await orchestrator.process(json(KINE), { profile });
    check("kine.json → paid", r1.tx.status === "paid", describeTx(r1));

    // 2. Doublon
    const r2 = await orchestrator.process(json(KINE), { profile });
    check("kine.json à nouveau → bloquée DOUBLON",
      r2.tx.status === "not_sent" && r2.risk.reasons.some((x) => x.code === "DOUBLON"), describeTx(r2));

    // 3. Facture piégée
    const r3 = await orchestrator.process(json(PIEGEE), { profile });
    check("piegee.json → bloquée", r3.tx.status === "not_sent" && r3.risk.decision === "block", describeTx(r3));

    // 4. Orchestrateur compromis : pas de signature sécurité
    const r4 = await orchestrator.process(json(KINE), { profile, demo: "orchestrateur" });
    check("démo orchestrateur → reverted signature",
      r4.tx.status === "reverted" && r4.tx.errorName === "ECDSAInvalidSignatureLength", describeTx(r4));

    // 5. Orchestrateur + sécurité compromis : le coffre refuse le soignant inconnu
    const r5 = await orchestrator.process(json(PIEGEE), { profile, demo: "orchestrateur+securite" });
    check("démo orchestrateur+securite → reverted soignant inconnu",
      r5.tx.status === "reverted" && r5.tx.errorName === "UnknownProvider", describeTx(r5));

    // 6. Au-dessus du seuil → en attente, puis validation par l'aidante
    const r6 = await orchestrator.process(json(PHARMA_SEUIL), { profile });
    check("pharmacie 60 € → queued", r6.tx.status === "queued", describeTx(r6));

    if (r6.tx.status === "queued") {
      const guardian = privateKeyToAccount(GUARDIAN_KEY);
      const wallet = createWalletClient({ account: guardian, chain: aevumTestnet, transport: http(rpcUrl) });
      const hash = await wallet.writeContract({
        address: vault, abi: careVaultAbi, functionName: "approve", args: [r6.tx.pendingId],
        gasPrice: await client.getGasPrice(),
      });
      const receipt = await client.waitForTransactionReceipt({ hash, pollingInterval: 200 });
      const ev = parseEventLogs({ abi: careVaultAbi, logs: receipt.logs, eventName: "PaymentExecuted" })[0];
      check("approve(pendingId) par l'aidante → PaymentExecuted",
        receipt.status === "success" && !!ev && ev.args.approvedByGuardian === true
          && ev.args.amount === r6.order.amount && ev.args.payout.toLowerCase() === payouts.pharmacie.toLowerCase(),
        ev ? `${tusd(ev.args.amount)} → ${ev.args.payout}, approvedByGuardian=${ev.args.approvedByGuardian}` : `aucun event (status ${receipt.status})`);
    }

    // Soldes finaux
    const kineAmount = r1.order.amount;
    const pharmaAmount = r6.order.amount;
    const after = {
      vault: await balanceOf(vault),
      medecin: await balanceOf(payouts.medecin),
      kine: await balanceOf(payouts.kine),
      pharmacie: await balanceOf(payouts.pharmacie),
    };
    console.log("");
    check("solde du coffre", after.vault === before.vault - kineAmount - pharmaAmount,
      `${tusd(before.vault)} → ${tusd(after.vault)}`);
    check("solde kine-dupont", after.kine - before.kine === kineAmount, `+${tusd(after.kine - before.kine)}`);
    check("solde pharmacie-centrale", after.pharmacie - before.pharmacie === pharmaAmount,
      `+${tusd(after.pharmacie - before.pharmacie)}`);
    check("solde medecin-martin inchangé", after.medecin === before.medecin, `+${tusd(after.medecin - before.medecin)}`);
  } finally {
    await testClient.revert({ id: snapshot });
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} cas réussis${failed.length ? ` — échecs : ${failed.map((f) => f.name).join(" ; ")}` : ""}`);
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error("❌", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
