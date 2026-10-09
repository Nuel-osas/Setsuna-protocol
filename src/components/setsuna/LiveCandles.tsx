"use client";
import { useEffect, useRef, useState } from "react";
import type { Candle } from "@/lib/setsuna/live-market";
import { marketNumber } from "@/lib/setsuna/market-view";

export function LiveCandles({ kind }: { kind: "spot" | "perps" }) {
  const [interval, setIntervalChoice] = useState<"15m" | "1h" | "4h">("15m");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [error, setError] = useState("");
  const [hover, setHover] = useState<number>();
  const svgRef = useRef<SVGSVGElement>(null);
  const [canvasWidth, setCanvasWidth] = useState(780);
  useEffect(() => {
    if (kind !== "spot" || !svgRef.current) return;
    const observer = new ResizeObserver((entries) =>
      setCanvasWidth(Math.max(280, entries[0].contentRect.width)),
    );
    observer.observe(svgRef.current);
    return () => observer.disconnect();
  }, [kind, candles.length]);
  useEffect(() => {
    let stopped = false,
      busy = false;
    const controller = new AbortController();
    setCandles([]);
    setError("");
    setHover(undefined);
    async function read() {
      if (busy) return;
      busy = true;
      try {
        const r = await fetch(
          `/api/markets/?kind=${kind}&interval=${interval}`,
          {
            cache: "no-store",
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(20000),
            ]),
          },
        );
        if (!r.ok) throw new Error("History unavailable");
        const data = await r.json();
        if (
          data.network !== "monad-mainnet" ||
          data.interval !== interval ||
          !Array.isArray(data.candles)
        )
          throw new Error("Invalid history");
        if (!stopped) {
          setCandles(data.candles);
          setError("");
        }
      } catch {
        if (!stopped) {
          setCandles([]);
          setError("Trade history unavailable. Retrying…");
        }
      } finally {
        busy = false;
      }
    }
    void read();
    const timer = window.setInterval(read, 30000);
    return () => {
      stopped = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [kind, interval]);
  const low = Math.min(
      ...candles.map((c) => (kind === "spot" ? c.close : c.low)),
    ),
    high = Math.max(
      ...candles.map((c) => (kind === "spot" ? c.close : c.high)),
    );
  const pad = Math.max((high - low) * 0.08, high * 0.0001),
    min = low - pad,
    max = high + pad;
  const x = (i: number) =>
    34 + ((i + 0.5) * (canvasWidth - 130)) / Math.max(1, candles.length);
  const y = (v: number) => 310 - ((v - min) / (max - min)) * 270;
  const selected =
    candles[Math.min(hover ?? candles.length - 1, candles.length - 1)];
  const time = (t: number) =>
    new Date(t).toLocaleString("en-GB", {
      timeZone: "UTC",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  return (
    <div className="t-live-candles">
      <div
        className="t-candle-intervals"
        role="group"
        aria-label="Candle interval"
      >
        {(["15m", "1h", "4h"] as const).map((n) => (
          <button
            key={n}
            aria-pressed={interval === n}
            onClick={() => setIntervalChoice(n)}
          >
            {n}
          </button>
        ))}
      </div>
      {error ? (
        <div className="t-chart-empty" role="status">
          {error}
        </div>
      ) : !candles.length ? (
        <div className="t-chart-empty">Loading venue trade history…</div>
      ) : (
        <>
          <div className="t-chart-readout">
            {time(selected.time)} UTC{" "}
            <span>
              {kind === "spot"
                ? `Close ${marketNumber(selected.close)}`
                : `O ${marketNumber(selected.open)} · H ${marketNumber(selected.high)} · L ${marketNumber(selected.low)} · C ${marketNumber(selected.close)}`}
            </span>
          </div>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${canvasWidth} 375`}
            preserveAspectRatio={kind === "spot" ? "none" : "xMidYMid meet"}
            role="img"
            aria-label={
              kind === "spot"
                ? "MON / USDC historical closing prices"
                : "BTC / AUSD historical candlesticks"
            }
            onPointerMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setHover(
                Math.max(
                  0,
                  Math.min(
                    candles.length - 1,
                    Math.floor(
                      ((((e.clientX - r.left) / r.width) * canvasWidth - 34) /
                        (canvasWidth - 130)) *
                        candles.length,
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
                  x2={canvasWidth - 90}
                  y1={40 + i * 67.5}
                  y2={40 + i * 67.5}
                  className="t-chart-grid"
                />
                <text x={canvasWidth - 80} y={44 + i * 67.5}>
                  {marketNumber(
                    max - ((max - min) * i) / 4,
                    kind === "spot" ? 5 : 0,
                  )}
                </text>
              </g>
            ))}
            {kind === "spot" ? (
              <path
                d={candles
                  .map((c, i) => `${i ? "L" : "M"}${x(i)},${y(c.close)}`)
                  .join(" ")}
                fill="none"
                stroke="var(--t-buy)"
                strokeWidth="2"
              />
            ) : (
              candles.map((c, i) => {
                const color =
                    c.close >= c.open ? "var(--t-buy)" : "var(--t-sell)",
                  width = Math.max(2, (650 / candles.length) * 0.68);
                return (
                  <g key={c.time}>
                    <line
                      x1={x(i)}
                      x2={x(i)}
                      y1={y(c.high)}
                      y2={y(c.low)}
                      stroke={color}
                    />
                    <rect
                      x={x(i) - width / 2}
                      y={Math.min(y(c.open), y(c.close))}
                      width={width}
                      height={Math.max(1, Math.abs(y(c.open) - y(c.close)))}
                      fill={color}
                    />
                  </g>
                );
              })
            )}
            {hover !== undefined && (
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1="35"
                y2="315"
                stroke="var(--t-muted)"
                strokeDasharray="3 4"
              />
            )}
            <text x="30" y="350">
              {time(candles[0].time)}
            </text>
            <text x={canvasWidth - 90} y="350" textAnchor="end">
              {time(candles.at(-1)!.time)} UTC
            </text>
          </svg>
        </>
      )}
    </div>
  );
}
