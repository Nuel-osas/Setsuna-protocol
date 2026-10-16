"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useEarn, usd } from "@/components/setsuna/useEarn";
import { HexCell, hexStyle, type Hex } from "./Hex";

// Protocol logos are drawn for dark grounds, so they sit on ink cells.
const hexes: Hex[] = [
  { c: 1, r: 0, fill: "glass" },
  { c: 2, r: 0, fill: "ink", logo: "Morpho" },
  { c: 3, r: 0, fill: "paper" },
  { c: 0, r: 1, fill: "ink", logo: "Aave" },
  { c: 1, r: 1, fill: "blue", kind: "apr" },
  { c: 2, r: 1, fill: "paper", kind: "info" },
  { c: 3, r: 1, fill: "ink", logo: "Euler" },
  { c: 0, r: 2, fill: "grid" },
  { c: 1, r: 2, fill: "paper", kind: "mark" },
  { c: 2, r: 2, fill: "glass", token: "USDC" },
  { c: 1, r: 3, fill: "ink", logo: "Neverland" },
  { c: 2, r: 3, fill: "blue", token: "MON" },
  { c: 3, r: 3, fill: "deep", logo: "Curvance" },
];

const STEP_MS = 2600; // how long the light rests on each cell
const FIRST_MS = 3600; // wait for the hero intro before the first change

// The light's route: a walk through neighbouring cells that skips the centre and
// the supplied cell, which answer whenever the light is on a market.
const WALK = [0, 1, 2, 6, 9, 11, 12, 10, 8, 7, 3];

type Destination = NonNullable<ReturnType<typeof useEarn>["data"]>["destinations"][number];
type Fact = { value: string; label: string; spot?: Destination };

// "Aave V3" and "Morpho Blue" match the hexagons' "Aave" and "Morpho".
const keyOf = (name: string) => name.trim().split(/[\s·]/)[0].toLowerCase();
const onCluster = new Set(hexes.flatMap((h) => (h.logo ? [keyOf(h.logo)] : [])));

/** Text that rolls in like the headline: each letter slides through its shadow copies. */
function Roll({ text }: { text: string }) {
  return (
    <span className="lx-roll" key={text}>
      {Array.from(text).map((ch, i) => (
        <span className="lx-lw" key={i}>
          <span className="lx-ch" style={{ animationDelay: `${((i * 37) % 10) * 0.045}s` }}>
            {ch === " " ? "\u00a0" : ch}
          </span>
        </span>
      ))}
    </span>
  );
}

/**
 * The hero cluster as a live view of the vault: a light walks from cell to
 * cell and each one turns over to a fact. On a market it rolls the centre to
 * that market's supply APR and the cell beside it to the market's size; after a
 * full lap it rests on the blended rate.
 */
export default function HeroHexes() {
  const { data, failed } = useEarn();
  const ref = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(-1); // -1: resting on the blended rate

  // One row per protocol on the cluster, the vault's largest position in each.
  const spots = useMemo(() => {
    if (!data || failed) return new Map<string, Destination>();
    const best = new Map<string, Destination>();
    for (const d of data.destinations) {
      const k = keyOf(d.protocol);
      if (!onCluster.has(k) || !(d.apr > 0)) continue;
      const cur = best.get(k);
      if (!cur || d.weight > cur.weight || (d.weight === cur.weight && d.supplyUsd > cur.supplyUsd)) best.set(k, d);
    }
    return best;
  }, [data, failed]);

  // What each cell says when the light lands on it. Protocol cells with a live
  // market show their share (and drive the centre and the supplied cell);
  // every other cell carries one fact about the vault.
  const facts = useMemo((): (Fact | undefined)[] => {
    if (!data || failed) return hexes.map(() => undefined);
    return hexes.map((h, i) => {
      const spot = h.logo ? spots.get(keyOf(h.logo)) : undefined;
      if (spot) return { value: `${Math.round(spot.weight * 100)}%`, label: spot.weight > 0 ? "of the vault" : "watching", spot };
      switch (i) {
        case 0:
          return { value: String(data.destinations.length), label: "markets read" };
        case 2:
          return { value: "Anyone", label: "can rebalance" };
        case 7:
          return { value: "60%", label: "cap per market" };
        case 8:
          return { value: `${Math.round(data.idlePct)}%`, label: "cash buffer" };
        case 9:
          return { value: "2,000", label: "USDC cap" };
        case 11:
          return { value: "25,000", label: "MON cap" };
        default:
          return h.logo ? { value: "Approved", label: "market" } : undefined;
      }
    });
  }, [data, failed, spots]);

  const stops = useMemo(() => (facts.some(Boolean) ? WALK.filter((i) => facts[i]) : []), [facts]);

  useEffect(() => {
    if (!stops.length || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    if (ref.current) io.observe(ref.current);
    let timer: ReturnType<typeof setTimeout>;
    const next = () => {
      if (visible && !document.hidden) setStep((s) => (s + 1 >= stops.length ? -1 : s + 1));
      timer = setTimeout(next, STEP_MS);
    };
    timer = setTimeout(next, FIRST_MS);
    return () => {
      clearTimeout(timer);
      io.disconnect();
    };
  }, [stops]);

  const at = step >= 0 ? stops[step] : -1;
  const active = at >= 0 ? facts[at]?.spot : undefined;
  // The supplied cell keeps showing the last market while it slides away.
  const last = useRef(active);
  if (active) last.current = active;
  const shown = last.current;
  const blended = data && !failed ? `${(data.blendedApr * 100).toFixed(2)}%` : "-.--%";

  return (
    <div className={`lx-hero-hexes ${at >= 0 ? "has-spot" : ""}`} aria-hidden="true" data-hexes ref={ref}>
      {hexes.map((h, i) => {
        const fact = facts[i];
        const here = at === i;
        let back;
        if (fact)
          back = (
            <span className="lx-hex-stat">
              <b className={`lx-pixel ${fact.value.length > 5 ? "is-long" : ""}`}>{fact.value}</b>
              <small>{fact.label}</small>
            </span>
          );
        if (h.kind === "info")
          back = (
            <span className="lx-hex-stat">
              <b className={`lx-pixel ${shown && usd(shown.supplyUsd).length > 5 ? "is-long" : ""}`}>{shown ? usd(shown.supplyUsd) : ""}</b>
              <small>supplied</small>
            </span>
          );
        const flipped = here || (h.kind === "info" && !!active);
        const lit = flipped || h.kind === "apr";
        return (
          <div className="lx-hex-slot" key={i} style={hexStyle(h, "var(--hw)")} data-hex>
            <HexCell hex={h} back={back} flipped={flipped} className={lit ? "is-lit" : ""}>
              {h.kind === "apr" && (
                <span className={`lx-apr ${data && !failed ? "" : "is-loading"}`} aria-live="polite">
                  <b className="lx-pixel">
                    <Roll text={active ? `${(active.apr * 100).toFixed(2)}%` : blended} />
                  </b>
                  {/* Phones get a shorter label; the cell is too narrow for the full one. */}
                  <small className="lx-apr-wide">
                    <Roll text={active ? `${active.protocol} APR` : "base APR · live"} />
                  </small>
                  <small className="lx-apr-narrow">
                    <Roll text={active ? active.protocol : "base APR"} />
                  </small>
                </span>
              )}
            </HexCell>
          </div>
        );
      })}
    </div>
  );
}
