import { createPublicClient, http } from "viem";
import { decodeBook } from "./market-view";
import { kuruABI } from "./spot";
import { exchangeAbi } from "./contracts";
import {
  record,
  finite,
  perplLevels,
  perplCandles,
  kuruCandles,
  kuruTrades,
  type LiveMarket,
} from "./live-market";

const PERPL = "https://app.perpl.xyz/api";
const KURU = "https://api.kuru.io/api/v2";
const MARKET = "0x065c9d28e428a0db40191a54d33d5b7c71a9c394";
const rpc = createPublicClient({
  transport: http("https://rpc.monad.xyz", { timeout: 12000, retryCount: 0 }),
});
async function json(url: string) {
  const r = await fetch(url, {
    signal: AbortSignal.timeout(12000),
    cache: "no-store",
  });
  if (!r.ok) throw new Error("Market provider unavailable");
  return r.json() as Promise<unknown>;
}
// Fixed upstreams only. Coalesce reads in each server instance to protect providers.
const cache = new Map<string, { until: number; value: Promise<unknown> }>();
function cached<T>(
  key: string,
  ttl: number,
  read: () => Promise<T>,
): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value as Promise<T>;
  const value = read().catch((error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, { until: Date.now() + ttl, value });
  return value;
}
async function perplConfig() {
  return cached("perpl-context", 60000, async () => {
    const c = record(await json(`${PERPL}/v1/pub/context`));
    if (record(c.chain).chain_id !== 143 || !Array.isArray(c.markets))
      throw new Error("Wrong market network");
    const market = c.markets.map(record).find((m) => m.id === 1);
    if (!market || market.name !== "BTC" || market.perpetual_id !== 1)
      throw new Error("Wrong Perpl market");
    const config = record(market.config);
    const price = finite(config.price_decimals),
      size = finite(config.size_decimals);
    if (
      !Number.isInteger(price) ||
      !Number.isInteger(size) ||
      price > 18 ||
      size > 18
    )
      throw new Error("Invalid precision");
    return { price, size };
  });
}
export function liveSnapshot(kind: "spot" | "perps"): Promise<LiveMarket> {
  return cached(`snapshot-${kind}`, 5000, async () => {
    if (kind === "spot") {
      if ((await rpc.getChainId()) !== 143)
        throw new Error("Wrong market network");
      const block = await rpc.getBlockNumber({ cacheTime: 0 });
      const [params, packed, header] = await Promise.all([
        rpc.readContract({
          address: MARKET,
          abi: kuruABI,
          functionName: "getMarketParams",
          blockNumber: block,
        }),
        rpc.readContract({
          address: MARKET,
          abi: kuruABI,
          functionName: "getL2Book",
          args: [16, 16],
          blockNumber: block,
        }),
        rpc.getBlock({ blockNumber: block }),
      ]);
      const book = decodeBook(packed, BigInt(params[0]), params[1]);
      if (
        book.block !== block ||
        Math.abs(Date.now() - Number(header.timestamp) * 1000) > 120000
      )
        throw new Error("Stale book");
      return {
        network: "monad-mainnet",
        source: "Kuru",
        block: String(block),
        price:
          book.bids.length && book.asks.length
            ? (book.bids[0].price + book.asks[0].price) / 2
            : null,
        bids: book.bids,
        asks: book.asks,
        observedAt: Number(header.timestamp) * 1000,
      };
    }
    const [config, depthRaw, tickerRaw] = await Promise.all([
      perplConfig(),
      json(`${PERPL}/v1/market-data/1/book`),
      json(`${PERPL}/v1/market-data/1/ticker`),
    ]);
    const depth = record(depthRaw),
      ticker = record(record(record(tickerRaw).d)["1"]);
    const at = record(depth.at),
      tickerAt = record(ticker.at);
    if ([at, tickerAt].some((a) => Math.abs(Date.now() - finite(a.t)) > 120000))
      throw new Error("Stale Perpl data");
    const previous = finite(ticker.prv),
      last = finite(ticker.lst);
    return {
      network: "monad-mainnet",
      source: "Perpl",
      block: String(finite(at.b)),
      price: finite(ticker.mrk, 1) / 10 ** config.price,
      bids: perplLevels(depth.bid, config.price, config.size, true),
      asks: perplLevels(depth.ask, config.price, config.size, false),
      observedAt: Math.min(finite(at.t), finite(tickerAt.t)),
      ...(previous > 0 ? { change24h: (last / previous - 1) * 100 } : {}),
      // dva is 24 h price × size; oi is size. Both use the market precisions.
      ...(Number.isFinite(Number(ticker.dva))
        ? { volume24h: Number(ticker.dva) / 10 ** (config.price + config.size) }
        : {}),
      ...(Number.isFinite(Number(ticker.oi))
        ? { openInterest: Number(ticker.oi) / 10 ** config.size }
        : {}),
    };
  });
}
// About six days of hourly candles, matching a trading terminal's default view.
const COUNT = 150;
const SPOT_REACH_MS = 60 * 86_400_000;
export function liveCandles(
  kind: "spot" | "perps",
  interval: "15m" | "1h" | "4h",
) {
  return cached(`candles-${kind}-${interval}`, 30000, async () => {
    const seconds = { "15m": 900, "1h": 3600, "4h": 14400 }[interval],
      end = Date.now(),
      start = end - seconds * 1000 * COUNT,
      // A quiet spot book can go days without a trade; reach back far enough
      // that the chart shows the latest real candles instead of an empty pane.
      spotStart = Math.min(start, end - SPOT_REACH_MS);
    const candles =
      kind === "spot"
        ? kuruCandles(
            await json(
              `${KURU}/${MARKET}/trades/history?countback=${COUNT}&from=${Math.floor(spotStart / 1000)}&to=${Math.floor(end / 1000)}&resolution=${interval}&isDollar=false&inMarketCap=false`,
            ),
          )
        : perplCandles(
            await json(
              `${PERPL}/v1/market-data/1/candles/${seconds}/${start}-${end}`,
            ),
            (await perplConfig()).price,
            (await perplConfig()).size,
          );
    return {
      network: "monad-mainnet",
      source: kind === "spot" ? "Kuru" : "Perpl",
      interval,
      candles: candles
        .filter(
          (c) =>
            c.time <= end &&
            c.time >= (kind === "spot" ? spotStart : start) - seconds * 1000,
        )
        .slice(-COUNT),
    };
  });
}

