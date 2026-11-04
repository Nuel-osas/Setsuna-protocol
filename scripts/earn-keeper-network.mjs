import { createPublicClient, fallback, http } from "viem";
import { monad } from "viem/chains";

// Monad's public RPCs. Any one can rate-limit or time out; a run moves to the next instead of
// failing. Each answers chain ID 143 and supports eth_call state overrides (checked 2026-11-04).
const PUBLIC_RPCS = [
  "https://rpc2.monad.xyz",
  "https://rpc.monad.xyz",
  "https://rpc1.monad.xyz",
  "https://rpc3.monad.xyz",
];

/** The configured endpoint first (MONAD_RPC_URL or --rpc), then the public ones, without repeats. */
export function rpcList(rpc) {
  const extra = (process.env.MONAD_RPC_URLS ?? "").split(",").map((u) => u.trim()).filter(Boolean);
  return [...new Set([rpc, ...extra, ...PUBLIC_RPCS].filter(Boolean))];
}

/** One transport for reads and broadcasts: each endpoint retried twice, then the next. */
export function keeperTransport(rpc) {
  return fallback(rpcList(rpc).map((url) => http(url, { timeout: 15_000, retryCount: 2, retryDelay: 400 })));
}

/** Keepers execute only on Monad mainnet. */
export async function keeperNetwork({ rpc, manifest }) {
  if (manifest !== undefined)
    throw new Error("Demo manifests are no longer supported");
  const client = createPublicClient({ transport: keeperTransport(rpc) });
  const chainId = await client.getChainId();
  if (chainId !== 143) throw new Error("RPC must report Monad chain ID 143");
  return { client, chain: monad, chainId };
}
