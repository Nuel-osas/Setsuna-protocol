"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { formatUnits } from "viem";
import { useSetsuna } from "./useSetsuna";
import MarginRunway from "./MarginRunway";
import { Mark } from "./Brand";
import TokenIcon from "./TokenIcon";
import { useTradingMarket } from "./useTradingMarket";
import {
  MarketStrip,
  MarketChart,
  PerpsMarketInfo,
  OrderBook,
} from "./TradingMarket";
import { statuses } from "@/lib/setsuna/contracts";
import { ausd, shortAddress } from "@/lib/setsuna/format";
import { advancedDefaults, stepIn, type StepIn } from "@/lib/setsuna/presets";
import type { Market, Position } from "@/lib/setsuna/types";
import { useReferenceMarket } from "./useReferenceMarket";
import OrderTypeSwitch from "./OrderTypeSwitch";

function Card({
  title,
  kicker,
  aside,
  children,
  className = "",
}: {
  title: string;
  kicker?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`s-card ${className}`}>
      <header className="s-card-head">
        <div>
          {kicker && <span className="s-eyebrow">{kicker}</span>}
          <h2>{title}</h2>
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}

function Money({
  label,
  value,
  unit = "AUSD",
  hint,
}: {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
}) {
  return (
    <div className="s-money">
      <span>{label}</span>
      <strong>
        {value}
        <small>{unit}</small>
      </strong>
      {hint && <em>{hint}</em>}
    </div>
  );
}

function Input({
  label,
  value,
  set,
  unit = "AUSD",
  hint,
}: {
  label: string;
  value: string;
  set: (v: string) => void;
  unit?: string;
  hint?: string;
}) {
  return (
    <label className="s-input">
      <span>{label}</span>
      <span className="s-input-box">
        <input
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(e) => set(e.target.value)}
          aria-label={label}
        />
        <i className="s-token-label">
          {unit === "AUSD" && <TokenIcon asset="AUSD" size={18} />}
          {unit}
        </i>
      </span>
      {hint && <small>{hint}</small>}
    </label>
  );
}

function ClosePosition({
  position,
  market,
  disabled,
  onReview,
}: {
  position: Position;
  market: Market;
  disabled: boolean;
  onReview: (side: number, size: string, price: string) => void;
}) {
  const [size, setSize] = useState(
    formatUnits(position.lotLNS, Number(market.lotDecimals)),
  );
  const [enteredPrice, setPrice] = useState<string>();
  const side = position.positionType === 0 ? 2 : 3;
  const price =
    enteredPrice ??
    formatUnits(
      side === 2
        ? (market.markPNS * BigInt(998)) / BigInt(1000)
        : (market.markPNS * BigInt(1002) + BigInt(999)) / BigInt(1000),
      Number(market.priceDecimals),
    );
  return (
    <details className="s-disclose t-close-position">
      <summary>Close position</summary>
      <div className="s-grid-2">
        <Input label="Close size" value={size} set={setSize} unit="BTC" />
        <Input
          label="Close limit price"
          value={price}
          set={setPrice}
          unit="USD"
        />
      </div>
      <p className="s-footnote">
        Full position size is prefilled. Enter a smaller amount to close part of
        it.
      </p>
      <button
        className="s-btn is-quiet"
        disabled={disabled}
        onClick={() => onReview(side, size, price)}
      >
        Review close
      </button>
    </details>
  );
}

const pct = (bps: number) => `${(bps / 100).toFixed(0)}%`;

