import { Mark } from "./Brand";
import TokenIcon from "./TokenIcon";
import ProtocolIcon from "./ProtocolIcon";

// Shared 1000×400 canvas: nodes are placed in % of it, rails are drawn in it.
const sources = [
  { asset: "MON" as const, label: "MON", sub: "→ setsMON", y: 130, color: "#9b87ff" },
  { asset: "USDC" as const, label: "USDC", sub: "→ setsUSDC", y: 270, color: "#4d8dff" },
];
const markets = [
  { name: "Aave", y: 50, color: "#7cd4ff" },
  { name: "Morpho", y: 125, color: "#5b7cff" },
  { name: "Euler", y: 200, color: "#f1c145" },
  { name: "Neverland", y: 275, color: "#b78cff" },
  { name: "Curvance", y: 350, color: "#72e0c0" },
];
const hub = { left: 390, right: 610, y: 200 };

const inbound = (y: number) =>
  `M190 ${y} C300 ${y} 290 ${hub.y} ${hub.left} ${hub.y}`;
const outbound = (y: number) =>
  `M${hub.right} ${hub.y} C710 ${hub.y} 700 ${y} 800 ${y}`;

export default function HeroRails() {
  const rails = [
    ...sources.map((s) => ({ d: inbound(s.y), color: s.color })),
    ...markets.map((m) => ({ d: outbound(m.y), color: m.color })),
  ];
  return (
    <div className="m-rails" aria-hidden="true">
      <svg viewBox="0 0 1000 400" preserveAspectRatio="none">
        {rails.map((r, i) => (
          <g key={i}>
            <path className="m-rail" d={r.d} />
            <path
              className="m-rail-pulse"
              d={r.d}
              pathLength={100}
              style={{
                stroke: r.color,
                color: r.color,
                animationDelay: `${-((i * 0.83) % 3.4)}s`,
                animationDuration: `${3.2 + (i % 3) * 0.5}s`,
              }}
            />
          </g>
        ))}
      </svg>

      {sources.map((s) => (
        <span
          key={s.label}
          className="m-rail-node m-rail-source"
          style={{ top: `${(s.y / 400) * 100}%` }}
        >
          <i className={`m-token m-token-${s.asset.toLowerCase()}`}>
            <TokenIcon asset={s.asset} size={s.asset === "MON" ? 20 : 28} />
          </i>
          {s.label} <small>{s.sub}</small>
        </span>
      ))}

      <div className="m-rail-hub">
        <div className="m-rail-hub-card">
          <Mark size={46} />
          <span>setsuna</span>
        </div>
        <small>Allocates by rate</small>
      </div>

      {markets.map((m) => (
        <span
          key={m.name}
          className="m-rail-node m-rail-market"
          style={{ top: `${(m.y / 400) * 100}%` }}
        >
          <ProtocolIcon name={m.name} size={22} />
          {m.name}
        </span>
      ))}
    </div>
  );
}
