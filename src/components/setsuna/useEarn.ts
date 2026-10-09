"use client";
import { useEffect, useState } from "react";
import type { EarnSnapshot } from "@/lib/setsuna/earn";

/** Live destination rates and Setsuna's target split, refreshed every minute. */
export function useEarn() {
  const [data, setData] = useState<EarnSnapshot>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/earn/", { cache: "no-store" })
        .then((r) => r.json())
        .then((j: EarnSnapshot) => alive && (setData(j), setFailed(!j.destinations?.length)))
        .catch(() => alive && setFailed(true));
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return { data, failed };
}

export const pct = (f: number, d = 2) => `${(f * 100).toFixed(d)}%`;
export const usd = (n: number) =>
  n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}K` : `$${n.toFixed(0)}`;
