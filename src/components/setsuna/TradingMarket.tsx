"use client";
import { useRef, useState } from "react";
import {
  compactNumber,
  marketNumber,
  type Level,
  type Observation,
} from "@/lib/setsuna/market-view";
import { useWallet } from "./WalletProvider";
import { LiveCandles } from "./LiveCandles";
import type { TradingReading } from "./useTradingMarket";

export function MarketStrip({
  kind,
  reading,
  local,
}: {
  kind: "spot" | "perps";
  reading?: TradingReading;
  local: boolean;
}) {
  const { deployment } = useWallet();
  const spot = kind === "spot";
  const spread =
    reading?.bids[0] && reading?.asks[0]
      ? reading.asks[0].price - reading.bids[0].price
      : undefined;
  return (
    <header className="t-market-strip">
      <div className="t-pair">
        <span className={`t-coin ${spot ? "is-mon" : "is-btc"}`}>
          {spot ? "M" : "₿"}
        </span>
        <div>
          <h1>{spot ? "MON / USDC" : "BTC / AUSD"}</h1>
          <span>{spot ? "Kuru · Spot" : "Perpl · Perpetual"}</span>
        </div>
        <span className="t-market-tag">{spot ? "SPOT" : "PERP"}</span>
      </div>
      <div className="t-stat">
        <span>{spot ? "Book midpoint" : "Mark price"}</span>
        <strong>{marketNumber(reading?.price, spot ? 6 : 2)}</strong>
      </div>
      <div className="t-stat">
        <span>{spot ? "CLOB spread" : "Collateral"}</span>
        <strong>{spot ? marketNumber(spread) : "AUSD"}</strong>
      </div>
      <div className="t-stat t-stat-block">
        <span>Read at block</span>
        <strong>{reading?.block.toLocaleString("en-US") ?? "—"}</strong>
      </div>
      <span className="t-environment">
        <i />
        {local
          ? "Local fork"
          : deployment?.mode === "demo"
            ? "Demo · test funds"
            : reading?.network === "monad-mainnet"
              ? "Mainnet · view only"
              : "Market preview"}
      </span>
    </header>
  );
}

function Depth({ bids, asks }: { bids: Level[]; asks: Level[] }) {
  const b = bids.slice(0, 12),
    a = asks.slice(0, 12);
  if (!b.length || !a.length)
    return <div className="t-chart-empty">Waiting for order book data</div>;
  const center = (b[0].price + a[0].price) / 2,
    min = b.at(-1)!.price,
    max = a.at(-1)!.price;
  const largest = Math.max(b.at(-1)!.total, a.at(-1)!.total);
  const x = (p: number) => 30 + ((p - min) / (max - min || 1)) * 650;
  const y = (total: number) => 325 - (total / largest) * 240;
  const path = (ls: Level[]) =>
    `M ${x(center)} 325 ` +
    ls.map((l) => `H ${x(l.price)} V ${y(l.total)}`).join(" ");
  return (
    <svg
      viewBox="0 0 780 375"
      role="img"
      aria-label="Cumulative resting CLOB depth"
    >
      <title>MON / USDC order book depth</title>
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i}>
          <line
            x1="30"
            y1={65 + i * 65}
            x2="685"
            y2={65 + i * 65}
            className="t-chart-grid"
          />
          <text x="700" y={69 + i * 65}>
            {compactNumber((largest * (4 - i)) / 4)}
          </text>
        </g>
      ))}
      <path
        d={`${path(b)} L ${x(b.at(-1)!.price)} 325 Z`}
        fill="var(--t-buy)"
        opacity=".1"
      />
      <path
        d={`${path(a)} L ${x(a.at(-1)!.price)} 325 Z`}
        fill="var(--t-sell)"
        opacity=".1"
      />
      <path d={path(b)} className="t-depth-buy" />
      <path d={path(a)} className="t-depth-sell" />
      <line
        x1={x(center)}
        x2={x(center)}
        y1="30"
        y2="330"
        className="t-chart-grid"
        strokeDasharray="4 4"
      />
      <text x="30" y="356">
        {marketNumber(min)}
      </text>
      <text x={x(center)} y="356" textAnchor="middle">
        {marketNumber(center)}
      </text>
      <text x="680" y="356" textAnchor="end">
        {marketNumber(max)}
      </text>
      <text x="36" y="32" className="t-buy-text">
        Bids · MON
      </text>
      <text x="600" y="32" className="t-sell-text">
        Asks · MON
      </text>
    </svg>
  );
}

