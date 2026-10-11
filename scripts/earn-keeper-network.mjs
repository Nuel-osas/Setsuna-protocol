import { createPublicClient, http } from "viem";
import { monad } from "viem/chains";

/** Keepers execute only on the configured Monad mainnet RPC. */
export async function keeperNetwork({ rpc, manifest }) {
  if (manifest !== undefined)
    throw new Error("Demo manifests are no longer supported");
  const client = createPublicClient({
    transport: http(rpc, { timeout: 15000, retryCount: 0 }),
  });
  const chainId = await client.getChainId();
  if (chainId !== 143) throw new Error("RPC must report Monad chain ID 143");
  return { client, chain: monad, chainId };
}
