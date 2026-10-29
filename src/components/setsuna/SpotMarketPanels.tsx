"use client";
import { useEffect, useState } from "react";
import type { TradingReading } from "./useTradingMarket";
import { marketNumber, type Level } from "@/lib/setsuna/market-view";
import type { SpotTrade } from "@/lib/setsuna/live-market";
import TokenIcon from "./TokenIcon";

/** Latest Kuru swap price. The order book leaves out AMM liquidity, so with one side
 * empty it has no midpoint, while trades still print through the pool. */
function useLastTrade() {
  const [price, setPrice] = useState<number>();
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/markets/?kind=spot&view=trades", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : undefined))
        .then((body: { trades?: SpotTrade[] } | undefined) => {
          const last = Array.isArray(body?.trades) ? body.trades[0]?.price : undefined;
          if (alive && last !== undefined && Number.isFinite(last)) setPrice(last);
        })
        .catch(() => undefined);
    void load();
    const timer = setInterval(load, 30000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  return price;
}

export function SpotSummary({ reading }: { reading?: TradingReading }) {
  const bid = reading?.bids[0]?.price,
    ask = reading?.asks[0]?.price;
  const spread = bid !== undefined && ask !== undefined ? ask - bid : undefined;
  const last = useLastTrade();
  const price = reading?.price ?? last;
  const loaded = !!reading;
  return (
    <header className="db-summary">
      <div className="db-pair">
        <span className="db-token-pair">
          <i>
            <TokenIcon asset="MON" size={12} />
          </i>
          <i>
            <TokenIcon asset="USDC" size={16} />
          </i>
        </span>
        <h1>MON/USDC</h1>
        {price !== undefined && (
          <span className="db-pair-price">${marketNumber(price)}</span>
        )}
      </div>
      <div className="db-stat t-stat">
        <span>{reading?.price !== undefined ? "Market midpoint" : "Last price"}</span>
        <strong>{price === undefined ? "…" : `$${marketNumber(price)}`}</strong>
      </div>
      <div className="db-stat">
        <span>Best bid</span>
        <strong>{bid !== undefined ? marketNumber(bid) : loaded ? "No bids" : "…"}</strong>
      </div>
      <div className="db-stat">
        <span>Best ask</span>
        <strong>{ask !== undefined ? marketNumber(ask) : loaded ? "No asks" : "…"}</strong>
      </div>
      {spread !== undefined && reading?.price ? (
        <div className="db-stat">
          <span>Spread</span>
          <strong>{`${((spread / reading.price) * 100).toFixed(3)}%`}</strong>
        </div>
      ) : null}
    </header>
  );
}

export function SpotBook({
  reading,
  live,
  view,
  onView,
}: {
  reading?: TradingReading;
  live: boolean;
  view: "book" | "trades";
  onView: (view: "book" | "trades") => void;
}) {
  const [unit, setUnit] = useState<"MON" | "USDC">("MON");
  const [precision, setPrecision] = useState("0.000001");
  const [side, setSide] = useState<"both" | "bids" | "asks">("both");
  const [trades, setTrades] = useState<SpotTrade[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!live || view !== "trades") return;
    let stopped = false,
      busy = false;
    const controller = new AbortController();
    async function read() {
      if (busy) return;
      busy = true;
      try {
        const response = await fetch("/api/markets/?kind=spot&view=trades", {
          cache: "no-store",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(20000),
          ]),
        });
        if (!response.ok) throw new Error("Unavailable");
        const d = await response.json();
        if (d.network !== "monad-mainnet" || !Array.isArray(d.trades))
          throw new Error("Invalid trades");
        if (!stopped) {
          setTrades(d.trades);
          setError("");
        }
      } catch {
        if (!stopped) {
          setTrades([]);
          setError("Recent trades unavailable. Reconnecting…");
        }
      } finally {
        busy = false;
      }
    }
    void read();
    const timer = window.setInterval(read, 8000);
    return () => {
      stopped = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [live, view]);
  const group = (items: Level[], buy: boolean) => {
    const buckets = new Map<number, number>(),
      step = Number(precision);
    for (const l of items) {
      const price = Number(
        (
          (buy
            ? Math.floor(l.price / step + 1e-8)
            : Math.ceil(l.price / step - 1e-8)) * step
        ).toFixed(6),
      );
      buckets.set(
        price,
        (buckets.get(price) ?? 0) +
          (unit === "MON" ? l.size : l.size * l.price),
      );
    }
    let total = 0;
    return [...buckets]
      .sort((a, b) => (buy ? b[0] - a[0] : a[0] - b[0]))
      .slice(0, side === "both" ? 8 : 16)
      .map(([price, size]) => ({ price, size, total: (total += size) }));
  };
  const bids = group(reading?.bids ?? [], true),
    asks = group(reading?.asks ?? [], false);
  const max = Math.max(
    1,
    ...bids.map((l) => l.total),
    ...asks.map((l) => l.total),
  );
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  const rows = (levels: Level[], buy: boolean) =>
    levels.map((l) => (
      <div
        className={`db-book-row t-book-row ${buy ? "is-buy" : "is-sell"}`}
        key={l.price}
      >
        <i style={{ width: `${(l.total / max) * 100}%` }} />
        <span>{l.price.toFixed(precision.length - 2)}</span>
        <span>{fmt(l.size)}</span>
        <span>{fmt(l.total)}</span>
      </div>
    ));
  const bid = reading?.bids[0]?.price,
    ask = reading?.asks[0]?.price;
  const spread = bid !== undefined && ask !== undefined ? ask - bid : undefined;
  return (
    <section className="db-book" aria-label="Order book">
      <div className="db-tabs" role="group" aria-label="Market activity">
        <button aria-pressed={view === "book"} onClick={() => onView("book")}>
          Order Book
        </button>
        <button
          aria-pressed={view === "trades"}
          onClick={() => onView("trades")}
        >
          Trades
        </button>
      </div>
      {view === "book" ? (
        <>
          <div className="db-book-tools">
            <label>
              <span className="db-sr-only">Price grouping</span>
              <select
                aria-label="Price grouping"
                value={precision}
                onChange={(e) => setPrecision(e.target.value)}
              >
                {["0.000001", "0.00001", "0.0001"].map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
            <div
              className="db-small-segment"
              role="group"
              aria-label="Book size currency"
            >
              {(["MON", "USDC"] as const).map((t) => (
                <button
                  key={t}
                  aria-pressed={unit === t}
                  onClick={() => setUnit(t)}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className="db-book-filters" role="group" aria-label="Book side">
            {(["both", "bids", "asks"] as const).map((s) => (
              <button
                key={s}
                aria-pressed={side === s}
                onClick={() => setSide(s)}
              >
                {s === "both" ? "All" : s === "bids" ? "Bids" : "Asks"}
              </button>
            ))}
          </div>
          <div className="db-book-head">
            <span>Price</span>
            <span>Size ({unit})</span>
            <span>Total ({unit})</span>
          </div>
          <div className="db-book-body">
            {side !== "bids" && (
              <div className="db-asks">{rows([...asks].reverse(), false)}</div>
            )}
            {/* With one side empty there is no spread; say which side, not "— —". */}
            <div className="db-spread">
              {spread !== undefined && reading?.price ? (
                <>
                  <span>Spread</span>
                  <span>{marketNumber(spread)}</span>
                  <span>{`${((spread / reading.price) * 100).toFixed(3)}%`}</span>
                </>
              ) : reading ? (
                <span>
                  {!bids.length && !asks.length
                    ? "No resting orders"
                    : !bids.length
                      ? "No bids resting · trades fill via the AMM"
                      : "No asks resting · trades fill via the AMM"}
                </span>
              ) : (
                <span>…</span>
              )}
            </div>
            {side !== "asks" && <div>{rows(bids, true)}</div>}
            {!reading && (
              <p className="db-empty-small">Waiting for market data…</p>
            )}
          </div>
          <p className="db-book-foot">
            Resting orders · AMM liquidity excluded
          </p>
        </>
      ) : (
        <>
          <div className="db-book-head">
            <span>Price (USDC)</span>
            <span>Size (MON)</span>
            <span>Time (UTC)</span>
          </div>
          <div className="db-trades">
            {!live ? (
              <p className="db-empty-small">
                Market-wide trade history is available in the mainnet preview.
                Your swap receipts appear below.
              </p>
            ) : error ? (
              <p className="db-empty-small" role="status">
                {error}
              </p>
            ) : !trades.length ? (
              <p className="db-empty-small">Loading recent trades…</p>
            ) : (
              trades.map((t) => (
                <div
                  className={`db-trade-row ${t.buy ? "is-buy" : "is-sell"}`}
                  key={`${t.hash}-${t.index}`}
                >
                  <span>{t.price.toFixed(6)}</span>
                  <span>{fmt(t.size)}</span>
                  <time>
                    {new Date(t.time).toLocaleTimeString("en-GB", {
                      timeZone: "UTC",
                      hour12: false,
                    })}
                  </time>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </section>
  );
}
