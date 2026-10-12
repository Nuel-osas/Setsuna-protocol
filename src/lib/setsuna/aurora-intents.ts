/**
 * Aurora Intents deposits (settled through NEAR Intents): a user sends any
 * supported asset on any supported chain to a one-time deposit address, and
 * the matching asset arrives in their Monad wallet. The app key is public by
 * design; Aurora's docs say it is safe in a website.
 */
const BASE = "https://intents-api.aurora.dev/api";
export const auroraKey = process.env.NEXT_PUBLIC_AURORA_INTENTS_KEY ?? "";

/** Monad assets the Earn vaults accept, as Intents asset IDs. */
export const monadAsset = {
  USDC: "nep245:v2_1.omni.hot.tg:143_2dmLwYWkCQKyTjeUPAsGJuiVLbFx",
  MON: "nep245:v2_1.omni.hot.tg:143_11111111111111111111",
} as const;

export type IntentToken = {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price?: number;
};

/** Source chains whose refund address can default to the user's EVM address. */
export const evmChains = new Set([
  "eth",
  "base",
  "arb",
  "op",
  "pol",
  "bsc",
  "avax",
  "gnosis",
  "scroll",
  "bera",
  "abs",
  "plasma",
  "xlayer",
]);

export const chainName: Record<string, string> = {
  eth: "Ethereum",
  base: "Base",
  arb: "Arbitrum",
  op: "Optimism",
  pol: "Polygon",
  bsc: "BNB Chain",
  avax: "Avalanche",
  sol: "Solana",
  btc: "Bitcoin",
  tron: "Tron",
  near: "NEAR",
  sui: "Sui",
  ton: "TON",
  aptos: "Aptos",
  xrp: "XRP Ledger",
  doge: "Dogecoin",
  ltc: "Litecoin",
  zec: "Zcash",
};

// The routes most people will arrive with, in display order.
const preferred = [
  ["USDC", "base"],
  ["USDC", "arb"],
  ["USDC", "eth"],
  ["USDC", "sol"],
  ["USDC", "op"],
  ["USDC", "pol"],
  ["USDT", "eth"],
  ["USDT", "tron"],
  ["USDT", "arb"],
  ["ETH", "eth"],
  ["ETH", "base"],
  ["ETH", "arb"],
  ["SOL", "sol"],
  ["BTC", "btc"],
  ["NEAR", "near"],
] as const;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(
      typeof body?.message === "string"
        ? body.message
        : `Aurora Intents request failed (${res.status})`,
    );
  return body as T;
}

/** Supported origin tokens, limited to the common routes, in a stable order. */
export async function sourceTokens(): Promise<IntentToken[]> {
  const body = await call<{ tokens: IntentToken[] } | IntentToken[]>(
    `/tokens/${auroraKey}`,
  );
  const tokens = Array.isArray(body) ? body : body.tokens;
  return preferred.flatMap(([symbol, chain]) => {
    const t = tokens.find((x) => x.symbol === symbol && x.blockchain === chain);
    return t ? [t] : [];
  });
}

export type IntentQuote = {
  depositAddress?: string;
  amountIn: string;
  amountInFormatted: string;
  amountOut: string;
  amountOutFormatted: string;
  minAmountOut: string;
  timeEstimate?: number;
  deadline?: string;
};

export async function quote({
  origin,
  destination,
  amount,
  recipient,
  refundTo,
  dry,
}: {
  origin: IntentToken;
  destination: string;
  amount: bigint;
  recipient: string;
  refundTo: string;
  dry: boolean;
}) {
  const deadline = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const body = await call<{ quote: IntentQuote }>(`/quote/${auroraKey}`, {
    method: "POST",
    body: JSON.stringify({
      dry,
      swapType: "EXACT_INPUT",
      slippageTolerance: 100,
      originAsset: origin.assetId,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: destination,
      amount: amount.toString(),
      recipient,
      recipientType: "DESTINATION_CHAIN",
      refundTo,
      refundType: "ORIGIN_CHAIN",
      deadline,
    }),
  });
  return { ...body.quote, deadline: body.quote.deadline ?? deadline };
}

export type IntentStatus =
  | "PENDING_DEPOSIT"
  | "KNOWN_DEPOSIT_TX"
  | "PROCESSING"
  | "SUCCESS"
  | "INCOMPLETE_DEPOSIT"
  | "REFUNDED"
  | "FAILED";

export type IntentTransfer = {
  depositAddress: string;
  status: IntentStatus;
  amountOutFormatted?: string;
  destinationChainTxHashes?: { hash: string }[] | string[];
  refundReason?: string;
};

/** The transfer for one deposit address, if Aurora has seen it yet. */
export async function transferFor(wallet: string, depositAddress: string) {
  // The docs show { data: [...] }; the live API returns a bare array.
  const body = await call<{ data: IntentTransfer[] } | IntentTransfer[]>(
    `/transactions/${auroraKey}?walletAddress=${wallet}`,
  );
  const list = Array.isArray(body) ? body : (body.data ?? []);
  return list.find(
    (t) => t.depositAddress?.toLowerCase() === depositAddress.toLowerCase(),
  );
}

export const finished = (s?: IntentStatus) =>
  s === "SUCCESS" || s === "REFUNDED" || s === "FAILED";
