"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import type { MONSnapshot } from "@/lib/setsuna/mon";
import type { USDCSnapshot } from "@/lib/setsuna/usdc";
import { useWallet } from "./WalletProvider";
import { EarnToken, earnAmount, type EarnAsset } from "./EarnForm";
import { useEarnSummary } from "./useEarnSummary";
import type { EarnSummary } from "@/lib/setsuna/earn-summary";
import ProtocolIcon, { ProtocolLabel } from "./ProtocolIcon";

export const earnRate = (rate?: bigint) =>
  rate === undefined ? "—" : `${(Number(rate) / 1e16).toFixed(2)}%`;
export const earnVenues = (asset: EarnAsset, count = 5) =>
  asset === "MON"
    ? ["Neverland · WMON", "Euler · WMON / shMON"]
    : [
        "Aave · USDC reserve",
        "Morpho · aHYPER / USDC",
        "Euler · eUSDC-12",
        "Neverland · USDC reserve",
        "Curvance · wsrUSD / USDC",
      ].slice(0, count);
const colors = [
  "var(--b-accent)",
  "var(--b-green)",
  "var(--b-violet)",
  "var(--b-warning)",
  "var(--b-chart)",
  "var(--b-faint)",
];
function EarnNetworkNote() {
  const { deployment: d } = useWallet();
  return (
    <p className="e-demo-note">
      {d?.mode === "mainnet"
        ? "Monad mainnet with real funds. Capped beta: setsUSDC holds at most 2,000 USDC and setsMON 25,000 MON. Setsuna's contracts are unaudited; deposit only what you can afford to lose."
        : "Preview only. Deposits are unavailable until the mainnet vaults are configured."}
    </p>
  );
}
export function EarnEnvironment() {
  const { deployment: d } = useWallet();
  return (
    <span className="e-environment">
      <i />
      {d?.mode === "mainnet"
        ? "Monad mainnet · Capped beta"
        : "Preview · Deposits closed"}
    </span>
  );
}
export function EarnAllocation({
  asset,
  snapshot,
  destinations,
}: {
  asset: EarnAsset;
  snapshot?: EarnSummary | MONSnapshot | USDCSnapshot;
  destinations: string[];
}) {
  const decimals = asset === "MON" ? 18 : 6;
  const rows = [
    ...destinations,
    `Cash buffer · ${asset === "MON" ? "WMON" : "USDC"}`,
  ];
  const weight = (amount?: bigint) =>
    amount === undefined || !snapshot?.nav
      ? undefined
      : Number((amount * BigInt(10_000)) / snapshot.nav) / 100;
  return (
    <section className="e-panel" aria-label="Vault allocation">
      <header className="e-section-head">
        <div>
          <h2>Where your {asset} works</h2>
          <p>One vault. {destinations.length} lending protocols.</p>
        </div>
        <span>Current allocation</span>
      </header>
      <div className="e-allocation-bar" aria-hidden="true">
        {rows.map((label, i) => (
          <span
            key={label}
            style={{
              width: `${weight(i === destinations.length ? snapshot?.idle : snapshot?.positions[i]) ?? 0}%`,
              background: colors[i],
            }}
          />
        ))}
      </div>
      <div className="e-venues">
        {rows.map((label, i) => {
          const cash = i === destinations.length;
          const position = cash ? snapshot?.idle : snapshot?.positions[i];
          const percent = weight(position);
          const liquidity =
            snapshot && "liquidity" in snapshot && !cash
              ? snapshot.liquidity[i]
              : undefined;
          const parts = label.split(" · ");
          return (
            <article className="e-venue" key={label}>
              <div className="e-venue-title">
                <span className="e-venue-mark" aria-hidden="true">
                  <ProtocolIcon name={parts[0]} size={22} />
                </span>
                <div>
                  <h3>{parts[0]}</h3>
                  <span>{parts[1]}</span>
                </div>
                <strong>
                  {percent === undefined ? "—" : `${percent.toFixed(1)}%`}
                </strong>
              </div>
              <dl>
                <div>
                  <dt>Supplied</dt>
                  <dd>
                    {earnAmount(position, decimals, 3)} {asset}
                  </dd>
                </div>
                <div>
                  <dt>
                    {parts[0] === "Curvance" ? "Est. base APR" : "Base APR"}
                  </dt>
                  <dd>{cash ? "0.00%" : earnRate(snapshot?.rates[i])}</dd>
                </div>
              </dl>
              {liquidity && (
                <p className="e-venue-status">{liquidity.reason}</p>
              )}
            </article>
          );
        })}
      </div>
      <p className="e-note">
        Rates are variable. Allocation follows liquidity checks, a 60%
        destination cap and a 10% target cash buffer. Lending can incur losses;
        withdrawals depend on available liquidity.
        {asset === "USDC" && destinations.length === 5
          ? " Curvance’s rate is a conservative model estimate."
          : ""}
      </p>
    </section>
  );
}
export default function EarnVaultLayout({
  asset,
  snapshot,
  form,
  alerts,
  destinations,
}: {
  asset: EarnAsset;
  snapshot?: MONSnapshot | USDCSnapshot;
  form: ReactNode;
  alerts: ReactNode;
  // Kept for callers; the simplified page links to the docs for these instead.
  advanced?: ReactNode;
  risk?: ReactNode;
  controls?: ReactNode;
  destinations: string[];
}) {
  const { address } = useWallet();
  const { data: summary } = useEarnSummary(asset);
  const headline =
    snapshot && (!summary || snapshot.block >= summary.block)
      ? snapshot
      : summary;
  const view = headline?.healthy ? headline : undefined;
  const decimals = asset === "MON" ? 18 : 6;
  const sound = snapshot?.healthy;
  const rows = [...destinations, `Cash · ${asset === "MON" ? "WMON" : "USDC"}`];
  const weight = (amount?: bigint) =>
    amount === undefined || !view?.nav
      ? undefined
      : Number((amount * BigInt(10_000)) / view.nav) / 100;
  return (
    <main id="main" className="s-app s-unified-earn e-vault ax ax-vault">
      <Link className="ax-back" href="/earn/">
        ← All vaults
      </Link>
      <section className="ax-hero">
        <div className="ax-hero-copy">
          <p className="ax-eyebrow">Automated lending vault</p>
          <h1 className="ax-pixel ax-h1 ax-vault-title">sets{asset}</h1>
          <div className="ax-pbar" aria-hidden="true">
            <i />
            <i />
            <b />
          </div>
          <p className="ax-lede">
            Deposit {asset}. Hold sets{asset}. The vault spreads it across{" "}
            {destinations.length} lending markets by fixed rules.
          </p>
        </div>
        <dl className="ax-hero-stats is-three">
          <div className="is-blue">
            <dt>Base APR</dt>
            <dd className="ax-pixel">{earnRate(view?.blendedApr)}</dd>
          </div>
          <div>
            <dt>In vault</dt>
            <dd className="ax-pixel">{earnAmount(view?.nav, decimals, 2)}</dd>
          </div>
          <div>
            <dt>1 sets{asset}</dt>
            <dd className="ax-pixel">{earnAmount(view?.shareValue, decimals, 4)}</dd>
          </div>
        </dl>
      </section>
      {alerts}
      <div className="ax-vault-grid">
        <div className="ax-vault-main">
          {address && (
            <section className="ax-block" aria-label="Your position">
              <header className="ax-block-head">
                <p className="ax-eyebrow">Your position</p>
                <Link href="/portfolio/">Portfolio ↗</Link>
              </header>
              <dl className="ax-facts">
                <div>
                  <dt>Value</dt>
                  <dd data-testid={`${asset.toLowerCase()}-worth`}>
                    {earnAmount(sound ? snapshot?.worth : undefined, decimals, 4)} {asset}
                  </dd>
                </div>
                <div>
                  <dt>Withdrawable now</dt>
                  <dd>
                    {earnAmount(sound ? snapshot?.available : undefined, decimals, 4)} {asset}
                  </dd>
                </div>
              </dl>
            </section>
          )}
          <section className="ax-block" aria-label="Where it works">
            <header className="ax-block-head">
              <p className="ax-eyebrow">Where your {asset} works</p>
            </header>
            <div className="ax-alloc-bar" aria-hidden="true">
              {rows.map((label, i) => (
                <span
                  key={label}
                  style={{
                    width: `${weight(i === destinations.length ? view?.idle : view?.positions[i]) ?? 0}%`,
                    background: colors[i],
                  }}
                />
              ))}
            </div>
            <ul className="ax-alloc">
              {rows.map((label, i) => {
                const cash = i === destinations.length;
                const name = label.split(" · ")[0];
                const pct = weight(cash ? view?.idle : view?.positions[i]);
                return (
                  <li key={label}>
                    <i style={{ background: colors[i] }} />
                    {cash ? <span className="ax-alloc-name">Cash buffer</span> : <ProtocolLabel name={name} size={18} />}
                    <span className="ax-alloc-apr">{cash ? "for withdrawals" : `${earnRate(view?.rates[i])} APR`}</span>
                    <strong className="ax-pixel">{pct === undefined ? "—" : `${pct.toFixed(1)}%`}</strong>
                  </li>
                );
              })}
            </ul>
          </section>
          <p className="ax-risk">
            Max 60% per market · about 10% kept as cash · rates are variable, not
            promised. Contracts are unaudited and the vault is capped; deposit only
            what you can afford to lose.{" "}
            <Link href="/docs/how-it-works/rebalancing/">Rules, rebalancing and activity ↗</Link>
          </p>
        </div>
        <aside className="ax-vault-side">
          <div className="e-sticky">{form}</div>
        </aside>
      </div>
    </main>
  );
}
