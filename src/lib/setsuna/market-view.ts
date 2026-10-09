import type { Hex } from "viem";

export type Level = { price: number; size: number; total: number };
export type Observation = { time: number; price: number };

/** Kuru's packed L2 format: block, bid price/size pairs, zero, ask pairs.
 * Prices and sizes use the market's own precisions, not token decimals.
 * Only resting CLOB orders are returned; AMM liquidity is not included.
 * Format verified against Kuru-Labs/kuru-sdk/src/market/orderBook.ts.
 */
export function decodeBook(
  data: Hex,
  pricePrecision: bigint,
  sizePrecision: bigint,
) {
  if (
    pricePrecision <= BigInt(0) ||
    sizePrecision <= BigInt(0) ||
    (data.length - 2) % 64 !== 0 ||
    data.length < 130
  )
    throw new Error("Invalid order book");
  const words = data
    .slice(2)
    .match(/.{64}/g)!
    .map((w) => BigInt(`0x${w}`));
  const sides: { price: number; size: number }[][] = [[], []];
  let side = 0;
  for (let i = 1; i < words.length && side < 2; i++) {
    const price = words[i];
    if (price === BigInt(0)) {
      side++;
      continue;
    }
    const size = words[++i];
    if (size === undefined) throw new Error("Truncated order book");
    if (size > BigInt(0))
      sides[side].push({
        price: Number(price) / Number(pricePrecision),
        size: Number(size) / Number(sizePrecision),
      });
  }
  if (side === 0) throw new Error("Missing order book side delimiter");
  const levels = (
    items: (typeof sides)[number],
    descending: boolean,
  ): Level[] => {
    let total = 0;
    return items
      .sort((a, b) => (descending ? b.price - a.price : a.price - b.price))
      .map((item) => ({ ...item, total: (total += item.size) }));
  };
  return {
    block: words[0],
    bids: levels(sides[0], true),
    asks: levels(sides[1], false),
  };
}

export const marketNumber = (value?: number, digits = 6) =>
  value === undefined || !Number.isFinite(value)
    ? "—"
    : value.toLocaleString("en-US", {
        maximumFractionDigits: digits,
        minimumFractionDigits: value < 1 ? Math.min(5, digits) : 0,
      });
export const compactNumber = (value: number) =>
  value.toLocaleString("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  });
