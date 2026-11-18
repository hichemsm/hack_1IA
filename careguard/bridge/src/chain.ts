import { createPublicClient, defineChain, http, type AbiEvent, type Address, type PublicClient } from "viem";

/** QDay Aevum testnet — EVM Shanghai, pas de WebSocket, eth_getLogs limité à 1 000 blocs */
export const aevumTestnet = defineChain({
  id: 44005,
  name: "QDay Aevum Testnet",
  nativeCurrency: { name: "tQDAY", symbol: "tQDAY", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc-test.qday.info"] } },
  blockExplorers: { default: { name: "Aevum Explorer", url: "https://explorer-test.qday.info" } },
  testnet: true,
});

export const TUSD8_ADDRESS: Address = "0x456569838f1d43009A91ebA4263147Afd7233483";

export function publicClientFor(rpcUrl: string = aevumTestnet.rpcUrls.default.http[0]): PublicClient {
  return createPublicClient({ chain: aevumTestnet, transport: http(rpcUrl), pollingInterval: 2_000 });
}

/** eth_getLogs par tranches de 1 000 blocs (limite du RPC Aevum) */
export async function getLogsChunked<E extends AbiEvent>(
  client: PublicClient,
  params: { address: Address; event: E; fromBlock: bigint; toBlock?: bigint },
  chunk = 1_000n,
) {
  const to = params.toBlock ?? (await client.getBlockNumber());
  const out = [];
  for (let start = params.fromBlock; start <= to; start += chunk) {
    const end = start + chunk - 1n > to ? to : start + chunk - 1n;
    out.push(...(await client.getLogs({ address: params.address, event: params.event, fromBlock: start, toBlock: end })));
  }
  return out;
}

export const explorerTx = (hash: string) => `${aevumTestnet.blockExplorers.default.url}/tx/${hash}`;
