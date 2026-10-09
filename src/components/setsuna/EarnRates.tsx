"use client";
import { useState } from "react";
import { pct, usd, useEarn } from "./useEarn";

export default function EarnRates({
  compact = false,
  showRate = true,
}: {
  compact?: boolean;
  showRate?: boolean;
}) {
  const { data, failed } = useEarn();
  const [amount, setAmount] = useState("1000");
  const n = Number(amount.replace(/,/g, "")) || 0;
  const yearly = data ? n * data.blendedApr : 0;

  return (
    <div className={`s-rates ${compact ? "is-compact" : ""}`}>
      {!compact && (
        <div className="s-rates-head">
          <div>
            {showRate && (
              <>
                <span className="s-eyebrow">
                  setsUSDC · estimated base rate
                </span>
                <strong className="s-rate-big">
                  {data ? pct(data.blendedApr) : "—"}
                  <small>APR</small>
                </strong>
              </>
            )}
            <p className="s-muted">
              Blended across the split below, idle cash included. Base supply
              rates only: reward incentives are left out because they can stop
              at any time. Setsuna takes no fee.
            </p>
          </div>
          <label className="s-calc">
            <span>If you deposit</span>
            <span className="s-calc-box">
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-label="Deposit amount in USDC"
              />
              <i>USDC</i>
            </span>
            <em>
              ≈{" "}
              <b>
                {yearly.toLocaleString("en-US", { maximumFractionDigits: 2 })}{" "}
                USDC
              </b>{" "}
              a year at today&rsquo;s rates
            </em>
          </label>
        </div>
      )}

      <div className="s-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Destination</th>
              <th className="is-num">Supplied</th>
              <th className="is-num">Withdrawable now</th>
              <th className="is-num">Base APR</th>
              <th className="is-num">Target</th>
            </tr>
          </thead>
          <tbody>
            {(data?.destinations ?? []).map((d) => (
              <tr key={d.key} className={d.eligible ? "" : "is-off"}>
                <th>
                  {d.protocol} · {d.name}
                  <a
                    className="s-addr"
                    href={`https://monadvision.com/address/${d.address}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {d.reason ?? d.detail} · {d.address.slice(0, 6)}…
                    {d.address.slice(-4)}
                  </a>
                </th>
                <td className="is-num">{usd(d.supplyUsd)}</td>
                <td className="is-num">{usd(d.cashUsd)}</td>
                <td className="is-num">{pct(d.apr)}</td>
                <td className="is-num">
                  <span className="s-bar">
                    <span style={{ width: `${(d.weight / 0.6) * 100}%` }} />
                  </span>
                  {pct(d.weight, 0)}
                </td>
              </tr>
            ))}
            <tr className="is-buffer">
              <th>
                Held as cash
                <span className="s-addr">
                  {data && data.idlePct > data.bufferPct
                    ? `${data.bufferPct}% buffer, plus what the caps leave unplaced`
                    : "Buffer for withdrawals"}
                </span>
              </th>
              <td className="is-num">—</td>
              <td className="is-num">All of it</td>
              <td className="is-num">0.00%</td>
              <td className="is-num">
                <span className="s-bar">
                  <span
                    style={{
                      width: `${Math.min(100, ((data?.idlePct ?? 10) / 60) * 100)}%`,
                    }}
                  />
                </span>
                {data?.idlePct ?? 10}%
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="s-footnote">
        {failed ? "Live rates are unavailable right now. " : ""}
        {data &&
          !failed &&
          `Read at Monad block ${data.block}, directly from ${data.source}. `}
        Every destination passed a deposit and full withdrawal on a mainnet
        fork. Rates move and are not promised; a large deposit lowers them. This
        table is mainnet research, not the demo vault’s holdings. The{" "}
        <a href="/app/">public demo</a> accepts synthetic USDC on its separate
        fork and displays that environment’s rates and allocations.
      </p>
    </div>
  );
}
