import {
  createPublicClient,
  defineChain,
  http,
  type HttpTransport,
} from "viem";
import type { Deployment } from "./types";

export const chainFor = (d: Deployment) =>
  defineChain({
    id: d.chainId,
    name: d.name,
    nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [d.rpc] } },
  });

/**
 * An endpoint's chain ID cannot change, so every reader's network check after
 * the first is answered from memory instead of costing a sequential round trip.
 * A failed lookup is not remembered.
 */
const rememberChainId =
  (transport: HttpTransport): HttpTransport =>
  (config) => {
    const inner = transport(config);
    let chainId: Promise<unknown> | undefined;
    return {
      ...inner,
      request: (args) => {
        if (args.method !== "eth_chainId") return inner.request(args);
        chainId ??= inner.request(args).catch((error) => {
          chainId = undefined;
          throw error;
        });
        return chainId;
      },
    } as ReturnType<HttpTransport>;
  };

const makeClient = (d: Deployment) =>
  createPublicClient({
    chain: chainFor(d),
    transport: rememberChainId(
      http(d.rpc, {
        timeout: 12_000,
        retryCount: 0,
        // The restricted demo gateway accepts at most 20 JSON-RPC calls per request.
        // This changes transport only: eth_call is still executed at its requested block.
        batch: { batchSize: 20, wait: 10 },
      }),
    ),
  });
const clients = new Map<string, ReturnType<typeof makeClient>>();
export function clientFor(d: Deployment) {
  const key = `${d.chainId}:${d.rpc}`;
  let client = clients.get(key);
  if (!client) {
    client = makeClient(d);
    clients.set(key, client);
    if (clients.size > 16) clients.delete(clients.keys().next().value!);
  }
  return client;
}
