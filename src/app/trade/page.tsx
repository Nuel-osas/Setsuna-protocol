import type { Metadata } from "next";
import Link from "next/link";
import InstantChart from "@/components/setsuna/InstantChart";
import { evidence as e } from "@/lib/setsuna/evidence";
import { stepIn } from "@/lib/setsuna/presets";

export const metadata: Metadata = { title: "Spot & Perps · Setsuna" };

const steps = [
  [
    "Set a budget",
    "Move AUSD into a protection reserve and choose the most Setsuna may ever add. That cap is enforced by the contract.",
  ],
  [
    "Choose when it steps in",
    "Early, balanced or late: how close to maintenance margin a position may drift before margin is added.",
  ],
  [
    "Margin arrives in the instant",
    "When a position nears the line, Setsuna tops it up from the reserve. It never opens, closes or resizes a trade.",
  ],
] as const;

export default function Page() {
  return (
    <main id="main" className="s-page">
      <header className="s-page-head is-split">
        <div>
          <span className="s-eyebrow">
            Trade &amp; protect · in development
          </span>
          <h1>
            Your next move. <em>Spot or Perps.</em>
          </h1>
          <p className="s-lede">
            Swap MON and USDC through Kuru, or trade AUSD-funded BTC perpetuals
            on Perpl. Keep trading balances separate from your Earn vaults.
            Perps include an optional, capped reserve for margin top-ups; it
            reduces some liquidation exposure but cannot guarantee protection.
          </p>
          <div className="s-row">
            <Link className="s-btn is-primary" href="/app/?tab=spot">
              Open Spot
            </Link>
            <Link className="s-btn is-quiet" href="/app/?tab=perps">
              Open Perps
            </Link>
          </div>
          <p className="s-footnote">
            Available in the local fork demo with synthetic funds. The Perps
            demo uses a disclosed historical-price fixture. Public trading is
            closed.
          </p>
        </div>
        <InstantChart />
      </header>

      <section className="s-page-sec" aria-labelledby="how-title">
        <span className="s-eyebrow">
          <b>01</b> How protection works
        </span>
        <h2 id="how-title">
          A budget, <em>not a blank cheque.</em>
        </h2>
        <ol className="s-steps">
          {steps.map(([t, b], i) => (
            <li key={t}>
              <b>{String(i + 1).padStart(2, "0")}</b>
              <h3>{t}</h3>
              <p>{b}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="s-page-sec" aria-labelledby="presets-title">
        <span className="s-eyebrow">
          <b>02</b> Step-in settings
        </span>
        <h2 id="presets-title">
          You decide <em>how close is too close.</em>
        </h2>
        <div className="s-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Setting</th>
                <th className="is-num">Steps in at</th>
                <th className="is-num">Restores to</th>
                <th>In practice</th>
              </tr>
            </thead>
            <tbody>
              {Object.values(stepIn).map((p) => (
                <tr key={p.label}>
                  <th>{p.label}</th>
                  <td className="is-num">
                    +{p.trigger / 100}% over maintenance
                  </td>
                  <td className="is-num">
                    +{p.target / 100}% over maintenance
                  </td>
                  <td>{p.blurb}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="s-footnote">
          On Perpl, {e.manualTopUpAccounts} of {e.activeAccounts} active
          accounts added margin by hand in the {e.window}, and {e.liquidations}{" "}
          positions were liquidated. Trading collateral and the protection
          reserve use AUSD; Earn shares are never used as collateral.
        </p>
      </section>
    </main>
  );
}
