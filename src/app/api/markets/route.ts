import {
  liveSnapshot,
  liveCandles,
  liveSpotTrades,
} from "@/lib/setsuna/market-server";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const view = q.get("view");
  if (
    view !== null &&
    (view !== "trades" || q.get("kind") !== "spot" || q.has("interval"))
  )
    return Response.json({ error: "Unknown market view" }, { status: 400 });
  const kind = q.get("kind"),
    interval = q.get("interval");
  if (
    (kind !== "spot" && kind !== "perps") ||
    (interval !== null && !["15m", "1h", "4h"].includes(interval))
  )
    return Response.json(
      { error: "Unknown market or interval" },
      { status: 400 },
    );
  try {
    const data =
      view === "trades"
        ? await liveSpotTrades()
        : interval
          ? await liveCandles(kind, interval as "15m" | "1h" | "4h")
          : await liveSnapshot(kind);
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      { error: "Market data is temporarily unavailable. Reconnecting…" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
