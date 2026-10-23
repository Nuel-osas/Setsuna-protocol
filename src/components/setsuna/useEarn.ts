"use client";
import { useEffect, useState } from "react";
import type { EarnSnapshot } from "@/lib/setsuna/earn";

// One fetch and one minute timer shared by every component on the page; each
// used to poll /api/earn on its own, so a page with several fired several requests.
type EarnState = { data?: EarnSnapshot; failed: boolean };
let state: EarnState = { failed: false };
const listeners = new Set<(s: EarnState) => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function load() {
  fetch("/api/earn/", { cache: "no-store" })
    .then((r) => r.json())
    .then((j: EarnSnapshot) => publish({ data: j, failed: !j.destinations?.length }))
    .catch(() => publish({ ...state, failed: true }));
}
function publish(next: EarnState) {
  state = next;
  listeners.forEach((l) => l(state));
}

/** Start from the snapshot the server put in the page; the minute timer refreshes it. */
export function seedEarn(snapshot: EarnSnapshot, force = false) {
  if (force || !state.data) state = { data: snapshot, failed: false };
}

/** Live destination rates and Setsuna's target split, refreshed every minute. */
export function useEarn() {
  const [snap, setSnap] = useState<EarnState>(state);
  useEffect(() => {
    listeners.add(setSnap);
    setSnap(state);
    if (listeners.size === 1) {
      load();
      timer = setInterval(load, 60_000);
    }
    return () => {
      listeners.delete(setSnap);
      if (!listeners.size) clearInterval(timer);
    };
  }, []);
  return { data: snap.data, failed: snap.failed };
}

export const pct = (f: number, d = 2) => `${(f * 100).toFixed(d)}%`;
export const usd = (n: number) =>
  n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}K` : `$${n.toFixed(0)}`;
