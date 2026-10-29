import { getAddress, type Address, type Hex } from "viem";

/**
 * Swaps on Monad through the KyberSwap aggregator: it splits a trade across Uniswap v4, Curve,
 * Balancer and other pools for the best price. The user signs the router call from their own
 * wallet; Setsuna takes 0.1% of the amount in, paid by the router to the treasury.
 */
const API = "https://aggregator-api.kyberswap.com/monad/api/v1";
const CLIENT = "setsuna";
/** KyberSwap's MetaAggregationRouterV2 on Monad. A built route for any other address is refused. */
export const SWAP_ROUTER: Address = "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5";
export const SWAP_FEE_BPS = 10;
const TREASURY: Address = "0x6915aEf0947F4daD61aeF39Fe0f546A03190c92C";
export const SWAP_SLIPPAGE_BPS = 50;

export type SwapToken = "MON" | "USDC" | "AUSD";
export const SWAP_TOKENS: Record<SwapToken, { address: Address; decimals: number; native?: true }> = {
  MON: { address: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", decimals: 18, native: true },
  USDC: { address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", decimals: 6 },
  AUSD: { address: "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a", decimals: 6 },
};

export type SwapQuote = {
  from: SwapToken;
  to: SwapToken;
  amountIn: bigint;
  amountOut: bigint;
  minOut: bigint;
  fee: bigint;
  /** Pools the route goes through, for display. */
  venues: string[];
  routeSummary: unknown;
  at: number;
};

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "x-client-id": CLIENT, ...(init?.headers ?? {}) } });
  const body = (await res.json().catch(() => null)) as { data?: T; message?: string } | null;
  if (!res.ok || !body?.data) throw new Error(body?.message ? `Swap route: ${body.message}` : "No swap route right now. Try another amount.");
  return body.data;
}

const pretty = (exchange: string) =>
  exchange
    .replace(/-v(\d)/i, " v$1")
    .replace(/-stable(-ng)?/i, "")
    .replace(/fairflow|-/gi, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());

export async function quoteSwap(from: SwapToken, to: SwapToken, amountIn: bigint): Promise<SwapQuote> {
  const q = new URLSearchParams({
    tokenIn: SWAP_TOKENS[from].address,
    tokenOut: SWAP_TOKENS[to].address,
    amountIn: amountIn.toString(),
    feeAmount: String(SWAP_FEE_BPS),
    chargeFeeBy: "currency_in",
    isInBps: "true",
    feeReceiver: TREASURY,
  });
  const data = await call<{
    routeSummary: { amountOut: string; route: { exchange: string }[][] };
    routerAddress: string;
  }>(`${API}/routes?${q}`);
  if (getAddress(data.routerAddress) !== SWAP_ROUTER) throw new Error("Unexpected swap router. Swap disabled.");
  const amountOut = BigInt(data.routeSummary.amountOut);
  return {
    from,
    to,
    amountIn,
    amountOut,
    minOut: amountOut - (amountOut * BigInt(SWAP_SLIPPAGE_BPS)) / BigInt(10_000),
    fee: (amountIn * BigInt(SWAP_FEE_BPS)) / BigInt(10_000),
    venues: [...new Set(data.routeSummary.route.flat().map((s) => pretty(s.exchange)))],
    routeSummary: data.routeSummary,
    at: Date.now(),
  };
}

/** The router call for a quote, sent from and paid to `account`. */
export async function buildSwap(quote: SwapQuote, account: Address): Promise<{ to: Address; data: Hex; value: bigint }> {
  const data = await call<{ data: Hex; routerAddress: string; amountOut: string }>(`${API}/route/build`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      routeSummary: quote.routeSummary,
      sender: account,
      recipient: account,
      slippageTolerance: SWAP_SLIPPAGE_BPS,
      source: CLIENT,
    }),
  });
  if (getAddress(data.routerAddress) !== SWAP_ROUTER) throw new Error("Unexpected swap router. Swap disabled.");
  return { to: SWAP_ROUTER, data: data.data, value: SWAP_TOKENS[quote.from].native ? quote.amountIn : BigInt(0) };
}
