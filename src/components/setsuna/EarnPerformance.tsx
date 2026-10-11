"use client";
import { useEffect, useId, useState } from "react";
import { formatUnits } from "viem";
import { useWallet } from "./WalletProvider";
import { readEarnPerformance } from "@/lib/setsuna/earn-history";
import { earnAmount, type EarnAsset } from "./EarnForm";

type History = Awaited<ReturnType<typeof readEarnPerformance>>;
export default function EarnPerformance({
  asset,
  enabled = true,
}: {
  asset: EarnAsset;
  enabled?: boolean;
}) {
  const { deployment: d } = useWallet();
  const [state, setState] = useState<{
    key: string;
    data?: History;
    failed?: boolean;
  }>();
  const [metric, setMetric] = useState<"price" | "assets">("price");
  const [selected, setSelected] = useState<number>();
  const gradient = useId().replaceAll(":", "");
  const key = `${d?.rpc}:${d?.chainId}:${asset === "MON" ? d?.earnMON?.vault : d?.earnUSDC?.vault}`;
  const current = state?.key === key ? state : undefined;
  useEffect(() => {
    // Fetch alongside the vault snapshot; `enabled` only gates what is shown.
    if (!d) return;
    let cancelled = false,
      running = false;
    const load = () => {
      if (running) return;
      running = true;
      void readEarnPerformance(d, asset)
        .then((data) => {
          if (!cancelled) setState({ key, data });
        })
        .catch(() => {
          if (!cancelled) setState({ key, failed: true });
        })
        .finally(() => {
          running = false;
        });
    };
    const initial = setTimeout(load, 0);
    const timer = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [d, asset, key]);
  const data = enabled ? current?.data : undefined;
  const points = data?.points ?? [];
  const decimals = asset === "MON" ? 18 : 6;
  const values = points.map((p) => Number(formatUnits(p[metric], decimals)));
  const min = Math.min(...values),
    max = Math.max(...values);
  const pad = Math.max((max - min) * 0.25, Math.abs(max) * 0.0000001, 1e-8);
  const lo = min - pad,
    hi = max + pad;
  const coords = points.map((p, i) => ({
    x:
      12 +
      ((p.timestamp - points[0].timestamp) /
        Math.max(1, points.at(-1)!.timestamp - points[0].timestamp)) *
        616,
    y: 170 - ((values[i] - lo) / (hi - lo)) * 140,
  }));
  const chosen =
    selected === undefined
      ? points.at(-1)
      : (points[selected] ?? points.at(-1));
  const date = (timestamp?: number) =>
    timestamp === undefined
      ? "—"
      : new Date(timestamp * 1000).toLocaleString("en-GB", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "UTC",
        });
  const firstValue = points[0]?.[metric];
  const change =
    chosen && firstValue
      ? Number(
          ((chosen[metric] - firstValue) * BigInt(100000000)) / firstValue,
        ) / 1000000
      : undefined;
  const line = coords.map((p) => `${p.x},${p.y}`).join(" ");
  return (
    <section className="e-panel e-performance" aria-label="Vault performance">
      <header className="e-section-head">
        <h2>Performance</h2>
        <span>Since deployment</span>
      </header>
      <div
        className="e-chart-controls"
        role="group"
        aria-label="Performance metric"
      >
        <button
          aria-pressed={metric === "price"}
          onClick={() => setMetric("price")}
        >
          Share value
        </button>
        <button
          aria-pressed={metric === "assets"}
          onClick={() => setMetric("assets")}
        >
          Total assets
        </button>
      </div>
      <div className="e-chart-value">
        <strong>
          {earnAmount(chosen?.[metric], decimals, metric === "price" ? 8 : 3)}{" "}
          <small>{asset}</small>
        </strong>
        <span>
          {metric === "price" ? `per sets${asset}` : "held in vault"} ·{" "}
          {date(chosen?.timestamp)} UTC
        </span>
      </div>
      {change !== undefined && (
        <p className="e-chart-change">
          {change > 0 ? "+" : ""}
          {change.toFixed(6)}% across displayed samples
        </p>
      )}
      {points.length >= 2 ? (
        <>
          <svg
            className="e-chart"
            viewBox="0 0 640 210"
            role="img"
            aria-label={`${metric === "price" ? "Share value" : "Total assets"} in ${asset}, ${points.length} historical onchain samples. Exact values below.`}
          >
            <defs>
              <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor="var(--b-chart)"
                  stopOpacity=".18"
                />
                <stop
                  offset="100%"
                  stopColor="var(--b-chart)"
                  stopOpacity="0"
                />
              </linearGradient>
            </defs>
            {[40, 105, 170].map((y) => (
              <line
                key={y}
                x1="12"
                y1={y}
                x2="628"
                y2={y}
                stroke="var(--b-line)"
                strokeDasharray="3 5"
              />
            ))}
            <polygon
              points={`12,190 ${line} ${coords.at(-1)!.x},190`}
              fill={`url(#${gradient})`}
            />
            <polyline
              points={line}
              fill="none"
              stroke="var(--b-chart)"
              strokeWidth="2.5"
              strokeLinejoin="round"
            />
            {coords.map((p, i) => (
              <g key={i}>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={selected === i ? 5 : 3}
                  fill="var(--b-chart)"
                />
                <circle
                  cx={p.x}
                  cy={p.y}
                  r="13"
                  fill="transparent"
                  tabIndex={0}
                  role="button"
                  aria-label={`${date(points[i].timestamp)} UTC: ${formatUnits(points[i][metric], decimals)} ${asset}`}
                  onFocus={() => setSelected(i)}
                  onBlur={() => setSelected(undefined)}
                  onMouseEnter={() => setSelected(i)}
                  onMouseLeave={() => setSelected(undefined)}
                  onClick={() => setSelected(i)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelected(i);
                    }
                  }}
                />
              </g>
            ))}
          </svg>
          <div className="e-chart-dates">
            <span>{date(points[0].timestamp)}</span>
            <span>{date(points.at(-1)?.timestamp)} UTC</span>
          </div>
        </>
      ) : (
        <div className="e-chart-empty">
          {!current
            ? "Loading recorded vault history…"
            : current.failed
              ? "Historical state is unavailable on this RPC."
              : "More funded-vault history is needed to draw a chart."}
        </div>
      )}
      <p className="e-note">
        {data?.missing ? "Some historical blocks could not be read. " : ""}
        {metric === "price"
          ? "Share value reflects interest, donations and losses; it is not a realised APY."
          : "Vault assets change with deposits, withdrawals, interest and losses."}{" "}
        Only actual samples from funded vault blocks are shown.
      </p>
      {points.length > 0 && (
        <details className="e-records">
          <summary>View {points.length} recorded samples</summary>
          <div className="s-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Block</th>
                  <th>Share value ({asset})</th>
                  <th>Assets ({asset})</th>
                </tr>
              </thead>
              <tbody>
                {points.map((p) => (
                  <tr key={p.block.toString()}>
                    <td>{p.block.toString()}</td>
                    <td>{formatUnits(p.price, decimals)}</td>
                    <td>{earnAmount(p.assets, decimals, 6)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}
