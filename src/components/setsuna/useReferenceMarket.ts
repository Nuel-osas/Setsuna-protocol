"use client";
import { useEffect, useState } from "react";
import type { TradingReading } from "./useTradingMarket";

export type ReferenceMarket = TradingReading & {
  volume24h?: number;
  openInterest?: number;
};

/** The venue's live mainnet market data. */
export function useReferenceMarket(kind: "spot" | "perps", enabled = true) {
  const [market, setMarket] = useState<ReferenceMarket>();
  useEffect(() => {
    if (!enabled) return;
    let stopped = false,
      busy = false;
    const read = async () => {
      if (busy) return;
      busy = true;
      try {
        const r = await fetch(`/api/markets/?kind=${kind}`, {
          cache: "no-store",
          signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) throw new Error();
        const data = await r.json();
        if (
          data.network !== "monad-mainnet" ||
          !Array.isArray(data.bids) ||
          !Array.isArray(data.asks) ||
          Math.abs(Date.now() - data.observedAt) > 120000
        )
          throw new Error();
        if (!stopped)
          setMarket({
            ...data,
            block: BigInt(data.block),
            price: data.price ?? undefined,
          });
      } catch {
        // Keep the last good reading; the panel shows it as a reference only.
      } finally {
        busy = false;
      }
    };
    void read();
    const timer = setInterval(read, 5000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [kind, enabled]);
  return enabled ? market : undefined;
}
