import type { Address, Hex } from "viem";
import {
  AmountsAgent, ClaudeLlm, InMemoryHistory, OfflineLlm, Orchestrator, SecurityAgent, TransactionAgent,
  type LlmPort,
} from "@careguard/core";
import { approvalSigner, registryAdapter, vaultAdapter } from "./adapters";
import { publicClientFor } from "./chain";

export interface CareGuardEnv {
  AEVUM_RPC_URL?: string;
  CAREVAULT_ADDRESS?: string;
  TX_AGENT_PRIVATE_KEY?: string;
  SECURITY_PRIVATE_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  LLM_MODEL?: string;
}

/**
 * Le point qui relie tout : il crée les 4 agents du core, leur donne chacun
 * leurs propres clés et accès à la chaîne, et renvoie l'orchestrateur à l'interface.
 */
export function createCareGuard(env: CareGuardEnv = process.env as CareGuardEnv) {
  const rpcUrl = env.AEVUM_RPC_URL ?? "https://rpc-test.qday.info";
  const vault = required(env.CAREVAULT_ADDRESS, "CAREVAULT_ADDRESS") as Address;
  const txKey = required(env.TX_AGENT_PRIVATE_KEY, "TX_AGENT_PRIVATE_KEY") as Hex;
  const secKey = required(env.SECURITY_PRIVATE_KEY, "SECURITY_PRIVATE_KEY") as Hex;
  if (txKey.toLowerCase() === secKey.toLowerCase()) {
    throw new Error("Les agents transaction et sécurité doivent avoir deux clés différentes.");
  }

  const client = publicClientFor(rpcUrl);
  const llm: LlmPort = env.ANTHROPIC_API_KEY ? new ClaudeLlm(env.ANTHROPIC_API_KEY, env.LLM_MODEL) : new OfflineLlm();
  const history = new InMemoryHistory();

  const amounts = new AmountsAgent();
  const security = new SecurityAgent({
    registry: registryAdapter(client, vault),
    signer: approvalSigner(secKey, vault),
    llm,
    history,
  });
  const transaction = new TransactionAgent(vaultAdapter(client, vault, txKey, rpcUrl));
  const orchestrator = new Orchestrator({ llm, amounts, security, transaction, history });

  return { orchestrator, amounts, client, vault, llmMode: env.ANTHROPIC_API_KEY ? "claude" : "hors ligne" };
}

function required(v: string | undefined, name: string): string {
  if (!v) throw new Error(`Variable d'environnement manquante : ${name}`);
  return v;
}
