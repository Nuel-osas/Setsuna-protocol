"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import type { MONSnapshot } from "@/lib/setsuna/mon";
import type { USDCSnapshot } from "@/lib/setsuna/usdc";
import { useWallet } from "./WalletProvider";
import { EarnToken, earnAmount, type EarnAsset } from "./EarnForm";
import EarnPerformance from "./EarnPerformance";
import { useEarnSummary } from "./useEarnSummary";
import type { EarnSummary } from "@/lib/setsuna/earn-summary";
import EarnEarnings from "./EarnEarnings";
import ProtocolIcon from "./ProtocolIcon";

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
  advanced,
  risk,
  controls,
  destinations,
}: {
  asset: EarnAsset;
  snapshot?: MONSnapshot | USDCSnapshot;
  form: ReactNode;
  alerts: ReactNode;
  advanced: ReactNode;
  risk: ReactNode;
  controls?: ReactNode;
  destinations: string[];
}) {
  const { address } = useWallet();
  const { data: summary } = useEarnSummary(asset);
  const headline =
    snapshot && (!summary || snapshot.block >= summary.block)
      ? snapshot
      : summary;
  const headlineSound = headline?.healthy;
  const decimals = asset === "MON" ? 18 : 6;
  const sound = snapshot?.healthy;
  return (
    <main id="main" className="s-app s-unified-earn e-vault">
      <div className="e-breadcrumb">
        <Link href="/earn/">← All vaults</Link>
        <EarnEnvironment />
      </div>
      <header className="e-vault-heading">
        <EarnToken asset={asset} receipt />
        <div>
          <span className="e-kicker">AUTOMATED LENDING VAULT</span>
          <h1>sets{asset}</h1>
          <p>
            Deposit {asset}. Hold sets{asset}. Let your assets get to work.
          </p>
        </div>
      </header>
      {alerts}
      <div className="e-vault-grid">
        <div className="e-vault-content">
          <dl className="e-stats">
            <div>
              <dt>Current base APR</dt>
              <dd className="e-positive">
                {earnRate(headlineSound ? headline?.blendedApr : undefined)}
              </dd>
              <small>Weighted by actual allocation</small>
            </div>
            <div>
              <dt>Total in vault</dt>
              <dd>
                {earnAmount(
                  headlineSound ? headline?.nav : undefined,
                  decimals,
                  2,
                )}{" "}
                <small>{asset}</small>
              </dd>
              <small>Includes the cash buffer</small>
            </div>
            <div>
              <dt>Share value</dt>
              <dd>
                {earnAmount(
                  headlineSound ? headline?.shareValue : undefined,
                  decimals,
                  5,
                )}{" "}
                <small>{asset}</small>
              </dd>
              <small>Per sets{asset}</small>
            </div>
          </dl>
          <EarnPerformance asset={asset} enabled={!!snapshot?.healthy} />
          <section
            className="e-panel s-position"
            aria-label="Your vault position"
          >
            <header className="e-section-head">
              <h2>Your position</h2>
              <Link href="/portfolio/">Portfolio ↗</Link>
            </header>
            <dl className="e-position-stats">
              <div>
                <dt>Current value</dt>
                <dd data-testid={`${asset.toLowerCase()}-worth`}>
                  {earnAmount(
                    address && sound ? snapshot?.worth : undefined,
                    decimals,
                    5,
                  )}{" "}
                  <small>{asset}</small>
                </dd>
              </div>
              <div>
                <dt>Your shares</dt>
                <dd data-testid={`${asset.toLowerCase()}-shares`}>
                  {earnAmount(
                    address ? snapshot?.shares : undefined,
                    decimals + 6,
                    5,
                  )}{" "}
                  <small>sets{asset}</small>
                </dd>
              </div>
              <div>
                <dt>Available to withdraw</dt>
                <dd>
                  {earnAmount(
                    address && sound ? snapshot?.available : undefined,
                    decimals,
                    5,
                  )}{" "}
                  <small>{asset}</small>
                </dd>
              </div>
            </dl>
            <EarnEarnings
              asset={asset}
              shares={snapshot?.shares}
              worth={sound ? snapshot?.worth : undefined}
              block={snapshot?.block}
            />
          </section>
          <EarnAllocation
            asset={asset}
            snapshot={headlineSound ? headline : undefined}
            destinations={destinations}
          />
          {controls && (
            <section
              className="e-panel e-controls"
              aria-labelledby={`${asset.toLowerCase()}-controls-title`}
            >
              <h2 id={`${asset.toLowerCase()}-controls-title`}>
                Anyone can rebalance
              </h2>
              <p>
                No manager moves this vault. Any wallet can record protocol
                rates or trigger a rebalance; the contract computes the moves
                and refuses any that break its rules.
              </p>
              {controls}
            </section>
          )}
          <details className="e-panel e-advanced">
            <summary>
              Allocation rules & vault activity{" "}
              <span aria-hidden="true">+</span>
            </summary>
            <div className="e-advanced-body">
              {risk}
              {advanced}
            </div>
          </details>
        </div>
        <aside className="e-vault-sidebar">
          <div className="e-sticky">
            {form}
            <EarnNetworkNote />
          </div>
        </aside>
      </div>
    </main>
  );
}
