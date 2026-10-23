"use client";
import { useRef } from "react";
import type { EarnSeeds } from "@/lib/setsuna/earn-seed";
import { seedEarnSummary, type SummaryAsset } from "@/lib/setsuna/earn-summary";
import { seedEarn } from "./useEarn";
import { useWallet } from "./WalletProvider";

/**
 * Loads the server's vault figures into the client caches before any section
 * renders, so the first paint already has APRs and totals. Seeds both the
 * site-wide and the Earn-scoped deployment, which can key the cache differently.
 */
export default function EarnSeed({ seeds }: { seeds: EarnSeeds }) {
  const { deployment } = useWallet();
  const done = useRef(false);
  // On the server, module caches outlive a request; the page's own seed must win
  // there so the HTML and the first client render show the same figures.
  const force = typeof window === "undefined";
  if (!done.current && deployment) {
    done.current = true;
    for (const d of [deployment, deployment.earnMainnet])
      if (d)
        for (const [asset, seed] of Object.entries(seeds.summaries))
          if (seed)
            seedEarnSummary(d, asset as SummaryAsset, {
              block: BigInt(seed.block),
              nav: BigInt(seed.nav),
              healthy: seed.healthy,
              idle: BigInt(seed.idle),
              shareValue: BigInt(seed.shareValue),
              positions: seed.positions.map(BigInt),
              rates: seed.rates.map(BigInt),
              blendedApr: BigInt(seed.blendedApr),
            }, force);
    if (seeds.snapshot?.destinations?.length) seedEarn(seeds.snapshot, force);
  }
  return null;
}
