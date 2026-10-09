import type { Metadata } from "next";
import Link from "next/link";
import AllocationRibbon from "@/components/setsuna/AllocationRibbon";
import EarnRates from "@/components/setsuna/EarnRates";

export const metadata: Metadata = { title: "Earn · Setsuna" };

const steps = [
  [
    "Deposit",
    "Choose MON or USDC and receive setsMON or setsUSDC. Each share represents your portion of that asset’s independent vault.",
  ],
  [
    "Earn",
    "The vault reads approved markets’ base supply rates and allocates within published limits: a 60% destination cap and a 10% target cash buffer. Each market must pass the vault’s eligibility rules.",
  ],
  [
    "Withdraw",
    "Redeem shares for their current underlying asset value, including interest or losses. Exits require healthy valuation and available liquidity; select a smaller amount if liquidity is limited.",
  ],
] as const;

export default function Page() {
  return (
    <main id="main" className="s-page">
      <header className="s-page-head">
        <span className="s-eyebrow">Earn · MON & USDC · in development</span>
        <h1>
          One deposit. <em>Every market, weighed live.</em>
        </h1>
        <p className="s-lede">
          Put MON or USDC to work in separate ERC-4626 vaults. Each reads
          approved lending markets&rsquo; base supply rates on Monad and sets
          targets by a rule anyone can check. Receive setsMON or setsUSDC,
          inspect where the assets are supplied, and redeem when liquidity
          allows. Try it with synthetic funds in the local demo; public deposits
          are closed.
        </p>
        <div className="s-row">
          <Link className="s-btn is-primary" href="/app/">
            Open Earn
          </Link>
          <Link className="s-btn is-quiet" href="/security/">
            Read the risks
          </Link>
        </div>
      </header>

      <section className="s-page-sec" id="rates" aria-labelledby="rates-title">
        <span className="s-eyebrow">
          <b>01</b> USDC research · Monad mainnet
        </span>
        <h2 id="rates-title">
          A view into <em>the markets.</em>
        </h2>
        <p className="s-lede">
          These USDC rates are live mainnet research. The displayed split is
          hypothetical, not the local demo’s holdings. The app shows balances
          and rates from its own environment. The USDC vault excludes markets
          below its 250,000 USDC supply floor.
        </p>
        <div className="s-page-ribbon">
          <AllocationRibbon />
        </div>
        <EarnRates />
      </section>

      <section className="s-page-sec" aria-labelledby="flow-title">
        <span className="s-eyebrow">
          <b>02</b> How it works
        </span>
        <h2 id="flow-title">
          Deposit. Earn. <em>Withdraw.</em>
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

      <section className="s-page-sec" id="next" aria-labelledby="next-title">
        <span className="s-eyebrow">
          <b>03</b> Native MON · fork-tested
        </span>
        <h2 id="next-title">
          setsMON, <em>same rules.</em>
        </h2>
        <p className="s-lede">
          A separate vault for MON, following the same pattern: one share,
          approved lending markets, published targets, no Setsuna fee. It is a
          second, independent pool; a USDC depositor never takes on MON price
          exposure. Native MON deposits, Neverland and Euler lending, share
          accounting, and native MON withdrawals are implemented and tested on a
          mainnet fork. The local app demo uses synthetic funds; public deposits
          are closed.
        </p>
      </section>
    </main>
  );
}
