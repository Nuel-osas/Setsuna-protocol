"use client";
import { usd, useEarn } from "./useEarn";

/** Three live facts under the hero call to action. */
export default function HeroStats() {
  const { data, failed } = useEarn();
  const rows = failed ? [] : (data?.destinations ?? []);
  const live = rows.filter((d) => d.eligible);
  const depth = live.reduce((s, d) => s + d.supplyUsd, 0);
  return (
    <dl className="s-hero-stats">
      <div>
        <dt>Markets in use</dt>
        <dd>{rows.length ? `${live.length} of ${rows.length}` : "—"}</dd>
      </div>
      <div>
        <dt>Supplied to them today</dt>
        <dd>{live.length ? usd(depth) : "—"}</dd>
      </div>
      <div>
        <dt>Setsuna fee</dt>
        <dd>0%</dd>
      </div>
    </dl>
  );
}
