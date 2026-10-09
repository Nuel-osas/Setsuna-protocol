import type { Level } from "./market-view";

export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};
export type SpotTrade = {
  price: number;
  size: number;
  buy: boolean;
  time: number;
  hash: string;
  index: number;
};
export function kuruTrades(input: unknown): SpotTrade[] {
  const root = record(input),
    data = record(root.data).data;
  if (root.success !== true || !Array.isArray(data))
    throw new Error("Invalid trades");
  return (
    data
      .map(record)
      .filter((r) => r.isMaker === false)
      // Sub-micro-USDC dust records cannot yield a price from token amounts.
      .filter((r) => finite(r.baseAmount) > 0 && finite(r.quoteAmount) > 0)
      .map((r) => {
        if (
          r.marketAddress !== "0x065c9d28e428a0db40191a54d33d5b7c71a9c394" ||
          r.baseAsset !== "0x0000000000000000000000000000000000000000" ||
          r.quoteAsset !== "0x754704bc059f8c67012fed69bc8a327a5aafb603" ||
          r.baseDecimals !== 18 ||
          typeof r.isBuy !== "boolean" ||
          typeof r.transactionHash !== "string" ||
          !/^0x[0-9a-fA-F]{64}$/.test(r.transactionHash)
        )
          throw new Error("Wrong trade market");
        const size = finite(r.baseAmount, 1) / 1e18,
          quote = finite(r.quoteAmount, 1) / 1e6;
        const time = Date.parse(String(r.blockTimestamp));
        if (!Number.isFinite(time)) throw new Error("Invalid trade timestamp");
        return {
          price: quote / size,
          size,
          buy: r.isBuy,
          time,
          hash: r.transactionHash,
          index: finite(r.logIndex),
        };
      })
      .sort((a, b) => b.time - a.time || b.index - a.index)
      .slice(0, 30)
  );
}
export type LiveMarket = {
  network: "monad-mainnet";
  source: "Kuru" | "Perpl";
  block: string;
  price: number | null;
  bids: Level[];
  asks: Level[];
  observedAt: number;
  change24h?: number;
};
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid market response");
  return value as Record<string, unknown>;
}
export function finite(value: unknown, min = 0): number {
  if (typeof value !== "number" && typeof value !== "string")
    throw new Error("Invalid market number");
  if (value === "") throw new Error("Empty market number");
  const n = Number(value);
  if (!Number.isFinite(n) || n < min) throw new Error("Invalid market number");
  return n;
}
export function perplLevels(
  input: unknown,
  priceDecimals: number,
  sizeDecimals: number,
  bid: boolean,
): Level[] {
  if (!Array.isArray(input) || input.length > 10000)
    throw new Error("Invalid depth");
  let total = 0;
  return input
    .map(record)
    .map((r) => ({
      price: finite(r.p, 1) / 10 ** priceDecimals,
      size: finite(r.s) / 10 ** sizeDecimals,
    }))
    .filter((l) => l.size > 0)
    .sort((a, b) => (bid ? b.price - a.price : a.price - b.price))
    .map((l) => ({ ...l, total: (total += l.size) }));
}
function candle(
  time: unknown,
  o: unknown,
  h: unknown,
  l: unknown,
  c: unknown,
  scale = 1,
  timeScale = 1,
  strictRange = true,
): Candle {
  const result = {
    time: finite(time, 1) * timeScale,
    open: finite(o, Number.MIN_VALUE) / scale,
    high: finite(h, Number.MIN_VALUE) / scale,
    low: finite(l, Number.MIN_VALUE) / scale,
    close: finite(c, Number.MIN_VALUE) / scale,
  };
  if (
    result.high < result.low ||
    (strictRange &&
      (result.high < Math.max(result.open, result.close) ||
        result.low > Math.min(result.open, result.close)))
  )
    throw new Error("Invalid OHLC range");
  return result;
}
function ordered(items: Candle[]) {
  const sorted = items.sort((a, b) => a.time - b.time);
  if (sorted.some((c, i) => i > 0 && c.time === sorted[i - 1].time))
    throw new Error("Duplicate candles");
  return sorted;
}
export function perplCandles(input: unknown, decimals: number): Candle[] {
  const r = record(input);
  if (!Array.isArray(r.d)) throw new Error("Invalid candles");
  return ordered(
    r.d.map(record).map((c) => candle(c.t, c.o, c.h, c.l, c.c, 10 ** decimals)),
  );
}
export function kuruCandles(input: unknown): Candle[] {
  const root = record(input);
  if (root.success !== true) throw new Error("Kuru history unavailable");
  const r = record(record(root.data).data);
  if (r.s === "no_data") return [];
  const keys = ["t", "o", "h", "l", "c"] as const;
  if (r.s !== "ok" || keys.some((k) => !Array.isArray(r[k])))
    throw new Error("Invalid candles");
  const arrays = keys.map((k) => r[k] as unknown[]);
  if (arrays.some((a) => a.length !== arrays[0].length))
    throw new Error("Truncated candles");
  return ordered(
    arrays[0].map((t, i) =>
      candle(
        t,
        arrays[1][i],
        arrays[2][i],
        arrays[3][i],
        arrays[4][i],
        1,
        1000,
        false,
      ),
    ),
  );
}
