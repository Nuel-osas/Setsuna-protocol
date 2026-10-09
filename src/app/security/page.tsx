import type { Metadata } from "next";
import Link from "next/link";
import { forkProofs } from "@/lib/setsuna/site";

export const metadata: Metadata = { title: "Security & risks · Setsuna" };

const controls = [
  ["Hard cap per market", "No destination may hold more than 60% of the pool, so one failing market cannot take everything."],
  ["Cash kept back", "At least 10% stays as USDC for withdrawals. What the caps can't place stays as cash too, never forced into a market."],
  ["Size gate", "Markets with less than $250K supplied are skipped. A small market can't absorb deposits or pay them back."],
  ["Base rates only", "Targets use the rate borrowers pay, read from chain. Reward incentives are ignored because they can stop at any time."],
  ["Permissionless, bounded rebalancing", "Anyone can rebalance, but only toward published targets, between approved markets, in bounded steps."],
  ["Self-custody", "Passkey accounts through Mera. Setsuna never holds keys, and withdrawals need no operator."],
] as const;

const risks = [
  ["Lending market risk", "Each destination can suffer bad debt, an oracle failure or a contract bug. Caps limit the damage; they don't remove it."],
  ["Collateral dependency", "Morpho aHYPER/USDC lends against shares of the Hyperithm Delta Neutral Vault. That market depends on that one strategy."],
  ["Withdrawals can wait", "At high utilisation a market's cash runs thin; Euler had about $433K withdrawable against $5.8M supplied when tested. A withdrawal larger than available cash is refused, not short-paid."],
  ["Rates move", "Every rate shown is today's. A large deposit lowers it. Nothing here is a promise or a forecast."],
] as const;

export default function Page() {
  return (
    <main id="main" className="s-page">
      <header className="s-page-head">
        <span className="s-eyebrow">Security &amp; risks</span>
        <h1>
          Limits in code. <em>Risks in plain sight.</em>
        </h1>
        <p className="s-lede">
          What the vault enforces, what we tested, what can still go wrong, and what isn&rsquo;t done yet. setsUSDC is in development, unaudited, and accepts no deposits.
        </p>
      </header>

      <section className="s-page-sec" aria-labelledby="controls-title">
        <span className="s-eyebrow">
          <b>01</b> Controls
        </span>
        <h2 id="controls-title">
          Six rules <em>the vault is built to enforce.</em>
        </h2>
        <div className="s-control-grid">
          {controls.map(([t, b], i) => (
            <article key={t}>
              <span>{String(i + 1).padStart(2, "0")}</span>
              <h3>{t}</h3>
              <p>{b}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="s-page-sec" aria-labelledby="proofs-title">
        <span className="s-eyebrow">
          <b>02</b> Tested on a mainnet fork
        </span>
        <h2 id="proofs-title">
          Deposit, wait a week, <em>take it all back.</em>
        </h2>
        <p className="s-lede">Each market got 1,000 USDC on a fork of Monad mainnet, seven days of simulated time, then a full withdrawal. Every transaction was checked for success. Simulated time, no outside trades: this proves the path works, not what it will earn.</p>
        <div className="s-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Market</th>
                <th className="is-num">Fork block</th>
                <th className="is-num">Result</th>
                <th className="is-num">Annualised</th>
              </tr>
            </thead>
            <tbody>
              {forkProofs.map((f) => (
                <tr key={f.name}>
                  <th>
                    {f.name}
                    <span className="s-addr">Run by {f.by}</span>
                  </th>
                  <td className="is-num">{f.block}</td>
                  <td className="is-num">{f.result}</td>
                  <td className="is-num">{f.apr}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="s-footnote">Euler deposits reverted under estimated gas and succeeded with an explicit 1.5M limit; Setsuna&rsquo;s adapters and keepers must set gas explicitly. Morpho WBTC/USDC passed but is currently below the $250K gate.</p>
      </section>

      <section className="s-page-sec" aria-labelledby="risks-title">
        <span className="s-eyebrow">
          <b>03</b> Known risks
        </span>
        <h2 id="risks-title">
          What can <em>still go wrong.</em>
        </h2>
        <ol className="s-rule-list is-light">
          {risks.map(([t, b], i) => (
            <li key={t}>
              <span>{String(i + 1).padStart(2, "0")}</span>
              <div>
                <h3>{t}</h3>
                <p>{b}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="s-page-sec" aria-labelledby="status-title">
        <span className="s-eyebrow">
          <b>04</b> Status
        </span>
        <h2 id="status-title">
          Not done yet, <em>said plainly.</em>
        </h2>
        <ul className="s-status">
          <li className="is-done">Live rate reads from all five markets</li>
          <li className="is-done">Fork round trips for all five markets</li>
          <li className="is-done">setsUSDC contract prototype, fork-tested</li>
          <li>Public deployment</li>
          <li>Independent audit</li>
          <li>Deposits</li>
        </ul>
        <Link className="s-link" href="/evidence/">
          See the Perpl evidence
        </Link>
      </section>
    </main>
  );
}
