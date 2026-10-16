"use client";
import ProtocolIcon from "@/components/setsuna/ProtocolIcon";
import { useEarn } from "@/components/setsuna/useEarn";

/** The live blended base rate, set inside the hero's blue hexagon. */
export function LiveApr() {
  const { data, failed } = useEarn();
  const v = data && !failed ? (data.blendedApr * 100).toFixed(2) : null;
  return (
    <span className={`lx-apr ${v ? "" : "is-loading"}`} aria-live="polite">
      <b className="lx-pixel">{v ?? "-.--"}%</b>
      <small>base APR · live</small>
    </span>
  );
}

/** Setsuna's current target split, read from the same snapshot the vault uses. */
export function LiveAllocation() {
  const { data, failed } = useEarn();
  const rows =
    data && !failed
      ? data.destinations
          .filter((d) => d.weight > 0)
          .sort((a, b) => b.weight - a.weight)
          .slice(0, 4)
          .map((d) => ({ name: d.protocol, weight: d.weight, apr: d.apr }))
      : [];
  // idlePct is a percentage (10 means 10%), unlike the 0–1 weights.
  const buffer = data && !failed ? data.idlePct / 100 : 0.1;
  return (
    <div className="lx-alloc">
      <div className="lx-alloc-head">
        <span>Target split · USDC vault</span>
        <span className={`lx-live ${rows.length ? "" : "is-loading"}`}>
          <i /> {rows.length ? "Live" : "Loading"}
        </span>
      </div>
      {(rows.length ? rows : Array.from({ length: 4 }, (_, i) => ({ name: "", weight: 0.2 - i * 0.03, apr: 0 }))).map(
        (r, i) => (
          <div className="lx-alloc-row" key={r.name || i}>
            <span className="lx-alloc-name">
              {r.name && <ProtocolIcon name={r.name} size={18} />}
              {r.name || "—"}
            </span>
            <span className="lx-alloc-bar">
              <i style={{ transform: `scaleX(${Math.min(1, r.weight / 0.6)})` }} />
            </span>
            <span className="lx-alloc-num">{r.name ? `${(r.weight * 100).toFixed(0)}%` : "—"}</span>
          </div>
        ),
      )}
      <div className="lx-alloc-row is-buffer">
        <span className="lx-alloc-name">Cash buffer</span>
        <span className="lx-alloc-bar">
          <i style={{ transform: `scaleX(${Math.min(1, buffer / 0.6)})` }} />
        </span>
        <span className="lx-alloc-num">{(buffer * 100).toFixed(0)}%</span>
      </div>
      <p className="lx-alloc-foot">Cap 60% per destination · bars scaled to the cap</p>
    </div>
  );
}

export function LiveBlock() {
  const { data } = useEarn();
  return <span className="lx-block">{data?.block ? `Block ${Number(data.block).toLocaleString("en-US")}` : "Monad mainnet"}</span>;
}
