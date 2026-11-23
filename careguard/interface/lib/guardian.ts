"use client";

/**
 * Actions de l'AIDANTE, signées par SON wallet (MetaMask ou équivalent), jamais par un agent :
 * couper les agents, valider un paiement mis en attente par le coffre.
 * Imports directs de chain.ts et abi.ts pour ne pas embarquer le code serveur du bridge.
 */
import { createWalletClient, custom, type Address, type EIP1193Provider } from "viem";
import { aevumTestnet, publicClientFor } from "@careguard/bridge/src/chain";
import { careVaultAbi } from "@careguard/bridge/src/abi";

async function guardianWallet() {
  const eth = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
  if (!eth) throw new Error("Aucun wallet détecté. Installez MetaMask pour agir en tant qu'aidante.");
  const wallet = createWalletClient({ chain: aevumTestnet, transport: custom(eth) });
  try {
    await wallet.switchChain({ id: aevumTestnet.id });
  } catch {
    await wallet.addChain({ chain: aevumTestnet });
  }
  const [account] = await wallet.requestAddresses();
  // gasPrice explicite → transaction legacy, acceptée par Aevum
  const gasPrice = await publicClientFor().getGasPrice();
  return { wallet, account, gasPrice };
}

export async function revokeAgents(vault: Address) {
  const { wallet, account, gasPrice } = await guardianWallet();
  return wallet.writeContract({
    address: vault, abi: careVaultAbi, functionName: "revokeAgents", account, chain: aevumTestnet, gasPrice,
  });
}

export async function approvePending(vault: Address, pendingId: bigint) {
  const { wallet, account, gasPrice } = await guardianWallet();
  return wallet.writeContract({
    address: vault, abi: careVaultAbi, functionName: "approve", args: [pendingId], account, chain: aevumTestnet, gasPrice,
  });
}
