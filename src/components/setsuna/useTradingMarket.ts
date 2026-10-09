"use client";
import { useEffect, useState } from "react";
import { createPublicClient, http, formatUnits } from "viem";
import { useWallet } from "./WalletProvider";
import { exchangeAbi } from "@/lib/setsuna/contracts";
import { kuruABI } from "@/lib/setsuna/spot";
import type { Market } from "@/lib/setsuna/types";
import {
  decodeBook,
  type Level,
  type Observation,
} from "@/lib/setsuna/market-view";

export type TradingReading = {
  network?: "monad-mainnet";
  change24h?: number;
  block: bigint;
  price?: number;
  bids: Level[];
  asks: Level[];
  observedAt: number;
};
export function useTradingMarket(kind: "spot" | "perps") {
  const { deployment: d } = useWallet();
  const [reading, setReading] = useState<TradingReading>();
  const [observations, setObservations] = useState<Observation[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false,
      inFlight = false;
    setReading(undefined);
    setObservations([]);
    setError("");
    if (!d || (d.mode !== "preview" && kind === "spot" && !d.spot)) return;
    const c = createPublicClient({
      transport: http(d.rpc, { timeout: 12000, retryCount: 0 }),
    });
    const update = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        let next: TradingReading;
        if (d.mode === "preview") {
          const response = await fetch(`/api/markets/?kind=${kind}`, {
            cache: "no-store",
            signal: AbortSignal.timeout(20000),
          });
          if (!response.ok) throw new Error("Live feed unavailable");
          const data = await response.json();
          if (
            data.network !== "monad-mainnet" ||
            !Array.isArray(data.bids) ||
            !Array.isArray(data.asks) ||
            Math.abs(Date.now() - data.observedAt) > 120000
          )
            throw new Error("Invalid live feed");
          next = {
            ...data,
            block: BigInt(data.block),
            price: data.price ?? undefined,
          };
        } else {
          if ((await c.getChainId()) !== d.chainId)
            throw new Error("Wrong network");
          const block = await c.getBlockNumber({ cacheTime: 0 });
          if (kind === "spot" && d.spot) {
            const [params, packed] = await Promise.all([
              c.readContract({
                address: d.spot.market,
                abi: kuruABI,
                functionName: "getMarketParams",
                blockNumber: block,
              }),
              c.readContract({
                address: d.spot.market,
                abi: kuruABI,
                functionName: "getL2Book",
                args: [16, 16],
                blockNumber: block,
              }),
            ]);
            const book = decodeBook(packed, BigInt(params[0]), params[1]);
            if (book.block !== block)
              throw new Error("Order book block mismatch");
            const price =
              book.bids.length && book.asks.length
                ? (book.bids[0].price + book.asks[0].price) / 2
                : undefined;
            next = { ...book, price, observedAt: Date.now() };
          } else {
            const market = (await c.readContract({
              address: d.exchange,
              abi: exchangeAbi,
              functionName: "getPerpetualInfo",
              args: [BigInt(d.perpId)],
              blockNumber: block,
            })) as Market;
            const price = Number(
              formatUnits(market.markPNS, Number(market.priceDecimals)),
            );
            if (!Number.isFinite(price) || price <= 0)
              throw new Error("Invalid mark");
            next = { block, price, bids: [], asks: [], observedAt: Date.now() };
          }
        }
        if (cancelled) return;
        setReading(next);
        setError("");
        if (next.price !== undefined)
          setObservations((prev) =>
            [...prev, { time: next.observedAt, price: next.price! }].slice(
              -180,
            ),
          );
      } catch {
        if (!cancelled) {
          setReading(undefined);
          setError("Market data unavailable. Reconnecting…");
        }
      } finally {
        inFlight = false;
      }
    };
    void update();
    const timer = setInterval(() => void update(), 8000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [d, kind]);
  return { reading, observations, error };
}
