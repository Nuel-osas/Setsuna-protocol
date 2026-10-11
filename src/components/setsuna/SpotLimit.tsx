"use client";
import { useState } from "react";
import { formatUnits } from "viem";
import { spotLimitAmounts } from "@/lib/setsuna/spot-orders";
import type { SpotSnapshot } from "@/lib/setsuna/spot";
import { message, shortAddress } from "@/lib/setsuna/format";
import type { SpotOrdersController } from "./useSpotOrders";
const display = (value: bigint, decimals: number) =>
  Number(formatUnits(value, decimals)).toLocaleString("en-US", {
    maximumFractionDigits: 6,
  });

export function SpotLimitTicket({
  orders,
  market,
  isBuy,
  connect,
  connected,
}: {
  orders: SpotOrdersController;
  market?: SpotSnapshot;
  isBuy: boolean;
  connect: () => void;
  connected: boolean;
}) {
  const [size, setSize] = useState("200"),
    [price, setPrice] = useState(""),
    [error, setError] = useState("");
  const [review, setReview] =
    useState<Parameters<SpotOrdersController["place"]>[0]>();
  const s = orders.snapshot;
  const locked = orders.busy || !!orders.pending;
  function prepare() {
    setReview(undefined);
    setError("");
    try {
      if (!market || !s || !orders.ready)
        throw new Error("Wait for Spot balances to load.");
      const a = spotLimitAmounts(
        size,
        price,
        isBuy,
        market.params,
        isBuy ? s.availableUSDC : s.availableMON,
      );
      if (
        (market.mon ?? BigInt(0)) <
        (isBuy ? BigInt(0) : a.funding) + BigInt(1e17)
      )
        throw new Error("Keep 0.1 MON in your wallet for gas.");
      if (isBuy && (market.usdc ?? BigInt(0)) < a.funding)
        throw new Error("Insufficient USDC in your wallet.");
      setReview({
        isBuy,
        price: a.price,
        size: a.size,
        funding: a.funding,
        deadline: market.timestamp + BigInt(120),
        reviewedAt: Date.now(),
      });
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <div className="db-limit-ticket">
      <label className="db-input">
        <span>
          Size <i>MON</i>
        </span>
        <div>
          <input
            aria-label="Limit size MON"
            inputMode="decimal"
            value={size}
            disabled={locked}
            onChange={(e) => {
              setSize(e.target.value);
              setReview(undefined);
              setError("");
            }}
          />
          <span>MON</span>
        </div>
      </label>
      <label className="db-input">
        <span>
          Limit price <i>USDC per MON</i>
        </span>
        <div>
          <input
            aria-label="Spot limit price"
            inputMode="decimal"
            placeholder="0.035"
            value={price}
            disabled={locked}
            onChange={(e) => {
              setPrice(e.target.value);
              setReview(undefined);
              setError("");
            }}
          />
          <span>USDC</span>
        </div>
      </label>
      {market && (
        <p className="db-ticket-note">
          Minimum {Number(market.params[7]) / Number(market.params[1])} MON ·
          price step {market.params[6] / market.params[0]} USDC
        </p>
      )}
      {error && (
        <p className="s-alert is-error" role="alert">
          {error}
        </p>
      )}
      {!connected ? (
        <button className="s-btn is-primary is-wide" onClick={connect}>
          Connect to trade
        </button>
      ) : !orders.factory ? (
        <p className="s-alert">
          Limit orders are not enabled on this network yet. You can still use
          Market.
        </p>
      ) : !s?.account ? (
        <button
          className="s-btn is-primary is-wide"
          disabled={!orders.ready}
          onClick={() => void orders.create()}
        >
          Create Spot limit account
        </button>
      ) : review ? (
        <div className="db-limit-review" aria-label="Review Spot limit order">
          <dl className="db-review">
            <div>
              <dt>Order</dt>
              <dd>
                {review.isBuy ? "Buy" : "Sell"} {size} MON
              </dd>
            </div>
            <div>
              <dt>Limit price</dt>
              <dd>{price} USDC</dd>
            </div>
            <div>
              <dt>From wallet</dt>
              <dd>
                {display(review.funding, review.isBuy ? 6 : 18)}{" "}
                {review.isBuy ? "USDC" : "MON"}
              </dd>
            </div>
            <div>
              <dt>Time in force</dt>
              <dd>Good till cancelled</dd>
            </div>
            <div>
              <dt>Setsuna fee</dt>
              <dd>None · venue fees apply</dd>
            </div>
          </dl>
          <p className="db-ticket-note">
            Existing free Spot funds are used first. Orders may fill immediately
            or partially; unfilled size stays open. Proceeds stay in Spot
            trading balances.
          </p>
          <button
            className="s-btn is-primary is-wide"
            disabled={!orders.ready}
            onClick={async () => {
              await orders.place(review);
              setReview(undefined);
            }}
          >
            Confirm limit order
          </button>
          <button
            className="s-link"
            disabled={locked}
            onClick={() => setReview(undefined)}
          >
            Edit order
          </button>
        </div>
      ) : (
        <button
          className="s-btn is-primary is-wide"
          disabled={!orders.ready || !market}
          onClick={prepare}
        >
          Review limit order
        </button>
      )}
      <p className="db-ticket-note">
        Buy at your price or lower. Sell at your price or higher. Cancel
        unfilled size from Open orders, then withdraw free funds from Balances.
      </p>
    </div>
  );
}

export function SpotOrderAlerts({ orders }: { orders: SpotOrdersController }) {
  return (
    <>
      {(orders.error || orders.readError) && (
        <p className="s-alert is-error" role="alert">
          {orders.error || orders.readError}
        </p>
      )}
      {orders.notice && (
        <p className="s-alert is-ok" role="status">
          {orders.notice}
        </p>
      )}
      {orders.pending && (
        <p className="s-alert">
          Submitted transaction {shortAddress(orders.pending)}.{" "}
          <button
            className="s-link"
            disabled={orders.busy}
            onClick={() => void orders.reconcile()}
          >
            Check limit receipt
          </button>
        </p>
      )}
    </>
  );
}
export function SpotOpenOrders({
  orders,
  market,
}: {
  orders: SpotOrdersController;
  market?: SpotSnapshot;
}) {
  if (!orders.factory)
    return (
      <div className="db-account-empty">
        <p>Limit orders are not enabled on this network yet.</p>
      </div>
    );
  if (orders.readError)
    return (
      <div className="db-account-empty">
        <p>Open orders unavailable. Reconnecting…</p>
      </div>
    );
  if (!orders.snapshot)
    return (
      <div className="db-account-empty">
        <p>Loading orders…</p>
      </div>
    );
  return (
    <div className="db-limit-orders" aria-label="Spot open orders">
      {orders.snapshot.orders.length && market ? (
        orders.snapshot.orders.map((o) => (
          <div className="t-open-order" key={o.id.toString()}>
            <span>
              <b>{o.isBuy ? "Buy" : "Sell"} MON</b>
              <small>
                #{o.id.toString()} · {Number(o.size) / Number(market.params[1])}{" "}
                MON remaining
              </small>
            </span>
            <span>{o.price / market.params[0]} USDC</span>
            <button
              className="s-btn is-small"
              disabled={!orders.ready}
              onClick={() => void orders.cancel(o.id)}
            >
              Cancel order #{o.id.toString()}
            </button>
          </div>
        ))
      ) : (
        <div className="db-account-empty">
          <p>No open limit orders.</p>
          <span>
            Unfilled limit orders appear here. Market swaps execute immediately.
          </span>
        </div>
      )}
    </div>
  );
}
export function SpotTradingBalances({
  orders,
  market,
}: {
  orders: SpotOrdersController;
  market?: SpotSnapshot;
}) {
  const s = orders.snapshot;
  if (!s?.account) return null;
  const sp = market?.params[1],
    pp = market?.params[0];
  const lockedMON = sp
    ? s.orders
        .filter((o) => !o.isBuy)
        .reduce((sum, o) => sum + (o.size * BigInt(1e18)) / sp, BigInt(0))
    : undefined;
  const lockedUSDC =
    sp && pp
      ? s.orders
          .filter((o) => o.isBuy)
          .reduce(
            (sum, o) =>
              sum +
              (BigInt(o.price) * o.size * BigInt(1e6)) / (BigInt(pp) * sp),
            BigInt(0),
          )
      : undefined;
  return (
    <section className="db-trading-balances" aria-label="Spot trading balances">
      <h3>Spot trading balances</h3>
      {[
        {
          mon: true,
          asset: "MON",
          free: s.availableMON,
          locked: lockedMON,
          decimals: 18,
        },
        {
          mon: false,
          asset: "USDC",
          free: s.availableUSDC,
          locked: lockedUSDC,
          decimals: 6,
        },
      ].map((b) => (
        <div className="t-open-order" key={b.asset}>
          <span>
            <b>{b.asset}</b>
            <small>
              {b.locked === undefined ? "—" : display(b.locked, b.decimals)} in
              open orders
            </small>
          </span>
          <span>{display(b.free, b.decimals)} free</span>
          <button
            className="s-btn is-small"
            disabled={!orders.ready || b.free <= BigInt(0)}
            onClick={() => void orders.withdraw(b.mon)}
          >
            Withdraw {b.asset}
          </button>
        </div>
      ))}
      <p className="db-ticket-note">
        Filled proceeds and cancelled order funds stay here until reused for a
        limit order or withdrawn to your wallet.
      </p>
    </section>
  );
}
