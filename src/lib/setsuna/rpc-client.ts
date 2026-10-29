import {
  createPublicClient,
  defineChain,
  fallback,
  http,
  type HttpTransportConfig,
  type Transport,
} from "viem";
import type { Deployment } from "./types";

export const chainFor = (d: Deployment) =>
  defineChain({
    id: d.chainId,
    name: d.name,
    nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [d.rpc] } },
    // Monad mainnet's public endpoints count every call against a per-second
    // limit, so concurrent reads are folded into Multicall3 there.
    ...(d.chainId === 143
      ? {
          contracts: {
            multicall3: {
              address: "0xcA11bde05977b3631167028862bE2a173976CA11" as const,
            },
          },
        }
      : {}),
  });

/**
 * An endpoint's chain ID cannot change, so every reader's network check after
 * the first is answered from memory instead of costing a sequential round trip.
 * A failed lookup is not remembered.
 */
/**
 * Monad mainnet's public endpoints, in order. rpc2 first: it serves archive reads and wide log
 * ranges. A phone on a shared carrier IP can be refused by one endpoint's per-IP limit, so the
 * browser moves on to the next instead of failing the whole page.
 */
const MAINNET_FALLBACKS = [
  "https://rpc1.monad.xyz",
  "https://rpc.monad.xyz",
  "https://rpc3.monad.xyz",
];

export function rpcTransport(
  d: Deployment,
  config: HttpTransportConfig = {},
): Transport {
  const urls =
    d.chainId === 143
      ? [d.rpc, ...MAINNET_FALLBACKS.filter((u) => u !== d.rpc)]
      : [d.rpc];
  const transports = urls.map((url) =>
    http(url, { timeout: 12_000, ...config, retryCount: 1 }),
  );
  return transports.length === 1
    ? transports[0]
    : fallback(transports, { retryCount: 1 });
}

const rememberChainId =
  (transport: Transport): Transport =>
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
    } as ReturnType<Transport>;
  };

const makeClient = (d: Deployment) =>
  createPublicClient({
    chain: chainFor(d),
    ...(d.chainId === 143 ? { batch: { multicall: { wait: 16 } } } : {}),
    transport: rememberChainId(
      rpcTransport(d, {
        // Keep RPC batches bounded for public endpoint compatibility.
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
