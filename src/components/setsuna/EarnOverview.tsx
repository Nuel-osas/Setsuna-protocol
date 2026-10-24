"use client";
import Link from "next/link";
import { useWallet } from "./WalletProvider";
import { EarnToken, earnAmount, type EarnAsset } from "./EarnForm";
import { EarnEnvironment, earnRate, earnVenues } from "./EarnVaultLayout";
import { ProtocolLabel } from "./ProtocolIcon";
import { useEarnSummary } from "./useEarnSummary";

/* Earn in the landing's language: a pixel hero over the grid, numbered product
   blocks for each vault, a ruled comparison, the three steps and the three rules. */

const STEPS = [
  ["01", "Deposit once", "Choose MON or USDC. You receive shares in that asset’s vault."],
  ["02", "Let it work", "Published rules allocate across approved markets and rebalance as rates move."],
  ["03", "Withdraw when ready", "Redeem your shares for the underlying asset, subject to available liquidity."],
] as const;
const RULES = [
  ["60", "Max per market", "No single protocol can hold the whole pool."],
  ["10", "Kept as cash", "A buffer for withdrawals beside deployed capital."],
  ["10", "Max per move", "Bounded rebalances, with a cooldown between them."],
] as const;

function PixelBar() {
  return (
    <div className="ax-pbar" aria-hidden="true">
      <i />
      <i />
      <b />
    </div>
  );
}

