"use client";
/**
 * The hero: a long position drifting toward liquidation, and the instant
 * Setsuna adds margin. Illustrative motion only; no market data.
 */
import { useEffect, useRef, useState } from "react";

const W = 1200;
const H = 560;
const N = 240;
const INSTANT = 0.64; // share of the loop at which Setsuna acts
const LOOP_MS = 9000;
const LIQ_BEFORE = 452;
const LIQ_AFTER = 522;

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// Deterministic price walk: drifts down toward the liquidation line, bounces after the instant.
const points: [number, number][] = (() => {
  const r = seeded(4471);
  const pts: [number, number][] = [];
  let y = 150;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const pull = t < INSTANT ? 0.8 * Math.pow(t / INSTANT, 1.25) : 0.8 - 0.45 * Math.pow((t - INSTANT) / (1 - INSTANT), 0.8);
    const target = 120 + pull * 440;
    y += (target - y) * 0.12 + (r() - 0.5) * 20;
    if (t < INSTANT) y = Math.min(y, LIQ_BEFORE - 7 - (1 - t / INSTANT) * 24);
    pts.push([(t * W), Math.max(40, y)]);
  }
  return pts;
})();

const pathD = points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
const instantPoint = points[Math.round(INSTANT * (N - 1))];

export default function InstantChart() {
  const [p, setP] = useState(1);
  const reduce = useRef(false);

  useEffect(() => {
    reduce.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce.current) {
      setP(1);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = (Math.max(0, now - start) % LOOP_MS) / LOOP_MS;
      // draw over 85% of the loop, hold the final frame for the rest
      setP(Math.min(1, t / 0.85));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const acted = p >= INSTANT;
  const since = acted ? Math.min(1, (p - INSTANT) / 0.06) : 0;
  const ease = 1 - Math.pow(1 - since, 3);
  const liq = LIQ_BEFORE + (LIQ_AFTER - LIQ_BEFORE) * ease;
  const head = points[Math.min(N - 1, Math.round(p * (N - 1)))];
  const gap = Math.max(0, liq - head[1]);

  return (
    <figure className="s-instant" aria-label="Illustration: a position drifts toward liquidation until Setsuna adds margin and the liquidation price moves away.">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img">
        <defs>
          <linearGradient id="danger" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--danger)" stopOpacity="0" />
            <stop offset="1" stopColor="var(--danger)" stopOpacity="0.28" />
          </linearGradient>
          <linearGradient id="trail" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="var(--paper)" stopOpacity="0.12" />
            <stop offset="0.55" stopColor="var(--paper)" stopOpacity="0.6" />
            <stop offset="1" stopColor="var(--paper)" stopOpacity="1" />
          </linearGradient>
          <clipPath id="reveal">
            <rect x="0" y="0" width={p * W} height={H} />
          </clipPath>
        </defs>

        {[1, 2, 3, 4, 5, 6, 7].map((i) => (
          <line key={i} x1={(i * W) / 8} x2={(i * W) / 8} y1="0" y2={H} className="s-instant-grid" />
        ))}
        {[1, 2, 3].map((i) => (
          <line key={i} y1={(i * H) / 4} y2={(i * H) / 4} x1="0" x2={W} className="s-instant-grid" />
        ))}

        <rect x="0" y={liq - 90} width={W} height={90} fill="url(#danger)" />
        {acted && (
          <g style={{ opacity: 0.55 * ease }}>
            <line x1="0" x2={W} y1={LIQ_BEFORE} y2={LIQ_BEFORE} className="s-instant-ghost" />
            <text x="16" y={LIQ_BEFORE - 10} className="s-instant-ghost-label">
              WAS HERE
            </text>
          </g>
        )}
        <line x1="0" x2={W} y1={liq} y2={liq} className="s-instant-liq" />
        <text x={W - 16} y={liq - 10} textAnchor="end" className="s-instant-label">
          LIQUIDATION
        </text>

        <path d={pathD} clipPath="url(#reveal)" className="s-instant-path" stroke="url(#trail)" />

        {acted && (
          <g style={{ opacity: Math.min(1, since * 3) }}>
            <line x1={instantPoint[0]} x2={instantPoint[0]} y1="0" y2={H} className="s-instant-mark" />
            <circle cx={instantPoint[0]} cy={instantPoint[1]} r={10 + 26 * (1 - ease)} className="s-instant-ripple" style={{ opacity: 1 - ease }} />
            <circle cx={instantPoint[0]} cy={instantPoint[1]} r="5" className="s-instant-dot" />
            <g transform={`translate(${instantPoint[0] + 18}, 34)`}>
              <text className="s-instant-tag">SETSUNA STEPPED IN</text>
              <text y="26" className="s-instant-sub">+48.20 AUSD margin · 1 block</text>
            </g>
          </g>
        )}

        <circle cx={head[0]} cy={head[1]} r="4" className="s-instant-head" />
      </svg>
      <figcaption className="s-instant-hud">
        <span>
          <em>BTC-PERP</em> · long 10×
        </span>
        <span className={gap < 40 && !acted ? "is-danger" : acted ? "is-safe" : ""}>
          Runway <strong>{(gap / 4.6).toFixed(1)}%</strong>
        </span>
      </figcaption>
    </figure>
  );
}
