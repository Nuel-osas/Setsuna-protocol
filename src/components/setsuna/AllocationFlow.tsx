"use client";
import { Mark } from "./Brand";
import { pct, useEarn } from "./useEarn";

const W = 1200;
const H = 520;

export default function AllocationFlow() {
  const { data, failed } = useEarn();
  const rows = (data?.destinations ?? []).filter((d) => d.weight > 0);
  const skipped = (data?.destinations ?? []).filter((d) => d.weight === 0);
  const lanes = [
    ...rows.map((r) => ({ key: r.key, label: r.protocol, sub: r.name, weight: r.weight, apy: r.apr, off: false })),
    ...skipped.map((r) => ({ key: r.key, label: r.protocol, sub: r.reason?.startsWith("Below") ? "Under $250K · skipped" : "Skipped", weight: 0, apy: r.apr, off: true })),
    { key: "buffer", label: "Held as cash", sub: "Instant withdrawals", weight: (data?.idlePct ?? 10) / 100, apy: 0, off: false },
  ];
  const top = lanes.length <= 3 ? 130 : 70;
  const gap = (H - 2 * top) / Math.max(1, lanes.length - 1);
  const cx = 560;
  const cy = H / 2;

  return (
    <figure className="s-flow" aria-label="Live illustration of how setsUSDC would split a deposit across Monad lending destinations.">
      <svg viewBox={`0 0 ${W} ${H}`} role="img">
        <defs>
          <linearGradient id="flowIn" x1="0" x2="1">
            <stop offset="0" stopColor="var(--blue)" stopOpacity="0.04" />
            <stop offset="1" stopColor="var(--blue)" stopOpacity="0.35" />
          </linearGradient>
          <radialGradient id="core" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="var(--blue)" stopOpacity="0.16" />
            <stop offset="1" stopColor="var(--blue)" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* deposit stream */}
        <path d={`M40 ${cy} C200 ${cy} 300 ${cy} ${cx - 92} ${cy}`} className="s-flow-in" stroke="url(#flowIn)" />
        <path d={`M40 ${cy} C200 ${cy} 300 ${cy} ${cx - 92} ${cy}`} className="s-flow-pulse" />
        <text x="40" y={cy - 26} className="s-flow-k">DEPOSIT</text>
        <text x="40" y={cy + 40} className="s-flow-v">USDC</text>

        {/* lanes */}
        {lanes.map((l, i) => {
          const y = top + i * gap;
          const sw = 2 + l.weight * 34;
          const d = `M${cx + 92} ${cy} C${cx + 230} ${cy} ${cx + 210} ${y} ${cx + 330} ${y}`;
          const buffer = l.key === "buffer";
          return (
            <g key={l.key} className={buffer ? "is-buffer" : l.off ? "is-off" : ""}>
              <path d={d} className="s-flow-lane" strokeWidth={l.off ? 1.5 : sw} />
              {!buffer && !l.off && <path d={d} className="s-flow-pulse" style={{ animationDelay: `${i * 0.35}s` }} />}
              <text x={cx + 350} y={y - 6} className="s-flow-name">{l.label}</text>
              <text x={cx + 350} y={y + 16} className="s-flow-sub">{l.sub}</text>
              <text x={W - 24} y={y - 6} textAnchor="end" className="s-flow-w">{pct(l.weight, 0)}</text>
              <text x={W - 24} y={y + 16} textAnchor="end" className="s-flow-sub">{buffer ? "earns 0%" : `${pct(l.apy)} APR`}</text>
            </g>
          );
        })}

        {/* vault */}
        <circle cx={cx} cy={cy} r="150" fill="url(#core)" />
        <circle cx={cx} cy={cy} r="92" className="s-flow-core" />
        <g transform={`translate(${cx - 46} ${cy - 54}) scale(1.45)`}>
          <Mark size={64} color="#ffffff" />
        </g>
        <text x={cx} y={cy + 128} textAnchor="middle" className="s-flow-v">setsUSDC</text>
      </svg>
      <figcaption>
        {failed
          ? "Live rates are unavailable right now."
          : data
            ? `Base supply APR from ${data.source}, block ${data.block}. Split by Setsuna's rules: at least ${data.bufferPct}% cash, at most 60% in one place, $250K minimum size. Illustration; the vault is in development.`
            : "Loading live rates…"}
      </figcaption>
    </figure>
  );
}
