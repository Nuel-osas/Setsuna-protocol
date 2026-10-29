"use client";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { formatUnits } from "viem";
import { useWallet } from "./WalletProvider";
import { usePortfolio } from "./usePortfolio";
import { Mark } from "./Brand";
import EarnEarnings from "./EarnEarnings";
import AUSDPosition from "./AUSDPosition";
import SendFunds, { type SendAsset } from "./SendFunds";
import { EarnToken } from "./EarnForm";
import TokenIcon from "./TokenIcon";
import { shortAddress } from "@/lib/setsuna/format";
import { positionEquity } from "@/lib/setsuna/portfolio-math";
import type { PortfolioAsset } from "@/lib/setsuna/portfolio";

function amount(value: bigint | undefined, decimals: number, digits = 5) {
  if (value === undefined) return "—";
  const number = Number(formatUnits(value, decimals));
  if (number !== 0 && Math.abs(number) < 10 ** -digits)
    return `${number < 0 ? "−" : ""}<${(10 ** -digits).toFixed(digits)}`;
  return number.toLocaleString("en-US", { maximumFractionDigits: digits });
}
const earnLink = (asset: "MON" | "USDC", action = "deposit") =>
  `/earn/${asset.toLowerCase()}/?action=${action}`;
function Token({ asset }: { asset: PortfolioAsset }) {
  return asset === "AUSD" ? (
    <span className="p-ausd-icon" aria-hidden="true">
      <TokenIcon asset="AUSD" size={28} />
    </span>
  ) : (
    <EarnToken asset={asset} />
  );
}
function Section({
  title,
  note,
  children,
  className = "",
}: {
  title: string;
  note?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`p-section ${className}`} aria-label={title}>
      <header className="p-section-head">
        <h2>{title}</h2>
        {note && <span>{note}</span>}
      </header>
      {children}
    </section>
  );
}
function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="p-empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export default function Portfolio() {
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState<SendAsset | null>(null);
  const { address, deployment: d, openConnect } = useWallet();
  const { data, loading, error, refresh } = usePortfolio();
  const [filter, setFilter] = useState("All");
  const perps = data?.perps.status === "ready" ? data.perps.data : undefined;
  const position = perps?.position;
  const openPosition = !!position && position.lotLNS > BigInt(0);
  const pnl = openPosition
    ? position.deltaPnlCNS + position.premiumPnlCNS
    : undefined;
  const partial =
    !!data &&
    ([
      ...Object.values(data.wallet),
      ...Object.values(data.earn),
      data.perps,
      data.spotOrders,
    ].some((value) => value.status === "unavailable") ||
      Object.values(data.earn).some(
        (value) => value.status === "ready" && !value.data.healthy,
      ));
  const activeEarn =
    data &&
    Object.values(data.earn).filter(
      (value) => value.status === "ready" && value.data.shares > BigInt(0),
    ).length;
  const activities =
    data?.activity.filter(
      (value) => filter === "All" || value.section === filter,
    ) ?? [];

  return (
    <main id="main" className="s-app p-portfolio">
      <header className="p-header">
        <div>
          <span className="s-eyebrow">Your account</span>
          <h1>Portfolio</h1>
          <p>Your assets, earning positions, and trades in one place.</p>
        </div>
        {address && (
          <div className="p-header-actions">
            <button
              type="button"
              className="p-address p-copy"
              title={address}
              aria-label={copied ? "Address copied" : `Copy address ${address}`}
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(address)
                  .then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  })
                  .catch(() => undefined);
              }}
            >
              <span aria-hidden="true" />
              {copied ? "Copied" : shortAddress(address)}
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.8" />
                <path d="M5 15V5a2 2 0 0 1 2-2h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
            <button
              type="button"
              className="p-refresh"
              onClick={refresh}
              disabled={loading}
              aria-label="Refresh portfolio"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M20 7v5h-5M4 17v-5h5M6.1 6.1A8 8 0 0 1 19 9M5 15a8 8 0 0 0 12.9 2.9"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        )}
      </header>
      <div className="p-environment">
        <span>
          <i />
          {d?.mode === "mainnet" ? "Monad mainnet · real funds" : "Preview"}
        </span>
        {address && (
          <span aria-live="polite">
            {loading
              ? "Refreshing balances…"
              : data
                ? `Updated at block ${data.block.toLocaleString("en-US")}`
                : "Waiting for data"}
          </span>
        )}
      </div>

      {!address ? (
        <section className="p-connect" aria-label="Connect your portfolio">
          <div className="p-connect-mark">
            <Mark size={56} />
          </div>
          <h2>
            Everything you own.
            <br />
            One place to see it.
          </h2>
          <p>
            Connect your account to view your balances, Earn shares, trading
            positions, and recent activity.
          </p>
          <button className="s-btn is-primary" onClick={openConnect}>
            Connect account
          </button>
          <div className="p-connect-assets">
            <EarnToken asset="MON" />
            <EarnToken asset="USDC" />
            <Token asset="AUSD" />
            <span>MON · USDC · AUSD</span>
          </div>
        </section>
      ) : (
        <>
          {error && (
            <p className="p-alert" role="alert">
              {error}
            </p>
          )}
          {partial && (
            <p className="p-alert" role="status">
              Some balances could not be valued. Missing values show “—” until a
              fresh reading is available.
            </p>
          )}
          <section className="p-totals" aria-label="Wallet balances by asset">
            {(["MON", "USDC", "AUSD"] as const).map((asset) => {
              const state = data?.wallet[asset];
              const balance =
                state?.status === "ready" ? state.data : undefined;
              return (
                <article className="p-total" key={asset}>
                  <div className="p-total-label">
                    <Token asset={asset} />
                    <span>{asset} balance</span>
                  </div>
                  <strong
                    data-testid={`portfolio-balance-${asset.toLowerCase()}`}
                    title={
                      balance === undefined
                        ? undefined
                        : formatUnits(balance, asset === "MON" ? 18 : 6)
                    }
                  >
                    {amount(balance, asset === "MON" ? 18 : 6)}
                    <small>{asset}</small>
                  </strong>
                  <p>Available in your wallet</p>
                  {address && (
                    <button
                      type="button"
                      className="p-send-open"
                      disabled={!balance}
                      aria-pressed={sending === asset}
                      onClick={() => setSending(sending === asset ? null : asset)}
                    >
                      Send
                    </button>
                  )}
                </article>
              );
            })}
          </section>
          {sending && address && (
            <SendFunds
              key={sending}
              asset={sending}
              token={
                sending === "USDC"
                  ? (d?.earnUSDC?.asset ?? d?.spot?.usdc)
                  : sending === "AUSD"
                    ? d?.collateral
                    : undefined
              }
              balance={
                data?.wallet[sending].status === "ready"
                  ? data.wallet[sending].data
                  : undefined
              }
              monBalance={
                data?.wallet.MON.status === "ready" ? data.wallet.MON.data : undefined
              }
              onClose={() => setSending(null)}
              onSent={refresh}
            />
          )}
          <p className="p-total-note">
            Deposited funds are shown separately in Earn positions and your
            Perps account.
          </p>

          <div className="p-grid">
            <div className="p-main-column">
              <Section
                title="Earn positions"
                note={
                  data
                    ? `${activeEarn} ${Object.values(data.earn).some((value) => value.status === "unavailable") ? "confirmed" : "active"}`
                    : "Loading…"
                }
              >
                {!data ? (
                  <p className="p-state">
                    {error
                      ? "Earn balances unavailable."
                      : "Reading your vault shares…"}
                  </p>
                ) : activeEarn === 0 &&
                  Object.values(data.earn).every(
                    (value) =>
                      value.status === "not-configured" ||
                      (value.status === "ready" && value.data.healthy),
                  ) ? (
                  <Empty title="Nothing earning yet">
                    <p>
                      Put MON or USDC to work and track your vault shares here.
                    </p>
                    <div className="p-empty-actions">
                      <Link
                        href={earnLink("USDC")}
                        className="s-btn is-primary is-small"
                      >
                        Deposit USDC
                      </Link>
                      <Link href={earnLink("MON")} className="s-btn is-small">
                        Deposit MON
                      </Link>
                    </div>
                  </Empty>
                ) : (
                  <div className="p-earn-list">
                    {(["MON", "USDC"] as const).map((asset) => {
                      const state = data.earn[asset];
                      if (
                        state.status === "not-configured" ||
                        (state.status === "ready" &&
                          state.data.shares === BigInt(0) &&
                          state.data.healthy)
                      )
                        return null;
                      const holding =
                        state.status === "ready" ? state.data : undefined;
                      return (
                        <article
                          className="p-earn-position"
                          key={asset}
                          aria-label={`sets${asset} position`}
                        >
                          <div className="p-earn-title">
                            <EarnToken asset={asset} receipt />
                            <div>
                              <h3>sets{asset}</h3>
                              <span>
                                {holding
                                  ? `${amount(holding.shares, asset === "MON" ? 24 : 12)} shares`
                                  : "Balance unavailable"}
                              </span>
                            </div>
                            <span className="p-rate">
                              {holding?.apr === undefined
                                ? "Rate unavailable"
                                : `${(Number(formatUnits(holding.apr, 18)) * 100).toFixed(2)}% APR`}
                            </span>
                          </div>
                          {holding && !holding.healthy && (
                            <p className="p-inline-warning">
                              Valuation is unavailable. Shares remain in your
                              wallet.
                            </p>
                          )}
                          <dl className="p-position-values">
                            <div>
                              <dt>Underlying value</dt>
                              <dd
                                data-testid={`portfolio-earn-${asset.toLowerCase()}`}
                              >
                                {amount(
                                  holding?.worth,
                                  asset === "MON" ? 18 : 6,
                                )}{" "}
                                <small>{asset}</small>
                              </dd>
                            </div>
                            <div>
                              <dt>Available to withdraw</dt>
                              <dd>
                                {amount(
                                  holding?.available,
                                  asset === "MON" ? 18 : 6,
                                )}{" "}
                                <small>{asset}</small>
                              </dd>
                            </div>
                          </dl>
                          <EarnEarnings
                            asset={asset}
                            shares={holding?.shares}
                            worth={holding?.worth}
                            block={data.block}
                          />
                          <div className="p-position-actions">
                            <Link href={earnLink(asset)}>
                              Deposit <span aria-hidden="true">↗</span>
                            </Link>
                            <Link href={earnLink(asset, "withdraw")}>
                              Withdraw <span aria-hidden="true">↗</span>
                            </Link>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
                <AUSDPosition
                  apr={
                    data?.earn.USDC.status === "ready"
                      ? data.earn.USDC.data.apr
                      : undefined
                  }
                />
                <p className="p-section-note">
                  Share value includes interest and losses. The current base APR
                  is variable; withdrawals depend on available liquidity.
                </p>
              </Section>

              <Section
                title="Perps account"
                note={<Link href="/trade/?mode=perps">Open Perps ↗</Link>}
              >
                {!data ? (
                  <p className="p-state">
                    {error
                      ? "Trading balances unavailable."
                      : "Reading your trading account…"}
                  </p>
                ) : data.perps.status === "unavailable" ? (
                  <p className="p-state">
                    Could not read your Perps account. Refresh to try again.
                  </p>
                ) : data.perps.status === "not-configured" ? (
                  <p className="p-state">
                    Perps is not configured in this environment.
                  </p>
                ) : !perps?.account ? (
                  <Empty title="No trading account yet">
                    <p>
                      Your AUSD trading balance and BTC position will appear
                      here after you open a Setsuna Perps account.
                    </p>
                    <Link className="s-btn is-small" href="/trade/?mode=perps">
                      Explore Perps
                    </Link>
                  </Empty>
                ) : (
                  <>
                    <dl className="p-perps-balances">
                      <div>
                        <dt>Free trading balance</dt>
                        <dd>
                          {amount(
                            perps.freeTrading ??
                              (perps.accountId === BigInt(0)
                                ? BigInt(0)
                                : undefined),
                            6,
                          )}{" "}
                          <small>AUSD</small>
                        </dd>
                      </div>
                      <div>
                        <dt>Protection reserve</dt>
                        <dd>
                          {amount(perps.reserve, 6)} <small>AUSD</small>
                        </dd>
                      </div>
                      {!!perps.lockedTrading && (
                        <div>
                          <dt>Locked by open orders</dt>
                          <dd>
                            {amount(perps.lockedTrading, 6)} <small>AUSD</small>
                          </dd>
                        </div>
                      )}
                    </dl>
                    {openPosition ? (
                      <article
                        className="p-perp-position"
                        aria-label="Open BTC position"
                      >
                        <div className="p-perp-title">
                          <strong>BTC / AUSD</strong>
                          <span
                            className={`p-side ${position.positionType === 0 ? "is-long" : "is-short"}`}
                          >
                            {position.positionType === 0 ? "Long" : "Short"}
                          </span>
                          <span>
                            {perps.market
                              ? amount(
                                  position.lotLNS,
                                  Number(perps.market.lotDecimals),
                                  5,
                                )
                              : "—"}{" "}
                            BTC
                          </span>
                        </div>
                        <dl className="p-position-values">
                          <div>
                            <dt>Position equity</dt>
                            <dd>
                              {amount(positionEquity(perps), 6)}{" "}
                              <small>AUSD</small>
                            </dd>
                          </div>
                          <div>
                            <dt>Unrealized P&amp;L</dt>
                            <dd
                              className={
                                pnl !== undefined && pnl < BigInt(0)
                                  ? "is-negative"
                                  : "is-positive"
                              }
                            >
                              {pnl !== undefined && pnl > BigInt(0) ? "+" : ""}
                              {amount(pnl, 6)} <small>AUSD</small>
                            </dd>
                          </div>
                          <div>
                            <dt>Entry price</dt>
                            <dd>
                              {perps.market
                                ? amount(
                                    position.pricePNS,
                                    Number(perps.market.priceDecimals),
                                    2,
                                  )
                                : "—"}
                            </dd>
                          </div>
                          <div>
                            <dt>Protection</dt>
                            <dd>
                              {perps.policy?.active ? "Armed" : "Not armed"}
                            </dd>
                          </div>
                        </dl>
                      </article>
                    ) : (
                      <p className="p-state p-no-position">
                        No open BTC position.
                      </p>
                    )}
                  </>
                )}
              </Section>
            </div>

            <aside className="p-wallet-column">
              {data?.spotOrders &&
                data.spotOrders.status !== "not-configured" && (
                  <Section
                    title="Spot trading balances"
                    note={
                      data.spotOrders.status === "ready"
                        ? `${data.spotOrders.data.count} open orders`
                        : "Unavailable"
                    }
                  >
                    {data.spotOrders.status === "ready" ? (
                      <ul className="p-wallet-list">
                        {(["MON", "USDC"] as const).map((asset) => (
                          <li key={asset}>
                            <Token asset={asset} />
                            <span>
                              <strong>{asset}</strong>
                              <small>
                                {amount(
                                  data.spotOrders.status === "ready"
                                    ? data.spotOrders.data[asset].locked
                                    : undefined,
                                  asset === "MON" ? 18 : 6,
                                )}{" "}
                                in open orders
                              </small>
                            </span>
                            <span className="p-wallet-amount">
                              {amount(
                                data.spotOrders.status === "ready"
                                  ? data.spotOrders.data[asset].free
                                  : undefined,
                                asset === "MON" ? 18 : 6,
                              )}{" "}
                              free
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="p-section-note">
                        Trading balances could not be loaded.
                      </p>
                    )}
                    <p className="p-section-note">
                      These funds are held in your Spot account. Withdraw free
                      funds from Trade → Spot → Balances.
                    </p>
                    <div className="p-wallet-actions">
                      <Link href="/trade/?mode=spot">Manage Spot</Link>
                    </div>
                  </Section>
                )}
              <Section title="In your wallet" note="Available assets">
                <ul className="p-wallet-list">
                  {(["MON", "USDC", "AUSD"] as const).map((asset) => {
                    const state = data?.wallet[asset];
                    const value =
                      state?.status === "ready" ? state.data : undefined;
                    return (
                      <li key={asset}>
                        <Token asset={asset} />
                        <div>
                          <strong>{asset}</strong>
                          <span>
                            {asset === "MON"
                              ? "Earn · Spot · gas"
                              : asset === "USDC"
                                ? "Earn · Spot"
                                : "Perps collateral"}
                          </span>
                        </div>
                        <span
                          className="p-wallet-amount"
                          data-testid={`portfolio-wallet-${asset.toLowerCase()}`}
                        >
                          {amount(value, asset === "MON" ? 18 : 6)}
                          {state?.status === "unavailable" && (
                            <small>Unavailable</small>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <div className="p-wallet-actions">
                  <Link className="s-btn is-small" href="/app/">
                    Earn
                  </Link>
                  <Link className="s-btn is-small" href="/trade/?mode=spot">
                    Swap
                  </Link>
                </div>
              </Section>
              <div className="p-account-note">
                <Mark size={25} />
                <p>
                  Your assets stay in your wallet or the contracts you use.
                  Managing a position opens its transaction screen.
                </p>
              </div>
            </aside>
          </div>

          <Section
            title="Recent activity"
            note="Your account only"
            className="p-activity-section"
          >
            <div
              className="p-activity-filters"
              role="group"
              aria-label="Activity type"
            >
              {["All", "Earn", "Spot", "Perps"].map((value) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={value === filter}
                  onClick={() => setFilter(value)}
                >
                  {value}
                </button>
              ))}
            </div>
            {!data ? (
              <p className="p-state">
                {error ? "Activity unavailable." : "Reading recent activity…"}
              </p>
            ) : activities.length === 0 ? (
              <p className="p-state">
                {data.historyUnavailable
                  ? "Some activity could not be loaded. Refresh to try again."
                  : "No matching activity in the recent block window."}
              </p>
            ) : (
              <ol className="p-activity">
                {activities.map((event) => (
                  <li key={event.key}>
                    <span
                      className={`p-activity-icon is-${event.section.toLowerCase()}`}
                      aria-hidden="true"
                    >
                      {event.section === "Earn"
                        ? "↓"
                        : event.section === "Spot"
                          ? "⇄"
                          : "↗"}
                    </span>
                    <div className="p-activity-description">
                      <strong>{event.label}</strong>
                      <span>
                        {event.section} · block{" "}
                        {event.block.toLocaleString("en-US")}
                      </span>
                    </div>
                    <div className="p-activity-detail">
                      <span title={event.detail}>{event.detail}</span>
                      {d?.explorer ? (
                        <a
                          href={`${d.explorer}/tx/${event.hash}`}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`View ${event.label} transaction`}
                        >
                          {shortAddress(event.hash)} ↗
                        </a>
                      ) : (
                        <code title={event.hash}>
                          {shortAddress(event.hash)}
                        </code>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
            <p className="p-section-note">
              Up to 24 recent events from the last 2,000 blocks. This is not a
              complete transaction history or a realized-profit calculation.
              {data?.historyUnavailable ? " Some sources are unavailable." : ""}
            </p>
          </Section>
        </>
      )}
    </main>
  );
}