export default function EarnOverview() {
  const { deployment: d } = useWallet();
  const mon = useEarnSummary("MON"),
    usdc = useEarnSummary("USDC");
  const vault = (asset: EarnAsset) => {
    const snapshot = (asset === "MON" ? mon : usdc).data;
    return snapshot?.healthy ? snapshot : undefined;
  };
  return (
    <main id="main" className="s-app s-unified-earn e-overview ax">
      {/* ── hero ── */}
      <section className="ax-hero">
        <div className="ax-hero-copy">
          <p className="ax-eyebrow">Setsuna Earn</p>
          <h1 className="ax-pixel ax-h1">
            Less to manage.
            <br />
            <span>More in motion.</span>
          </h1>
          <PixelBar />
          <p className="ax-lede">
            One deposit. Automated allocation across Monad lending markets.
            Choose your asset. The vault handles the rest.
          </p>
        </div>
        <div className="ax-hero-side">
          <EarnEnvironment />
          <dl className="ax-hero-stats">
            {(["MON", "USDC"] as const).map((asset) => (
              <div key={asset} className={asset === "MON" ? "is-blue" : ""}>
                <dt>sets{asset} · base APR</dt>
                <dd className="ax-pixel">{earnRate(vault(asset)?.blendedApr)}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ── vaults: the landing's product blocks ── */}
      <section className="ax-section" aria-labelledby="ax-vaults">
        <header className="ax-head">
          <p className="ax-eyebrow">Choose your asset</p>
          <h2 id="ax-vaults" className="ax-pixel ax-h2">Explore vaults</h2>
          <Link className="ax-head-link" href="/portfolio/">
            Your portfolio ↗
          </Link>
        </header>
        <div className="ax-cards">
          {(["MON", "USDC"] as const).map((asset, i) => {
            const snapshot = vault(asset),
              decimals = asset === "MON" ? 18 : 6;
            const m = asset === "MON" ? d?.earnMON : d?.earnUSDC;
            const names = earnVenues(asset, m?.adapters.length ?? 4).map((s) => s.split(" · ")[0]);
            return (
              <Link
                key={asset}
                href={`/earn/${asset.toLowerCase()}/`}
                className={`ax-card is-${asset.toLowerCase()}`}
                aria-label={`Explore sets${asset}`}
              >
                <div className="ax-card-art">
                  <span className="ax-card-tag">
                    0{i + 1} / {asset === "MON" ? "Native asset" : "Stablecoin"}
                  </span>
                  <div className="ax-card-rate">
                    <span>Current base APR</span>
                    <strong className="ax-pixel">{earnRate(snapshot?.blendedApr)}</strong>
                    <em>Variable · 2% of yield only</em>
                  </div>
                </div>
                <div className="ax-card-copy">
                  <div className="ax-card-title">
                    <EarnToken asset={asset} receipt />
                    <h3>sets{asset}</h3>
                    <span className="ax-chip">
                      {asset} → sets{asset}
                    </span>
                  </div>
                  <p>
                    {asset === "MON"
                      ? "Put your MON to work, without managing each lending position."
                      : "A simpler way to earn on USDC, with allocation handled for you."}
                  </p>
                  <dl className="ax-facts">
                    <div>
                      <dt>Total in vault</dt>
                      <dd>
                        {earnAmount(snapshot?.nav, decimals, 2)} {asset}
                      </dd>
                    </div>
                    <div>
                      <dt>1 sets{asset}</dt>
                      <dd>
                        {earnAmount(snapshot?.shareValue, decimals, 6)} {asset}
                      </dd>
                    </div>
                  </dl>
                  <div className="ax-sources">
                    {names.map((name) => (
                      <ProtocolLabel key={name} name={name} size={16} />
                    ))}
                  </div>
                  {(asset === "MON" ? mon : usdc).failed && (
                    <p className="ax-note">
                      {m ? "Vault readings are temporarily unavailable." : "This vault is not connected in this environment."}
                    </p>
                  )}
                  <span className="ax-btn">
                    Explore sets{asset}
                    <span aria-hidden="true">↗</span>
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* ── at a glance: a ruled table ── */}
      <section className="ax-section" id="rates" aria-labelledby="ax-glance">
        <header className="ax-head">
          <p className="ax-eyebrow">Side by side</p>
          <h2 id="ax-glance" className="ax-pixel ax-h2">At a glance</h2>
        </header>
        <div className="ax-table" role="table" aria-label="Compare vaults">
          <div className="ax-tr is-head" role="row">
            <span role="columnheader">Vault</span>
            <span role="columnheader">Base APR</span>
            <span role="columnheader">Total assets</span>
            <span role="columnheader">Receipt</span>
            <span role="columnheader" aria-label="Open" />
          </div>
          {(["MON", "USDC"] as const).map((asset) => (
            <Link key={asset} href={`/earn/${asset.toLowerCase()}/`} className="ax-tr" role="row">
              <span role="cell" className="ax-token">
                <EarnToken asset={asset} />
                {asset}
              </span>
              <span role="cell" className="ax-pixel ax-tr-apr">
                {earnRate(vault(asset)?.blendedApr)}
              </span>
              <span role="cell">
                {earnAmount(vault(asset)?.nav, asset === "MON" ? 18 : 6, 2)} {asset}
              </span>
              <span role="cell">sets{asset}</span>
              <span role="cell" className="ax-tr-go">
                View vault ↗
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* ── how it works ── */}
      <section className="ax-section" aria-labelledby="ax-how">
        <header className="ax-head">
          <p className="ax-eyebrow">Simple on the surface</p>
          <h2 id="ax-how" className="ax-pixel ax-h2">How Earn works</h2>
        </header>
        <ol className="ax-steps">
          {STEPS.map(([n, title, text]) => (
            <li key={n}>
              <span className="ax-pixel ax-step-n">{n}</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ── rules: the landing's "built to move" band ── */}
      <section className="ax-rules" aria-labelledby="ax-rules">
        <div className="ax-rules-copy">
          <p className="ax-eyebrow">The freedom of clear boundaries</p>
          <h2 id="ax-rules" className="ax-pixel ax-h2">
            Built to move.
            <br />
            Bound by rules.
          </h2>
          <Link className="ax-btn is-dark" href="/docs/how-it-works/rebalancing/">
            Read the allocation rules <span aria-hidden="true">↗</span>
          </Link>
        </div>
        <ul className="ax-rule-list">
          {RULES.map(([v, title, text]) => (
            <li key={title}>
              <strong className="ax-pixel">{v}%</strong>
              <div>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <p className="ax-risk">
        {d?.mode === "mainnet"
          ? "Live on Monad mainnet as a capped beta with real funds. Setsuna's contracts are unaudited; deposit only what you can afford to lose. "
          : "Preview only. Deposits require configured mainnet vaults. "}
        Base APR reflects the current allocation, including idle cash; it is not a promised return.{" "}
        <Link href="/docs/">Learn how Setsuna works ↗</Link>
      </p>
    </main>
  );
}
