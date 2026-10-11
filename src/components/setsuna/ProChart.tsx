"use client";
import { useEffect, useRef, useState } from "react";
import type {
  IChartApi,
  IPriceLine,
  ISeriesApi,
  UTCTimestamp,
} from "lightweight-charts";
import type { Candle } from "@/lib/setsuna/live-market";
import { compactNumber, marketNumber } from "@/lib/setsuna/market-view";

type Interval = "15m" | "1h" | "4h";
const UP = "#3fb68b",
  DOWN = "#e5534b";

/**
 * Venue candles with volume, drawn by TradingView's open-source chart. Data is
 * the venue's own mainnet trade history; `forkMark` marks where demo orders fill.
 */
export function ProChart({
  kind,
  forkMark,
}: {
  kind: "spot" | "perps";
  forkMark?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi>(null);
  const candleSeries = useRef<ISeriesApi<"Candlestick">>(null);
  const volumeSeries = useRef<ISeriesApi<"Histogram">>(null);
  const markLine = useRef<IPriceLine>(null);
  const [ready, setReady] = useState(false);
  const [interval, setIntervalChoice] = useState<Interval>("1h");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [hover, setHover] = useState<Candle>();
  const [error, setError] = useState("");
  const spot = kind === "spot";
  const digits = spot ? 6 : 1;

  useEffect(() => {
    let disposed = false;
    void import("lightweight-charts").then(
      ({ createChart, CandlestickSeries, HistogramSeries, ColorType }) => {
        if (disposed || !host.current) return;
        const c = createChart(host.current, {
          autoSize: true,
          layout: {
            background: { type: ColorType.Solid, color: "transparent" },
            textColor: "rgba(255,255,255,0.55)",
            fontSize: 11,
            fontFamily: "var(--f-mono), ui-monospace, monospace",
          },
          grid: {
            vertLines: { color: "rgba(255,255,255,0.05)" },
            horzLines: { color: "rgba(255,255,255,0.05)" },
          },
          rightPriceScale: { borderColor: "rgba(255,255,255,0.1)" },
          timeScale: {
            borderColor: "rgba(255,255,255,0.1)",
            timeVisible: true,
            secondsVisible: false,
          },
          crosshair: { mode: 0 },
          localization: {
            priceFormatter: (price: number) => marketNumber(price, digits),
          },
        });
        candleSeries.current = c.addSeries(CandlestickSeries, {
          upColor: UP,
          downColor: DOWN,
          borderVisible: false,
          wickUpColor: UP,
          wickDownColor: DOWN,
          priceFormat: {
            type: "price",
            precision: digits,
            minMove: 10 ** -digits,
          },
        });
        volumeSeries.current = c.addSeries(HistogramSeries, {
          priceScaleId: "volume",
          priceFormat: { type: "volume" },
          lastValueVisible: false,
          priceLineVisible: false,
        });
        c.priceScale("volume").applyOptions({
          scaleMargins: { top: 0.82, bottom: 0 },
        });
        c.subscribeCrosshairMove((p) => {
          const bar = p.time
            ? (p.seriesData.get(candleSeries.current!) as
                | { open: number; high: number; low: number; close: number }
                | undefined)
            : undefined;
          setHover(
            bar
              ? {
                  time: Number(p.time) * 1000,
                  ...bar,
                  volume: (
                    p.seriesData.get(volumeSeries.current!) as
                      { value: number } | undefined
                  )?.value,
                }
              : undefined,
          );
        });
        chart.current = c;
        setReady(true);
      },
    );
    return () => {
      disposed = true;
      chart.current?.remove();
      chart.current = null;
      markLine.current = null;
    };
  }, [digits]);

  useEffect(() => {
    let stopped = false;
    const controller = new AbortController();
    setCandles([]);
    setError("");
    const read = async () => {
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
        if (!r.ok) throw new Error();
        const data = await r.json();
        if (
          data.network !== "monad-mainnet" ||
          data.interval !== interval ||
          !Array.isArray(data.candles)
        )
          throw new Error();
        if (!stopped) {
          setCandles(data.candles);
          setError("");
        }
      } catch {
        if (!stopped) setError("Trade history unavailable. Retrying…");
      }
    };
    void read();
    const timer = setInterval(read, 30_000);
    return () => {
      stopped = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [kind, interval]);

  useEffect(() => {
    if (!ready || !candleSeries.current || !volumeSeries.current) return;
    const time = (c: Candle) => Math.floor(c.time / 1000) as UTCTimestamp;
    candleSeries.current.setData(
      candles.map((c) => ({
        time: time(c),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );
    volumeSeries.current.setData(
      candles
        .filter((c) => c.volume !== undefined)
        .map((c) => ({
          time: time(c),
          value: c.volume!,
          color: c.close >= c.open ? `${UP}66` : `${DOWN}66`,
        })),
    );
    chart.current?.timeScale().fitContent();
  }, [candles, ready]);

  useEffect(() => {
    const series = candleSeries.current;
    if (!ready || !series) return;
    if (markLine.current) series.removePriceLine(markLine.current);
    markLine.current =
      forkMark && Number.isFinite(forkMark)
        ? series.createPriceLine({
            price: forkMark,
            color: "#a3b2ff",
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: spot ? "Fork book" : "Fork mark",
          })
        : null;
  }, [forkMark, ready, spot]);

  const shown = hover ?? candles.at(-1);
  const change = shown ? (shown.close / shown.open - 1) * 100 : undefined;
  return (
    <div className="t-pro-chart">
      <div className="t-pro-tools">
        <div role="group" aria-label="Candle interval">
          {(["15m", "1h", "4h"] as const).map((i) => (
            <button
              key={i}
              aria-pressed={interval === i}
              onClick={() => setIntervalChoice(i)}
            >
              {i}
            </button>
          ))}
        </div>
        <span className="t-pro-legend" aria-live="off">
          <b>{spot ? "MON-USDC" : "BTC-PERP"}</b>
          {shown && (
            <>
              <span>O {marketNumber(shown.open, digits)}</span>
              <span>H {marketNumber(shown.high, digits)}</span>
              <span>L {marketNumber(shown.low, digits)}</span>
              <span>C {marketNumber(shown.close, digits)}</span>
              {change !== undefined && (
                <span className={change >= 0 ? "is-up" : "is-down"}>
                  {change >= 0 ? "+" : ""}
                  {change.toFixed(2)}%
                </span>
              )}
              {shown.volume !== undefined && (
                <span>
                  Vol {spot ? "" : "$"}
                  {compactNumber(shown.volume)}
                  {spot ? " MON" : ""}
                </span>
              )}
            </>
          )}
        </span>
      </div>
      <div
        className="t-pro-canvas"
        ref={host}
        role="img"
        aria-label={`${spot ? "MON/USDC Kuru" : "BTC Perpl"} mainnet candles, ${interval} interval`}
      />
      {error && !candles.length && (
        <div className="t-chart-empty" role="status">
          {error}
        </div>
      )}
    </div>
  );
}