// Whether Kuru's MON/USDC book is still a live market. It stopped trading on 21 Oct 2026, so its
// last price and resting asks no longer say what MON is worth. Measured against MON's live price:
// the Chainlink feed behind Perpl's MON market on Monad, refused when older than 5 minutes.
const PERPL_EXCHANGE = "0x34B6552d57a35a1D042CcAe1951BD1C370112a6F";
const PERPL_MON = BigInt(10);
const STALE_AFTER_MS = 24 * 3_600_000;
const MAX_DRIFT = 0.1;

function monReference() {
  return cached("mon-reference", 15000, async () => {
    const block = await rpc.getBlock();
    const m = (await rpc.readContract({
      address: PERPL_EXCHANGE,
      abi: exchangeAbi,
      functionName: "getPerpetualInfo",
      args: [PERPL_MON],
      blockNumber: block.number,
    })) as { symbol: string; priceDecimals: bigint; oraclePNS: bigint; oracleTimestampSec: bigint };
    if (m.symbol !== "MON" || m.oraclePNS === BigInt(0) || block.timestamp - m.oracleTimestampSec > BigInt(300)) return null;
    return Number(m.oraclePNS) / 10 ** Number(m.priceDecimals);
  });
}

export function liveSpotTrades() {
  return cached("spot-trades", 5000, async () => {
    const [trades, reference] = await Promise.all([
      json(`${KURU}/markets/${MARKET}/swaps?offset=0&limit=30`).then(kuruTrades),
      monReference().catch(() => null),
    ]);
    const newest = trades[0];
    const drift = newest && reference ? Math.abs(newest.price / reference - 1) : null;
    return {
      network: "monad-mainnet",
      source: "Kuru",
      trades,
      health: {
        // No trade for a day, or a last price more than 10% off MON's live price.
        stale: !newest || Date.now() - newest.time > STALE_AFTER_MS || (drift !== null && drift > MAX_DRIFT),
        lastTradeAt: newest?.time ?? null,
        reference,
        referenceSource: reference === null ? null : "Chainlink via Perpl",
      },
    };
  });
}
