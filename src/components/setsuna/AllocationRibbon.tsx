"use client";
import { pct, usd, useEarn } from "./useEarn";

const tones = ["var(--blue)", "#4F60FF", "#8A96FF", "#C2C8FF"];

/** The whole pool as one ribbon: each destination's target share, then the cash buffer. */
export default function AllocationRibbon() {
  const { data, failed } = useEarn();
  const all = data?.destinations ?? [];
  const rows = all.filter((d) => d.weight > 0).sort((a, b) => b.weight - a.weight);
  const skipped = all.filter((d) => d.weight === 0);
  const buffer = (data?.idlePct ?? 10) / 100;
  return (
    <figure className="s-ribbon" aria-label="How setsUSDC would split a deposit today">
      <div className="s-ribbon-top">
        <span className="s-eyebrow">If you deposited today</span>
        <span className="s-ribbon-live">
          <i />
          {failed ? "Rates unavailable" : data ? "Live from Monad mainnet" : "Loading"}
        </span>
      </div>
      <div className="s-ribbon-bar" role="img" aria-label={rows.map((r) => `${r.protocol} ${pct(r.weight, 0)}`).join(", ") + `, cash ${pct(buffer, 0)}`}>
        {rows.map((r, i) => (
          <span key={r.key} style={{ flexGrow: r.weight, background: tones[i % tones.length] }} />
        ))}
        <span className="is-cash" style={{ flexGrow: buffer }} />
      </div>
      <ol className="s-ribbon-list">
        {rows.map((r, i) => (
          <li key={r.key}>
            <b style={{ background: tones[i % tones.length] }} />
            <span className="s-ribbon-name">
              {r.protocol}
              <small>
                {r.name} · {usd(r.supplyUsd)}
              </small>
            </span>
            <span className="s-ribbon-apy">{pct(r.apr)}</span>
            <span className="s-ribbon-w">{pct(r.weight, 0)}</span>
          </li>
        ))}
        {skipped.map((r) => (
          <li key={r.key} className="is-skipped">
            <b />
            <span className="s-ribbon-name">
              {r.protocol}
              <small>{r.reason}</small>
            </span>
            <span className="s-ribbon-apy">{pct(r.apr)}</span>
            <span className="s-ribbon-w">0%</span>
          </li>
        ))}
        <li>
          <b className="is-cash" />
          <span className="s-ribbon-name">
            Held as cash
            <small>{data && data.idlePct > data.bufferPct ? `${data.bufferPct}% buffer + unplaced` : "For instant withdrawals"}</small>
          </span>
          <span className="s-ribbon-apy">0.00%</span>
          <span className="s-ribbon-w">{pct(buffer, 0)}</span>
        </li>
      </ol>
    </figure>
  );
}
