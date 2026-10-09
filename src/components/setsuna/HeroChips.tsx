"use client";
import { pct, useEarn } from "./useEarn";

/** Live readings floating over the hero photo. */
export default function HeroChips() {
  const { data, failed } = useEarn();
  const ok = data && !failed;
  const top = ok ? [...data.destinations].filter((d) => d.eligible).sort((a, b) => b.weight - a.weight).slice(0, 3) : [];
  return (
    <div className="s-chips" aria-hidden="true">
      <div className="s-chip is-a">
        <span className="s-chip-k">
          <i /> setsUSDC · live
        </span>
        <strong>{ok ? `+${pct(data.blendedApr)}` : "—"}</strong>
        <span className="s-chip-s">estimated base APR</span>
      </div>
      <div className="s-chip is-b">
        <span className="s-chip-k">Where it&rsquo;s working</span>
        <ul>
          {top.map((d) => (
            <li key={d.key}>
              <span>{d.protocol}</span>
              <b>{pct(d.weight, 0)}</b>
            </li>
          ))}
          {!top.length && <li>Reading Monad…</li>}
        </ul>
      </div>
      <div className="s-chip is-c">
        <span className="s-chip-k">Held as cash</span>
        <strong>{ok ? `${data.idlePct}%` : "10%"}</strong>
        <span className="s-chip-s">for instant withdrawals</span>
      </div>
    </div>
  );
}