export default function App() {
  const s = useSetsuna();
  const terminal = useTradingMarket("perps");
  const reference = useReferenceMarket("perps", s.d?.mode === "mainnet");
  const {
    d,
    address,
    snapshot,
    account,
    policy,
    quote,
    position,
    market,
    hasPosition,
    ready,
  } = s;
  const dialog = useRef<HTMLDialogElement>(null);

  // form state
  const [budget, setBudget] = useState(50);
  const [mode, setMode] = useState<StepIn>("normal");
  const [adv, setAdv] = useState(advancedDefaults);
  const [showAdv, setShowAdv] = useState(false);
  const [newCap, setNewCap] = useState("");
  const [fund, setFund] = useState("100");
  const [withdraw, setWithdraw] = useState("25");
  const [trading, setTrading] = useState("100");
  const [side, setSide] = useState(0);
  const [orderKind, setOrderKind] = useState<"market" | "limit">("market");
  const [slippage, setSlippage] = useState("0.5");
  const [size, setSize] = useState("0.001");
  const [enteredPrice, setPrice] = useState<string>();
  const [lev, setLev] = useState("10");

  useEffect(() => {
    if (s.review) dialog.current?.showModal();
    else dialog.current?.close();
  }, [s.review]);

  const mark = market
    ? Number(formatUnits(market.markPNS, Number(market.priceDecimals)))
    : terminal.reading?.price;
  // A suggested price is a fallback, never an effect that can overwrite an edit.
  const price =
    enteredPrice ??
    (mark ? String(Math.round(side === 0 ? mark * 1.002 : mark * 0.998)) : "");

  const reserve = snapshot?.reserve ?? BigInt(0);
  const reserveNum = Number(formatUnits(reserve, 6));
  const equity = position
    ? position.depositCNS + position.deltaPnlCNS + position.premiumPnlCNS
    : undefined;
  const lastTopUp = snapshot?.activity.find((a) =>
    a.name.includes("top-up executed"),
  );
  const activePreset = useMemo(() => {
    if (!policy?.active) return undefined;
    return (Object.keys(stepIn) as StepIn[]).find(
      (k) =>
        stepIn[k].trigger === policy.config.triggerBufferBps &&
        stepIn[k].target === policy.config.targetBufferBps,
    );
  }, [policy]);

  const budgetMax = Math.max(10, Math.min(1000, Math.floor(reserveNum) || 250));
  const armBlocked = !hasPosition
    ? "Open a position first. Protection attaches to one position."
    : snapshot?.openOrders?.length
      ? "Cancel or fill your open orders before turning protection on."
      : reserveNum < Number(adv.minTopUp)
        ? "Fund your reserve first. Top-ups are paid only from it."
        : "";

  return (
    <>
      <main id="main" className="s-app t-terminal t-perps">
        <MarketStrip
          kind="perps"
          reading={terminal.reading}
          reference={reference}
        />
        {d?.mode === "preview" && (
          <p className="t-demo-note">
            Live Monad market data · trading opens when the mainnet deployment
            is connected.
          </p>
        )}

        {(s.readError ||
          (s.error && !s.review) ||
          s.notice ||
          s.unknownHash) && (
          <div className="s-messages">
            {s.readError && (
              <p className="s-alert is-error" role="alert">
                {s.readError}
              </p>
            )}
            {s.error && !s.review && (
              <p className="s-alert is-error" role="alert">
                {s.error}
              </p>
            )}
            {s.notice && (
              <p className="s-alert is-ok" role="status">
                {s.notice}
              </p>
            )}
            {s.unknownHash && (
              <p className="s-alert is-error">
                A transaction is waiting to be reconciled:{" "}
                <code>{shortAddress(s.unknownHash)}</code>{" "}
                <button
                  className="s-link"
                  disabled={s.busy}
                  onClick={() => void s.reconcile()}
                >
                  Check it now
                </button>
              </p>
            )}
          </div>
        )}

        <div className="s-app-grid t-workspace">
          <MarketChart kind="perps" {...terminal} />
          {d?.mode === "preview" ? (
            <OrderBook kind="perps" reading={terminal.reading} />
          ) : reference ? (
            <OrderBook
              kind="perps"
              reading={reference}
              source={
                d?.mode === "mainnet"
                  ? "Perpl · live"
                  : "Perpl mainnet · reference"
              }
            />
          ) : (
            <PerpsMarketInfo reading={terminal.reading} />
          )}
          <div className="s-col">
            <Card
              className="t-position"
              title={
                hasPosition
                  ? `BTC-PERP · ${position!.positionType === 0 ? "Long" : "Short"}`
                  : "No open position"
              }
              kicker="Position"
              aside={
                quote && (
                  <span
                    className={`s-pill ${quote.status === 0 ? "is-danger" : policy?.active ? "is-safe" : ""}`}
                  >
                    {statuses[quote.status]}
                  </span>
                )
              }
            >
              {hasPosition ? (
                <>
                  <div className="s-money-row">
                    <Money
                      label="Size"
                      value={formatUnits(
                        position!.lotLNS,
                        Number(market?.lotDecimals ?? 5),
                      )}
                      unit="BTC"
                    />
                    <Money
                      label="Mark"
                      value={mark ? mark.toLocaleString("en-US") : "—"}
                      unit="USD"
                    />
                    <Money
                      label="Collateral"
                      value={ausd(position!.depositCNS)}
                    />
                    <Money label="Equity" value={ausd(equity)} />
                  </div>
                  {quote && quote.maintenanceCNS > BigInt(0) && (
                    <MarginRunway
                      maintenance={quote.maintenanceCNS}
                      equity={quote.equityCNS}
                      trigger={
                        policy?.active ? quote.triggerEquityCNS : undefined
                      }
                      target={
                        policy?.active ? quote.targetEquityCNS : undefined
                      }
                      flash={!!lastTopUp}
                    />
                  )}
                  {d?.mode !== "preview" && quote?.status === 0 && (
                    <div className="s-instant-cta">
                      <Mark size={40} color="var(--tide)" />
                      <div>
                        <strong>This position is inside its trigger.</strong>
                        <p>
                          Anyone can submit the rescue. Try it: you act as the
                          keeper and earn the fee.
                        </p>
                      </div>
                      <button
                        className="s-btn is-primary"
                        disabled={!ready}
                        onClick={s.actions.topUp}
                      >
                        Step in · +{ausd(quote.amountCNS)} AUSD
                      </button>
                    </div>
                  )}
                  <p className="s-footnote">
                    Mark is read from Perpl. Setsuna cannot guarantee a top-up
                    lands before liquidation.
                  </p>
                  {market && (
                    <ClosePosition
                      key={`${d?.chainId}:${account}:${position!.positionType}:${position!.lotLNS}`}
                      position={position!}
                      market={market}
                      disabled={!ready || !snapshot?.accountId || !!s.review}
                      onReview={(closeSide, closeSize, closePrice) =>
                        s.actions.trade(closeSide, closeSize, closePrice, lev)
                      }
                    />
                  )}
                </>
              ) : (
                <p className="s-lede">
                  Your BTC position will appear here after an order fills. Use
                  the order panel to connect, fund and trade.
                </p>
              )}
              {account && (
                <section
                  className="t-open-orders"
                  aria-label="Perps open orders"
                >
                  <h3>
                    Open orders{" "}
                    <small>{snapshot?.openOrders?.length ?? 0}</small>
                  </h3>
                  {snapshot?.openOrders?.length ? (
                    snapshot.openOrders.map((order) => (
                      <div className="t-open-order" key={order.orderId}>
                        <span>
                          <b>
                            {
                              ["Long", "Short", "Close long", "Close short"][
                                order.orderType
                              ]
                            }
                          </b>
                          <small>
                            #{order.orderId} ·{" "}
                            {formatUnits(
                              order.lotLNS,
                              Number(market?.lotDecimals ?? 5),
                            )}{" "}
                            BTC remaining
                          </small>
                        </span>
                        <span>
                          $
                          {formatUnits(
                            (market?.basePricePNS ?? BigInt(0)) +
                              BigInt(order.priceONS),
                            Number(market?.priceDecimals ?? 1),
                          )}
                        </span>
                        <button
                          className="s-btn is-small"
                          disabled={!ready || !!s.review}
                          onClick={() => s.actions.cancelOrder(order.orderId)}
                        >
                          Cancel order #{order.orderId}
                        </button>
                      </div>
                    ))
                  ) : (
                    <p className="s-muted">No open limit orders.</p>
                  )}
                </section>
              )}
            </Card>

            <Card
              className="t-ticket"
              title="Place order"
              kicker="Perpl · BTC-PERP"
              aside={
                <span className="s-pill">
                  {orderKind === "market"
                    ? "Immediate fill"
                    : "Good till cancelled"}
                </span>
              }
            >
              <OrderTypeSwitch
                value={orderKind}
                onChange={setOrderKind}
                disabled={s.busy || !!s.unknownHash || !!s.review}
                label="Perps order type"
              />
              <div className="s-segment" role="tablist">
                {["Long", "Short"].map((label, i) => (
                  <button
                    key={label}
                    role="tab"
                    disabled={s.busy || !!s.unknownHash}
                    aria-selected={side === i}
                    className={side === i ? "is-on" : ""}
                    onClick={() => {
                      setSide(i);
                      setPrice(undefined);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="s-grid-2">
                <Input label="Size" value={size} set={setSize} unit="BTC" />
                {orderKind === "limit" ? (
                  <Input
                    label="Limit price"
                    value={price}
                    set={setPrice}
                    unit="USD"
                    hint={
                      mark ? `Mark ${mark.toLocaleString("en-US")}` : undefined
                    }
                  />
                ) : (
                  <Input
                    label="Slippage"
                    value={slippage}
                    set={setSlippage}
                    unit="%"
                    hint="Maximum price movement · 0.01%–5%"
                  />
                )}
              </div>
              <div className="s-chips" aria-label="Leverage">
                <span>Leverage</span>
                {["2", "5", "10", "15"].map((x) => (
                  <button
                    key={x}
                    className={lev === x ? "is-on" : ""}
                    onClick={() => setLev(x)}
                  >
                    {x}×
                  </button>
                ))}
              </div>
              {!address ? (
                <button
                  className="s-btn is-primary is-wide"
                  onClick={s.wallet.openConnect}
                >
                  Connect to trade
                </button>
              ) : s.readError ? (
                <button className="s-btn is-wide" disabled>
                  Trading unavailable
                </button>
              ) : !account ? (
                <button
                  className="s-btn is-primary is-wide"
                  disabled={!ready}
                  onClick={s.actions.createAccount}
                >
                  Create account
                </button>
              ) : (
                <button
                  className={`s-btn is-primary is-wide ${side === 1 ? "t-sell-action" : "t-buy-action"}`}
                  disabled={
                    !ready ||
                    !snapshot?.accountId ||
                    (orderKind === "limit" && !snapshot?.orderTypesVersion)
                  }
                  onClick={() =>
                    s.actions.trade(side, size, price, lev, orderKind, slippage)
                  }
                >
                  Review order
                </button>
              )}
              {account &&
                orderKind === "limit" &&
                !snapshot?.orderTypesVersion && (
                  <p className="s-footnote">
                    Limit orders are not enabled for this trading account yet.
                  </p>
                )}
              {account && (
                <details className="s-disclose">
                  <summary>
                    Trading balance · {ausd(snapshot?.freeTrading)} AUSD free
                  </summary>
                  {!!snapshot?.lockedTrading && (
                    <p className="s-footnote">
                      {ausd(snapshot.lockedTrading)} AUSD locked by open orders.
                    </p>
                  )}
                  <Input
                    label={snapshot?.accountId ? "Amount" : "Opening deposit"}
                    value={trading}
                    set={setTrading}
                    hint={`Wallet ${ausd(snapshot?.walletBalance)} AUSD`}
                  />
                  <div className="s-row">
                    <button
                      className="s-btn"
                      disabled={!ready}
                      onClick={() =>
                        s.actions.fund(
                          snapshot?.accountId ? "depositTrading" : "initialize",
                          trading,
                        )
                      }
                    >
                      {snapshot?.accountId ? "Deposit" : "Open trading account"}
                    </button>
                    {!!snapshot?.accountId && (
                      <button
                        className="s-btn is-quiet"
                        disabled={!ready}
                        onClick={() => s.actions.withdrawTrading(trading)}
                      >
                        Withdraw
                      </button>
                    )}
                  </div>
                  {!!snapshot?.accountId && (
                    <button
                      className="s-link"
                      disabled={!ready || !snapshot.freeTrading}
                      onClick={() =>
                        setTrading(formatUnits(snapshot.freeTrading!, 6))
                      }
                    >
                      Use full free balance
                    </button>
                  )}
                </details>
              )}
              <p className="s-footnote">
                {orderKind === "market"
                  ? "Executes immediately within your slippage limit, in full or not at all. "
                  : "Unfilled size stays open at your limit price until filled or cancelled. "}
                Any trade ends current protection. You can re-arm after open
                orders are cleared.
              </p>
            </Card>
          </div>

          <div className="s-col">
            <Card
              title={
                policy?.active ? "Protection is on" : "Protect this position"
              }
              kicker="Setsuna"
              className={`t-protection s-protect ${policy?.active ? "is-on" : ""}`}
              aside={
                <span
                  className={`s-switch ${policy?.active ? "is-on" : ""}`}
                  aria-hidden="true"
                >
                  <i />
                </span>
              }
            >
              {policy?.active ? (
                <>
                  <div className="s-budget">
                    <div className="s-budget-top">
                      <span>Budget used</span>
                      <strong>
                        {ausd(policy.usedCNS)}{" "}
                        <small>/ {ausd(policy.config.capCNS)} AUSD</small>
                      </strong>
                    </div>
                    <div className="s-budget-bar">
                      <span
                        style={{
                          width: `${Math.min(100, (Number(policy.usedCNS) / Math.max(1, Number(policy.config.capCNS))) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                  <dl className="s-facts">
                    <div>
                      <dt>Steps in</dt>
                      <dd>
                        {activePreset ? stepIn[activePreset].label : "Custom"} ·{" "}
                        {pct(policy.config.triggerBufferBps)} above maintenance
                      </dd>
                    </div>
                    <div>
                      <dt>Restores to</dt>
                      <dd>
                        {pct(policy.config.targetBufferBps)} above maintenance
                      </dd>
                    </div>
                    <div>
                      <dt>Keeper fee</dt>
                      <dd>
                        {policy.config.feeBps / 100}% · max{" "}
                        {ausd(policy.config.feeMaxCNS)} AUSD · only when it acts
                      </dd>
                    </div>
                  </dl>
                  <div className="s-row">
                    <Input label="New budget" value={newCap} set={setNewCap} />
                  </div>
                  <div className="s-row">
                    <button
                      className="s-btn"
                      disabled={!ready || !newCap}
                      onClick={() => s.actions.changeCap(newCap)}
                    >
                      Update budget
                    </button>
                    <button
                      className="s-btn is-quiet"
                      disabled={!ready}
                      onClick={s.actions.revoke}
                    >
                      Turn off
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="s-slider">
                    <div className="s-slider-top">
                      <span>Budget</span>
                      <strong>
                        {budget} <small>AUSD</small>
                      </strong>
                    </div>
                    <input
                      type="range"
                      min={5}
                      max={budgetMax}
                      step={1}
                      value={Math.min(budget, budgetMax)}
                      onChange={(e) => setBudget(Number(e.target.value))}
                      aria-label="Budget in AUSD"
                    />
                    <small>
                      The most Setsuna may ever add, fees included. Reserve
                      holds {ausd(reserve)} AUSD.
                    </small>
                  </div>

                  <div
                    className="s-stepin"
                    role="radiogroup"
                    aria-label="When to step in"
                  >
                    {(Object.keys(stepIn) as StepIn[]).map((k) => (
                      <button
                        key={k}
                        role="radio"
                        aria-checked={mode === k}
                        className={mode === k ? "is-on" : ""}
                        onClick={() => setMode(k)}
                      >
                        <strong>{stepIn[k].label}</strong>
                        <span>{stepIn[k].blurb}</span>
                      </button>
                    ))}
                  </div>

                  <p className="s-sentence">
                    Setsuna may add up to <b>{budget} AUSD</b>. It steps in when
                    margin falls to <b>{pct(stepIn[mode].trigger)}</b> above
                    maintenance and rebuilds it to{" "}
                    <b>{pct(stepIn[mode].target)}</b>. Fees apply only when it
                    acts: the keeper fee plus a fixed 1% Setsuna fee on the
                    margin added, both inside your budget.
                  </p>

                  <button
                    className="s-link"
                    onClick={() => setShowAdv((v) => !v)}
                    aria-expanded={showAdv}
                  >
                    {showAdv ? "Hide" : "Show"} advanced
                  </button>
                  {showAdv && (
                    <div className="s-grid-2 s-adv">
                      <Input
                        label="Minimum top-up"
                        value={adv.minTopUp}
                        set={(v) => setAdv({ ...adv, minTopUp: v })}
                      />
                      <Input
                        label="Keeper fee"
                        value={adv.feePct}
                        set={(v) => setAdv({ ...adv, feePct: v })}
                        unit="%"
                      />
                      <Input
                        label="Fee ceiling"
                        value={adv.feeMax}
                        set={(v) => setAdv({ ...adv, feeMax: v })}
                      />
                      <Input
                        label="Max price age"
                        value={adv.markAge}
                        set={(v) => setAdv({ ...adv, markAge: v })}
                        unit="sec"
                      />
                    </div>
                  )}

                  <button
                    className="s-btn is-primary is-wide"
                    disabled={!ready || !account || !!armBlocked}
                    onClick={() =>
                      s.actions.arm(
                        {
                          cap: String(budget),
                          triggerBps: stepIn[mode].trigger,
                          targetBps: stepIn[mode].target,
                          ...adv,
                        },
                        [
                          ["Budget", `${budget} AUSD, fees included`],
                          [
                            "Steps in",
                            `${stepIn[mode].label} · ${pct(stepIn[mode].trigger)} above maintenance`,
                          ],
                          [
                            "Restores to",
                            `${pct(stepIn[mode].target)} above maintenance`,
                          ],
                          [
                            "Keeper fee",
                            `${adv.feePct}% · max ${adv.feeMax} AUSD · only when it acts`,
                          ],
                        ],
                      )
                    }
                  >
                    Turn protection on
                  </button>
                  {address && armBlocked && (
                    <p className="s-footnote">{armBlocked}</p>
                  )}
                </>
              )}
            </Card>

            {account ? (
              <Card
                className="t-reserve"
                title="Reserve"
                kicker="Only for protection"
              >
                <Money
                  label="Held for top-ups"
                  value={ausd(reserve)}
                  hint="Separate from your trading balance. Trades can never spend it."
                />
                <div className="s-grid-2">
                  <Input
                    label="Add"
                    value={fund}
                    set={setFund}
                    hint={`Wallet ${ausd(snapshot?.walletBalance)} AUSD`}
                  />
                  <Input label="Withdraw" value={withdraw} set={setWithdraw} />
                </div>
                <button
                  className="s-link"
                  disabled={!ready || !reserve}
                  onClick={() => setWithdraw(formatUnits(reserve, 6))}
                >
                  Use full reserve
                </button>
                <div className="s-row">
                  <button
                    className="s-btn"
                    disabled={!ready}
                    onClick={() => s.actions.fund("fundReserve", fund)}
                  >
                    Fund reserve
                  </button>
                  <button
                    className="s-btn is-quiet"
                    disabled={!ready}
                    onClick={() => s.actions.withdrawReserve(withdraw)}
                  >
                    Withdraw
                  </button>
                </div>
              </Card>
            ) : (
              <Card
                className="t-reserve"
                title="AUSD reserve"
                kicker="Optional protection"
              >
                <p className="s-lede">
                  Connect and create your account to set aside a capped budget
                  for margin top-ups.
                </p>
                <p className="s-footnote">
                  Your reserve is separate from trading collateral and Earn
                  deposits.
                </p>
              </Card>
            )}

            {account && (
              <Card
                className="t-history"
                title="Activity"
                kicker="Onchain"
                aside={
                  <span className="s-pill">
                    {snapshot?.activity.length ?? 0}
                  </span>
                }
              >
                {snapshot?.activity.length ? (
                  <ol className="s-ledger">
                    {snapshot.activity.slice(0, 8).map((a, i) => (
                      <li
                        key={`${a.hash}-${i}`}
                        className={
                          a.name.includes("top-up executed")
                            ? "is-instant"
                            : a.name.includes("refused")
                              ? "is-refused"
                              : ""
                        }
                      >
                        <span className="s-ledger-dot" />
                        <div>
                          <strong>{a.name}</strong>
                          <span>{a.detail}</span>
                        </div>
                        <code title={a.hash}>{shortAddress(a.hash)}</code>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="s-muted">
                    {snapshot?.historyUnavailable
                      ? "History could not be loaded. Balances still come from live contract reads."
                      : "Every deposit, trade, rescue and refusal lands here with its transaction."}
                  </p>
                )}
              </Card>
            )}
          </div>
        </div>
      </main>

      <dialog
        ref={dialog}
        className="s-modal t-review-modal"
        aria-label={s.review?.title ?? "Review"}
        onCancel={(e) => {
          if (s.busy || s.unknownHash) e.preventDefault();
          else s.setReview(undefined);
        }}
        onClose={() => {
          if (!s.busy) s.setReview(undefined);
        }}
      >
        <button
          className="s-modal-close"
          aria-label="Close"
          disabled={s.busy || !!s.unknownHash}
          onClick={() => s.setReview(undefined)}
        >
          ×
        </button>
        <span className="s-eyebrow">Review before you sign</span>
        <h2>{s.review?.title}</h2>
        <p>{s.review?.description}</p>
        <dl className="s-review">
          {s.review?.rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
          <div>
            <dt>Network</dt>
            <dd>{d?.name}</dd>
          </div>
        </dl>
        {s.error && (
          <p className="s-alert is-error" role="alert">
            {s.error}
          </p>
        )}
        {s.hash && (
          <p className="s-small">
            Submitted <code>{s.hash}</code>
          </p>
        )}
        <button
          className="s-btn is-primary is-wide"
          disabled={s.busy || !!s.unknownHash || s.review?.owner !== address}
          onClick={() => void s.confirm()}
        >
          {s.busy ? "Waiting for confirmation…" : "Confirm"}
        </button>
        {s.unknownHash && (
          <button
            className="s-btn is-wide"
            disabled={s.busy}
            onClick={() => void s.reconcile()}
          >
            Check submitted transaction
          </button>
        )}
        <p className="s-small">
          {s.wallet.kind === "mera"
            ? "Signs with your passkey session."
            : "Your wallet will ask you to approve."}{" "}
          Every call is simulated before it is signed.
        </p>
      </dialog>
    </>
  );
}
