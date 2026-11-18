import {
  BaseError, ContractFunctionRevertedError, createWalletClient, http,
  type Address, type Hex, type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { ApprovalSigner, PaymentOrder, RegistryPort, VaultPort } from "@careguard/core";
import { approvalTypes, careVaultAbi } from "./abi";
import { aevumTestnet } from "./chain";

/** Lecture de l'état du coffre — donnée à l'agent sécurité */
export function registryAdapter(client: PublicClient, vault: Address): RegistryPort {
  return {
    async getProvider(providerId) {
      const [payout, category, sector, activeAt, exists] = await client.readContract({
        address: vault, abi: careVaultAbi, functionName: "providers", args: [providerId],
      });
      return { payout, category, sector, activeAt: Number(activeAt), exists };
    },
    isInvoiceUsed: (h) => client.readContract({ address: vault, abi: careVaultAbi, functionName: "invoiceUsed", args: [h] }),
    approvalThreshold: () => client.readContract({ address: vault, abi: careVaultAbi, functionName: "approvalThreshold" }),
    nowSeconds: async () => Number((await client.getBlock()).timestamp),
  };
}

/** Clé de l'agent sécurité : signe des accords EIP-712, ne détient pas de quoi payer le gas */
export function approvalSigner(privateKey: Hex, vault: Address): ApprovalSigner {
  const account = privateKeyToAccount(privateKey);
  return {
    address: account.address,
    signApproval: (o: PaymentOrder) =>
      account.signTypedData({
        domain: { name: "CareGuard", version: "1", chainId: aevumTestnet.id, verifyingContract: vault },
        types: approvalTypes,
        primaryType: "SecurityApproval",
        message: {
          invoiceHash: o.invoiceHash, providerId: o.providerId, category: o.category,
          amount: o.amount, deadline: o.deadline,
        },
      }),
  };
}

/** Clé de l'agent transaction : la seule autorisée à appeler agentPay */
export function vaultAdapter(client: PublicClient, vault: Address, privateKey: Hex, rpcUrl: string): VaultPort {
  const account = privateKeyToAccount(privateKey);
  const wallet = createWalletClient({ account, chain: aevumTestnet, transport: http(rpcUrl) });

  return {
    async simulatePay(order, sig) {
      try {
        const { result } = await client.simulateContract({
          address: vault, abi: careVaultAbi, functionName: "agentPay", args: [order, sig], account,
        });
        return { ok: true, executed: result[0], pendingId: result[1] };
      } catch (e) {
        return { ok: false, errorName: revertName(e) };
      }
    },
    async sendPay(order, sig) {
      // gasPrice explicite → transaction legacy (type 0), comme le faucet QDay
      const gasPrice = await client.getGasPrice();
      const hash = await wallet.writeContract({
        address: vault, abi: careVaultAbi, functionName: "agentPay", args: [order, sig], gasPrice,
      });
      await client.waitForTransactionReceipt({ hash, pollingInterval: 2_000 });
      return hash;
    },
  };
}

export function revertName(e: unknown): string {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (r instanceof ContractFunctionRevertedError) return r.data?.errorName ?? r.reason ?? "Inconnu";
  }
  return "Inconnu";
}