function PriceChart({ points }: { points: Observation[] }) {
  const [hover, setHover] = useState<number>();
  if (!points.length)
    return (
      <div className="t-chart-empty">
        Waiting for the first market observation
      </div>
    );
  const vals = points.map((p) => p.price),
    last = points.at(-1)!;
  const pad = Math.max(
    (Math.max(...vals) - Math.min(...vals)) * 0.2,
    last.price * 0.002,
  );
  const low = Math.min(...vals) - pad,
    high = Math.max(...vals) + pad;
  const x = (i: number) => 30 + (i / Math.max(1, points.length - 1)) * 650;
  const y = (v: number) => 300 - ((v - low) / (high - low)) * 260;
  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.price)}`)
    .join(" ");
  const selected =
    hover === undefined ? last : points[Math.min(hover, points.length - 1)];
  const time = (t: number) =>
    new Date(t).toLocaleTimeString("en-GB", {
      timeZone: "UTC",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  return (
    <div className="t-price-canvas">
      <div className="t-chart-readout">
        {time(selected.time)} UTC{" "}
        <strong>{marketNumber(selected.price)}</strong>
        <span>{points.length} observed samples</span>
      </div>
      <svg
        viewBox="0 0 780 375"
        role="img"
        aria-label="Price observations recorded in this browser session"
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHover(
            Math.max(
              0,
              Math.min(
                points.length - 1,
                Math.round(
                  ((((e.clientX - r.left) / r.width) * 780 - 30) / 650) *
                    (points.length - 1),
                ),
              ),
            ),
          );
        }}
        onPointerLeave={() => setHover(undefined)}
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <line
              x1="30"
              y1={40 + i * 65}
              x2="685"
              y2={40 + i * 65}
              className="t-chart-grid"
            />
            <text x="698" y={44 + i * 65}>
              {marketNumber(high - ((high - low) * i) / 4)}
            </text>
          </g>
        ))}
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <line
            key={i}
            x1={30 + i * 130}
            x2={30 + i * 130}
            y1="40"
            y2="300"
            className="t-chart-grid"
          />
        ))}
        <path
          d={`${d} L ${x(points.length - 1)} 300 L 30 300 Z`}
          fill="var(--t-buy)"
          opacity=".07"
        />
        <path d={d} fill="none" stroke="var(--t-buy)" strokeWidth="2" />
        <line
          x1="30"
          x2="685"
          y1={y(last.price)}
          y2={y(last.price)}
          stroke="var(--t-buy)"
          strokeDasharray="3 5"
          opacity=".4"
        />
        <circle
          cx={x(hover === undefined ? points.length - 1 : hover)}
          cy={y(selected.price)}
          r="4"
          fill="var(--t-buy)"
        />
        <text x="30" y="347">
          {time(points[0].time)}
        </text>
        <text x="680" y="347" textAnchor="end">
          {time(last.time)} UTC
        </text>
      </svg>
    </div>
  );
}

export function MarketChart({
  kind,
  reading,
  observations,
  error,
  fixture,
  defaultView,
}: {
  kind: "spot" | "perps";
  reading?: TradingReading;
  observations: Observation[];
  error: string;
  fixture?: boolean;
  defaultView?: "price" | "depth";
}) {
  const chartRef = useRef<HTMLElement>(null);
  const { deployment } = useWallet();
  const live = deployment?.mode === "preview";
  const [view, setView] = useState(
    defaultView ?? (kind === "spot" ? "depth" : "price"),
  );
  const [window, setWindow] = useState(60);
  return (
    <section className="t-chart-panel" aria-label="Market chart" ref={chartRef}>
      <div className="t-panel-tabs">
        <div role="group" aria-label="Chart view">
          <button
            onClick={() => setView("price")}
            aria-pressed={view === "price"}
          >
            Price
          </button>
          {kind === "spot" && (
            <button
              onClick={() => setView("depth")}
              aria-pressed={view === "depth"}
            >
              Depth
            </button>
          )}
        </div>
        <span>{kind === "spot" ? "MON / USDC" : "BTC / AUSD"}</span>
        {kind === "spot" && (
          <button
            className="db-expand-chart"
            aria-label="Expand chart"
            onClick={() => {
              if (document.fullscreenElement)
                void document.exitFullscreen().catch(() => {});
              else void chartRef.current?.requestFullscreen().catch(() => {});
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M6 2H2v4m8-4h4v4M2 10v4h4m8-4v4h-4"
                fill="none"
                stroke="currentColor"
              />
            </svg>
          </button>
        )}
        <span className="t-chart-source">
          {live
            ? "Monad mainnet"
            : fixture
              ? "Historical mark fixture"
              : "Connected fork"}
        </span>
      </div>
      <div className="t-chart-tools">
        {view === "price" && live ? (
          <span>Venue trade history · UTC</span>
        ) : view === "price" ? (
          <>
            <span>Observations</span>
            <div role="group" aria-label="Chart sample window">
              {[30, 60, 180].map((n) => (
                <button
                  key={n}
                  onClick={() => setWindow(n)}
                  aria-pressed={window === n}
                >
                  {n} samples
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <span>Resting CLOB liquidity</span>
            <span>12 levels per side · MON</span>
          </>
        )}
      </div>
      {view === "price" && live ? (
        <LiveCandles kind={kind} />
      ) : error ? (
        <div className="t-chart-empty" role="status">
          {error}
        </div>
      ) : view === "depth" ? (
        <Depth bids={reading?.bids ?? []} asks={reading?.asks ?? []} />
      ) : (
        <PriceChart points={observations.slice(-window)} />
      )}
      <footer>
        <span>
          {view === "depth"
            ? "Cumulative size · AMM liquidity excluded"
            : live
              ? "Historical trades · current candle may be incomplete"
              : "Observed in this session · 8s sampling · no invented history"}
        </span>
        <span className="t-data-dot">{reading ? "Connected" : "Waiting"}</span>
      </footer>
    </section>
  );
}

export function OrderBook({
  reading,
  kind = "spot",
}: {
  reading?: TradingReading;
  kind?: "spot" | "perps";
}) {
  const [side, setSide] = useState<"both" | "bids" | "asks">("both");
  const bids = reading?.bids.slice(0, side === "both" ? 8 : 16) ?? [],
    asks = reading?.asks.slice(0, side === "both" ? 8 : 16) ?? [];
  const max = Math.max(
    1,
    ...bids.map((l) => l.total),
    ...asks.map((l) => l.total),
  );
  const rows = (levels: Level[], isBuy: boolean) =>
    levels.map((l) => (
      <div
        className={`t-book-row ${isBuy ? "is-buy" : "is-sell"}`}
        key={l.price}
      >
        <i style={{ width: `${(l.total / max) * 100}%` }} />
        <span>{marketNumber(l.price)}</span>
        <span>
          {kind === "perps" ? marketNumber(l.size, 5) : compactNumber(l.size)}
        </span>
        <span>
          {kind === "perps" ? marketNumber(l.total, 5) : compactNumber(l.total)}
        </span>
      </div>
    ));
  return (
    <section className="t-book" aria-label="Order book">
      <header>
        <h2>Order book</h2>
        <span>{kind === "spot" ? "MON" : "BTC"}</span>
      </header>
      <div className="t-book-controls" role="group" aria-label="Book side">
        {(["both", "bids", "asks"] as const).map((s) => (
          <button key={s} onClick={() => setSide(s)} aria-pressed={side === s}>
            {s === "both" ? "All" : s === "bids" ? "Bids" : "Asks"}
          </button>
        ))}
      </div>
      <div className="t-book-head">
        <span>Price ({kind === "spot" ? "USDC" : "AUSD"})</span>
        <span>Size</span>
        <span>Total</span>
      </div>
      {side !== "bids" && (
        <div className="t-book-asks">{rows([...asks].reverse(), false)}</div>
      )}
      <div className="t-book-mid">
        <strong>{marketNumber(reading?.price)}</strong>
        <span>{kind === "spot" ? "Midpoint" : "Mark price"}</span>
      </div>
      {side !== "asks" && <div>{rows(bids, true)}</div>}
      {!reading && <p className="t-empty">Waiting for the order book…</p>}
      <p className="t-book-note">
        Resting orders only. The execution quote is authoritative.
      </p>
    </section>
  );
}

export function PerpsMarketInfo({
  reading,
  fixture,
}: {
  reading?: TradingReading;
  fixture?: boolean;
}) {
  return (
    <section
      className="t-book t-perps-info"
      aria-label="Perpetual market details"
    >
      <header>
        <h2>Market details</h2>
        <span>BTC</span>
      </header>
      <div className="t-mark-tile">
        <span>{fixture ? "Fixed historical mark" : "Observed mark"}</span>
        <strong>{marketNumber(reading?.price, 2)}</strong>
        <span>USD per BTC</span>
      </div>
      <dl>
        <div>
          <dt>Venue</dt>
          <dd>Perpl</dd>
        </div>
        <div>
          <dt>Margin asset</dt>
          <dd>AUSD</dd>
        </div>
        <div>
          <dt>Leverage limit</dt>
          <dd>15×</dd>
        </div>
        <div>
          <dt>Execution</dt>
          <dd>Fill or kill</dd>
        </div>
        <div>
          <dt>Earn collateral</dt>
          <dd>Separate</dd>
        </div>
      </dl>
      <div className="t-info-note">
        <span>Market depth</span>
        <p>
          This fork uses a historical fixture; the live Perpl book belongs to
          mainnet. Orders are simulated before signing.
        </p>
      </div>
      <div className="t-info-note">
        <span>Position protection</span>
        <p>
          Optional margin top-ups from a capped AUSD reserve. Configure it below
          the trading workspace.
        </p>
      </div>
    </section>
  );
}
