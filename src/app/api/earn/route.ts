import { NextResponse } from "next/server";
import { policy, type EarnSnapshot } from "@/lib/setsuna/earn";
import { loadEarnSnapshot as load } from "@/lib/setsuna/earn-snapshot";

export const dynamic = "force-dynamic";

const TTL_MS = 60_000;
let cache: { at: number; body: EarnSnapshot } | undefined;

export async function GET() {
  try {
    if (!cache || Date.now() - cache.at > TTL_MS)
      cache = { at: Date.now(), body: await load() };
    // Public rates, refreshed once a minute: Vercel's edge answers repeat polls from cache.
    return NextResponse.json(cache.body, {
      headers: {
        "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
      },
    });
  } catch {
    if (cache)
      return NextResponse.json(
        {
          ...cache.body,
          error: "Showing the last good reading; the chain read failed.",
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    return NextResponse.json(
      {
        source: "Monad mainnet",
        basis: "Base supply APR",
        fetchedAt: new Date().toISOString(),
        destinations: [],
        bufferPct: policy.bufferPct,
        idlePct: 100,
        blendedApr: 0,
        error: "Market data unavailable",
      } satisfies EarnSnapshot,
      { status: 502 },
    );
  }
}
