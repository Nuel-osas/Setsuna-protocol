"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { encodeFunctionData, erc20Abi, formatUnits, type Hex } from "viem";
import { clientFor, useWallet } from "./WalletProvider";
import {
  readSpot,
  quoteSpot,
  spotABI,
  type SpotSnapshot,
  type SpotQuote,
} from "@/lib/setsuna/spot";
import { useTradingMarket } from "./useTradingMarket";
import { MarketChart } from "./TradingMarket";
import { SpotBook, SpotSummary } from "./SpotMarketPanels";
import Link from "next/link";
import DemoFunding from "./DemoFunding";
import { amount, message, shortAddress } from "@/lib/setsuna/format";

const show = (value: bigint | undefined, decimals: number) =>
  value === undefined
    ? "—"
    : Number(formatUnits(value, decimals)).toLocaleString("en-US", {
        maximumFractionDigits: 6,
      });

export default function SpotApp() {
  const terminal = useTradingMarket("spot");
  const wallet = useWallet(),
    { deployment: d, address } = wallet;
  const [marketTab, setMarketTab] = useState<"chart" | "book" | "trades">(
    "chart",
  );
  const [bookTab, setBookTab] = useState<"book" | "trades">("book");
  const [accountTab, setAccountTab] = useState<
    "history" | "balances" | "orders"
  >("history");
  const [mobileTrade, setMobileTrade] = useState(false);
  const [snapshot, setSnapshot] = useState<SpotSnapshot>();
  const [monToUSDC, setDirection] = useState(true);
  const [input, setInput] = useState("100");
  const [quote, setQuote] = useState<SpotQuote>();
  const [busy, setBusy] = useState("");
  const [readError, setReadError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<Hex>();
  const epoch = useRef(0);
  const pendingKey =
    d?.spot && address
      ? `setsuna.spot.pending.${d.chainId}.${d.spot.gateway}.${address}`
      : undefined;
  const refresh = useCallback(async () => {
    if (!d?.spot) return;
    const current = epoch.current;
    try {
      const next = await readSpot(d, address);
      if (current !== epoch.current) return;
      setSnapshot(next);
      setReadError("");
    } catch {
      if (current !== epoch.current) return;
      setSnapshot(undefined);
      setQuote(undefined);
      setReadError(
        "Could not read the Spot market. Transactions are disabled until the fork reconnects.",
      );
    }
  }, [d, address]);
  useEffect(() => {
    epoch.current++;
    setSnapshot(undefined);
    setQuote(undefined);
    setPending(undefined);
    setError("");
    setNotice("");
    if (pendingKey) {
      try {
        const hash = localStorage.getItem(pendingKey);
        if (hash && /^0x[0-9a-fA-F]{64}$/.test(hash)) setPending(hash as Hex);
      } catch {
        /* optional */
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 8000);
    return () => {
      epoch.current++;
      clearInterval(timer);
    };
  }, [refresh, pendingKey]);

  function track(hash?: Hex) {
    setPending(hash);
    if (pendingKey)
      try {
        if (hash) localStorage.setItem(pendingKey, hash);
        else localStorage.removeItem(pendingKey);
      } catch {
        /* optional */
      }
  }
  let parsed = BigInt(0);
  try {
    parsed = amount(input, monToUSDC ? 10 : 6);
    if (monToUSDC) parsed *= BigInt(10) ** BigInt(8);
  } catch {
    /* invalid form */
  }
  const inToken = monToUSDC ? "MON" : "USDC",
    outToken = monToUSDC ? "USDC" : "MON";
  const enough =
    snapshot &&
    parsed > BigInt(0) &&
    (monToUSDC
      ? (snapshot.mon ?? BigInt(0)) >= parsed + BigInt(10) ** BigInt(17)
      : (snapshot.usdc ?? BigInt(0)) >= parsed &&
        (snapshot.mon ?? BigInt(0)) >= BigInt(10) ** BigInt(17));
  const ready =
    !!d?.spot && !!address && !!snapshot && !busy && !pending && !readError;
  const fresh =
    quote &&
    snapshot &&
    quote.input === parsed &&
    quote.monToUSDC === monToUSDC &&
    snapshot.timestamp < quote.deadline;

  async function getQuote() {
    if (!d?.spot || !ready || !enough) return;
    const current = epoch.current;
    setBusy("Reading Kuru…");
    setError("");
    setNotice("");
    setQuote(undefined);
    try {
      const q = await quoteSpot(d, monToUSDC, parsed);
      if (epoch.current === current) setQuote(q);
    } catch (e) {
      if (epoch.current === current) setError(message(e));
    } finally {
      if (epoch.current === current) setBusy("");
    }
  }

  async function swap() {
    if (!d?.spot || !address || !ready || !fresh || !quote || !enough) return;
    const current = epoch.current,
      q = quote,
      s = d.spot;
    const unchanged = () => {
      if (epoch.current !== current)
        throw new Error(
          "Account changed. Review a new quote before continuing.",
        );
    };
    setBusy(monToUSDC ? "Confirm swap…" : "Approve USDC…");
    setError("");
    setNotice("");
    try {
      const c = clientFor(d);
      if ((await c.getBlock()).timestamp >= q.deadline)
        throw new Error("Quote expired. Refresh it before swapping.");
      if (!q.monToUSDC) {
        const allowance = await c.readContract({
          address: s.usdc,
          abi: erc20Abi,
          functionName: "allowance",
          args: [address, s.gateway],
        });
        unchanged();
        if (allowance < q.input) {
          await wallet.send(
            s.usdc,
            encodeFunctionData({
              abi: erc20Abi,
              functionName: "approve",
              args: [s.gateway, q.input],
            }),
            track,
          );
          track();
          unchanged();
        }
      }
      unchanged();
      setBusy("Confirm swap…");
      const data = q.monToUSDC
        ? encodeFunctionData({
            abi: spotABI,
            functionName: "sellMON",
            args: [q.minOut, q.deadline],
          })
        : encodeFunctionData({
            abi: spotABI,
            functionName: "buyMON",
            args: [q.input, q.minOut, q.deadline],
          });
      const hash = await wallet.send(
        s.gateway,
        data,
        track,
        q.monToUSDC ? q.input : BigInt(0),
      );
      track();
      unchanged();
      setQuote(undefined);
      setNotice(
        `Swap confirmed · ${shortAddress(hash)}. The receipt below shows the amount received.`,
      );
      await refresh();
    } catch (e) {
      if (epoch.current === current) setError(message(e));
    } finally {
      if (epoch.current === current) setBusy("");
    }
  }
  async function reconcile() {
    if (!d || !pending) return;
    setBusy("Checking receipt…");
    try {
      const r = await clientFor(d).getTransactionReceipt({ hash: pending });
      track();
      setQuote(undefined);
      setError("");
      setNotice(
        r.status === "success"
          ? "Transaction confirmed. Review balances and request a fresh quote before continuing."
          : "Transaction reverted. No swap was completed.",
      );
      await refresh();
    } catch {
      setError(
        "Receipt is still unavailable. Do not repeat the transaction yet.",
      );
    } finally {
      setBusy("");
    }
  }

  const spendable = monToUSDC
    ? snapshot?.mon !== undefined && snapshot.mon > BigInt(10) ** BigInt(17)
      ? snapshot.mon - BigInt(10) ** BigInt(17)
      : BigInt(0)
    : (snapshot?.usdc ?? BigInt(0));
  function useFraction(percent: number) {
    let value = (spendable * BigInt(percent)) / BigInt(100);
    // Native MON orders have ten decimals of precision; always round down.
    if (monToUSDC)
      value = (value / BigInt(10) ** BigInt(8)) * BigInt(10) ** BigInt(8);
    setInput(formatUnits(value, monToUSDC ? 18 : 6));
    setQuote(undefined);
    setError("");
  }
  const fraction =
    spendable > BigInt(0)
      ? Math.min(100, Math.max(0, Number((parsed * BigInt(100)) / spendable)))
      : 0;
  const changeDirection = (direction: boolean) => {
    setDirection(direction);
    setInput(direction ? "100" : "1");
    setQuote(undefined);
    setError("");
    setNotice("");
  };
  const openWallet = () => wallet.openConnect();
  return (
    <main
      id="main"
      className="s-app t-terminal t-spot db-spot"
      data-panel={marketTab}
      data-trade-open={mobileTrade}
    >
      <div className="db-network-banner">
        <span className="t-environment">
          <i />
          {d?.mode === "local"
            ? "Local fork · test funds"
            : d?.mode === "demo"
              ? "Demo · test funds"
              : "Mainnet · view only"}
        </span>
        <span>
          {d?.mode === "preview"
            ? "Live Kuru markets. Public trading is not open yet."
            : "Prices, quotes and fills use the connected demo fork."}
        </span>
      </div>
      {readError && (
        <p className="s-alert is-error" role="alert">
          {readError}
        </p>
      )}
      {error && (
        <p className="s-alert is-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="s-alert is-ok" role="status">
          {notice}
        </p>
      )}
      {pending && (
        <p className="s-alert">
          Submitted transaction {shortAddress(pending)}.{" "}
          <button
            className="s-link"
            disabled={!!busy}
            onClick={() => void reconcile()}
          >
            Check receipt
          </button>
        </p>
      )}
      <div className="db-workspace">
        <SpotSummary reading={terminal.reading} />
        <div
          className="db-mobile-tabs"
          role="group"
          aria-label="Spot market view"
        >
          {(["chart", "book", "trades"] as const).map((t) => (
            <button
              key={t}
              aria-pressed={marketTab === t}
              onClick={() => {
                setMarketTab(t);
                if (t !== "chart") setBookTab(t);
              }}
            >
              {t === "chart" ? "Chart" : t === "book" ? "Order Book" : "Trades"}
            </button>
          ))}
        </div>
        <div className="db-chart">
          <MarketChart kind="spot" {...terminal} defaultView="price" />
        </div>
        <SpotBook
          reading={terminal.reading}
          live={d?.mode === "preview"}
          view={bookTab}
          onView={setBookTab}
        />
        <section className="db-ticket t-ticket" aria-label="Spot order ticket">
          <DemoFunding onFunded={refresh} disabled={!!busy || !!pending} />
          <div className="db-tabs db-order-tabs">
            <span className="is-active">Market</span>
            <span
              className="db-unavailable"
              title="Limit orders are not supported by the current Spot gateway"
            >
              Limit <small>Unavailable</small>
            </span>
            <button
              className="db-close-trade"
              aria-label="Close order form"
              onClick={() => setMobileTrade(false)}
            >
              ×
            </button>
          </div>
          <div
            className="db-direction s-segment"
            role="group"
            aria-label="Swap direction"
          >
            {[false, true].map((direction) => (
              <button
                key={String(direction)}
                disabled={!!busy || !!pending}
                className={monToUSDC === direction ? "is-on" : ""}
                aria-label={direction ? "Sell MON" : "Buy MON"}
                aria-pressed={monToUSDC === direction}
                onClick={() => changeDirection(direction)}
              >
                {direction ? "SELL" : "BUY"}
              </button>
            ))}
          </div>
          <div className="db-available">
            <span>Wallet balance</span>
            <strong>
              {show(
                monToUSDC ? snapshot?.mon : snapshot?.usdc,
                monToUSDC ? 18 : 6,
              )}{" "}
              {inToken}
            </strong>
          </div>
          <label className="db-input">
            <span>
              Size <i>{inToken}</i>
            </span>
            <div>
              <input
                aria-label="Spot amount"
                inputMode="decimal"
                value={input}
                disabled={!!busy || !!pending}
                onChange={(e) => {
                  setInput(e.target.value);
                  setQuote(undefined);
                  setError("");
                }}
              />
              <span>{inToken}</span>
            </div>
          </label>
          <div
            className="db-fractions"
            role="group"
            aria-label="Use wallet balance"
          >
            {[0, 25, 50, 75, 100].map((n) => (
              <button
                key={n}
                disabled={!snapshot || !address || !!busy || !!pending}
                onClick={() => useFraction(n)}
              >
                {n === 100 ? "Max" : `${n}%`}
              </button>
            ))}
          </div>
          <input
            className="db-range"
            type="range"
            min="0"
            max="100"
            step="1"
            value={fraction}
            aria-label="Trade balance percentage"
            disabled={!snapshot || !address || !!busy || !!pending}
            onChange={(e) => useFraction(Number(e.target.value))}
          />
          <dl className="db-review">
            <div>
              <dt>You pay</dt>
              <dd>
                {parsed > BigInt(0) ? show(parsed, monToUSDC ? 18 : 6) : "—"}{" "}
                {inToken}
              </dd>
            </div>
            <div>
              <dt>You receive</dt>
              <dd>
                {show(quote?.output, monToUSDC ? 6 : 18)} {outToken}
              </dd>
            </div>
            <div>
              <dt>Minimum receive</dt>
              <dd>
                {show(quote?.minOut, monToUSDC ? 6 : 18)} {outToken}
              </dd>
            </div>
            <div>
              <dt>Max slippage</dt>
              <dd>0.50%</dd>
            </div>
            <div>
              <dt>Execution</dt>
              <dd>Fill or kill</dd>
            </div>
            <div>
              <dt>Quote block</dt>
              <dd>{quote?.block?.toString() ?? "—"}</dd>
            </div>
          </dl>
          {!address ? (
            <button
              className="s-btn is-primary is-wide db-submit"
              onClick={openWallet}
            >
              Connect to swap
            </button>
          ) : (
            <div className="db-submit-actions">
              <button
                className="s-btn db-quote"
                disabled={!ready || !enough}
                onClick={() => void getQuote()}
              >
                Get quote
              </button>
              <button
                className="s-btn is-primary db-submit"
                disabled={!ready || !fresh || !enough}
                onClick={() => void swap()}
              >
                {busy || `Swap ${inToken} for ${outToken}`}
              </button>
            </div>
          )}
          {!d?.spot && (
            <p className="db-ticket-note">
              Explore live markets. Public swaps open when the demo deployment
              is connected.
            </p>
          )}
          {address && snapshot && !enough && (
            <p className="db-ticket-note">
              Enter an amount within your balance. Keep 0.1 MON for gas.
            </p>
          )}
          <details className="db-execution-details">
            <summary>
              Execution details <span>⌄</span>
            </summary>
            <p>
              Quotes expire after two minutes of chain time. The full amount
              must execute above the minimum receive value or the transaction
              reverts. Gas is paid in MON.
            </p>
            {!monToUSDC && (
              <p>
                USDC may require an exact-amount approval. If the swap fails,
                that approval may remain.
              </p>
            )}
            <p>The Max shortcut keeps 0.1 MON in your wallet for gas.</p>
          </details>
          <div className="db-powered">
            <span className="db-status-dot" /> Routed through Kuru · Monad
          </div>
        </section>
        <section className="db-account" aria-label="Spot account activity">
          <div className="db-tabs" role="group" aria-label="Spot account view">
            <button
              aria-pressed={accountTab === "balances"}
              onClick={() => setAccountTab("balances")}
            >
              Balances
            </button>
            <button
              aria-pressed={accountTab === "orders"}
              onClick={() => setAccountTab("orders")}
            >
              Open orders <small>0</small>
            </button>
            <button
              aria-pressed={accountTab === "history"}
              onClick={() => setAccountTab("history")}
            >
              History{" "}
              {snapshot?.history.length ? (
                <small>{snapshot.history.length}</small>
              ) : null}
            </button>
          </div>
          {!address ? (
            <div className="db-account-empty">
              <p>Connect a wallet to see your balances and trade history.</p>
              <button onClick={openWallet}>CONNECT WALLET</button>
            </div>
          ) : accountTab === "balances" ? (
            <div className="db-balance-table">
              <div className="db-table-head">
                <span>Asset</span>
                <span>Wallet balance</span>
                <span>Available to trade</span>
              </div>
              {[
                { token: "MON", value: snapshot?.mon, decimals: 18 },
                { token: "USDC", value: snapshot?.usdc, decimals: 6 },
              ].map(({ token, value, decimals }) => (
                <div key={token}>
                  <strong>{token}</strong>
                  <span>{show(value, decimals)}</span>
                  <span>
                    {token === "MON" && value !== undefined
                      ? show(
                          value > BigInt(10) ** BigInt(17)
                            ? value - BigInt(10) ** BigInt(17)
                            : BigInt(0),
                          18,
                        )
                      : show(value, decimals)}
                  </span>
                </div>
              ))}
              <p>
                Spot uses your wallet tokens. Earn shares and Perpl AUSD
                collateral remain separate.
              </p>
            </div>
          ) : accountTab === "orders" ? (
            <div className="db-account-empty">
              <p>No open orders.</p>
              <span>
                Market swaps fill immediately or revert. Resting limit orders
                are not available yet.
              </span>
            </div>
          ) : snapshot?.history.length ? (
            <div className="db-receipts">
              <div className="db-table-head">
                <span>Market / side</span>
                <span>Received</span>
                <span>Transaction</span>
              </div>
              {snapshot.history.map((event) => (
                <div key={`${event.transactionHash}-${event.logIndex}`}>
                  <strong
                    className={event.args.monToUSDC ? "is-sell" : "is-buy"}
                  >
                    {event.args.monToUSDC ? "MON → USDC" : "USDC → MON"}
                  </strong>
                  <span>
                    Received{" "}
                    {show(event.args.amountOut, event.args.monToUSDC ? 6 : 18)}{" "}
                    {event.args.monToUSDC ? "USDC" : "MON"}
                  </span>
                  <code title={event.transactionHash}>
                    {shortAddress(event.transactionHash)}
                  </code>
                </div>
              ))}
            </div>
          ) : (
            <div className="db-account-empty">
              <p>
                {snapshot?.historyUnavailable
                  ? "Receipts could not be loaded."
                  : "No swaps yet."}
              </p>
              <span>Your confirmed swaps will appear here.</span>
            </div>
          )}
        </section>
      </div>
      <div className="db-mobile-trade-bar">
        <span>MON / USDC</span>
        <button onClick={() => setMobileTrade(!mobileTrade)}>
          {mobileTrade ? "Close order form" : "Trade MON"}
        </button>
      </div>
      <footer className="db-footer">
        <div>
          <Link href="/security/">Security</Link>
          <Link href="/terms-of-use/">Terms</Link>
          <Link href="/privacy-policy/">Privacy</Link>
        </div>
        <span>
          setsuna <small>SPOT</small>
        </span>
        <span className="db-footer-status">
          <i className="db-status-dot" />
          {terminal.reading
            ? `Connected · ${terminal.reading.block.toLocaleString()}`
            : "Connecting to Kuru…"}
        </span>
      </footer>
    </main>
  );
}
