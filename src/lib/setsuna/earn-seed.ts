import { unstable_cache } from "next/cache";
import { readEarnSummary, type EarnSummary, type SummaryAsset } from "./earn-summary.ts";
import { loadEarnSnapshot } from "./earn-snapshot.ts";
import type { EarnSnapshot } from "./earn";
import type { Deployment } from "./types";

/** EarnSummary with bigints as decimal strings, so it can cross into the page. */
export type SummarySeed = { [K in keyof EarnSummary]: EarnSummary[K] extends bigint ? string : EarnSummary[K] extends bigint[] ? string[] : EarnSummary[K] };
export type EarnSeeds = { summaries: Partial<Record<SummaryAsset, SummarySeed>>; snapshot?: EarnSnapshot };

const toSeed = (s: EarnSummary): SummarySeed => ({
  block: s.block.toString(),
  nav: s.nav.toString(),
  healthy: s.healthy,
  idle: s.idle.toString(),
  shareValue: s.shareValue.toString(),
  positions: s.positions.map(String),
  rates: s.rates.map(String),
  blendedApr: s.blendedApr.toString(),
});

/**
 * The vault figures every page shows, read on the server and cached for 30s,
 * so pages open with numbers instead of waiting on the browser's own chain reads.
 * A failed read seeds nothing; the browser then loads as before.
 */
export function earnSeeds(deployment: Deployment): Promise<EarnSeeds> {
  const d = deployment.earnMainnet ?? deployment;
  return unstable_cache(
    async (): Promise<EarnSeeds> => {
      const [mon, usdc, snapshot] = await Promise.allSettled([
        d.earnMON ? readEarnSummary(d, "MON") : Promise.reject(),
        d.earnUSDC ? readEarnSummary(d, "USDC") : Promise.reject(),
        loadEarnSnapshot(),
      ]);
      return {
        summaries: {
          ...(mon.status === "fulfilled" ? { MON: toSeed(mon.value) } : {}),
          ...(usdc.status === "fulfilled" ? { USDC: toSeed(usdc.value) } : {}),
        },
        ...(snapshot.status === "fulfilled" ? { snapshot: snapshot.value } : {}),
      };
    },
    ["earn-seeds-v1", d.earnUSDC?.vault ?? "", d.earnMON?.vault ?? ""],
    { revalidate: 30 },
  )().catch(() => ({ summaries: {} }));
}
