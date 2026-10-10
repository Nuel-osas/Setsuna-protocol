"use client";
import { useEffect, useState } from "react";
import {
  cachedEarnSummary,
  earnSummaryKey,
  readEarnSummary,
  type EarnSummary,
  type SummaryAsset,
} from "@/lib/setsuna/earn-summary";
import { useWallet } from "./WalletProvider";

export function useEarnSummary(asset: SummaryAsset) {
  const { deployment: d } = useWallet();
  const key = d ? earnSummaryKey(d, asset) : "";
  const [state, setState] = useState<{
    key: string;
    data?: EarnSummary;
    failed?: boolean;
  }>();
  useEffect(() => {
    if (!d || !(asset === "MON" ? d.earnMON : d.earnUSDC)) return;
    let cancelled = false,
      running = false;
    const load = async () => {
      if (running) return;
      running = true;
      try {
        const data = await readEarnSummary(d, asset);
        if (!cancelled) setState({ key, data });
      } catch {
        if (!cancelled) setState({ key, failed: true });
      } finally {
        running = false;
      }
    };
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [d, asset, key]);
  const current = state?.key === key ? state : undefined;
  return current ?? { key, data: d ? cachedEarnSummary(d, asset) : undefined };
}
