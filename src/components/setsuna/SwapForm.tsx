"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { encodeFunctionData, erc20Abi, formatUnits, parseUnits } from "viem";
import { clientFor, useWallet } from "./WalletProvider";
import TokenIcon from "./TokenIcon";
import { message } from "@/lib/setsuna/format";
import { useNoticeToast } from "./Toaster";
import { smartAccountHint, useMonReserve } from "./useMonReserve";
import {
  SWAP_FEE_BPS,
  SWAP_ROUTER,
  SWAP_SLIPPAGE_BPS,
  SWAP_TOKENS,
  buildSwap,
  quoteSwap,
  type SwapQuote,
  type SwapToken,
} from "@/lib/setsuna/aggregator";

const TOKENS: SwapToken[] = ["MON", "USDC", "AUSD"];
const GAS_RESERVE = BigInt("100000000000000000"); // keep 0.1 MON for gas
const QUOTE_TTL_MS = 30_000;

const show = (v: bigint | undefined, decimals: number, digits = 6) =>
  v === undefined ? "—" : Number(formatUnits(v, decimals)).toLocaleString("en-US", { maximumFractionDigits: digits });

/**
 * Swap MON, USDC and AUSD at the best price across Monad (KyberSwap routing). The user's wallet
 * signs the router call; Setsuna's 0.1% fee is taken from the amount in.
 */
export default function SwapForm({
  initialFrom = "MON",
  initialTo = "USDC",
  onSwapped,
}: {
  initialFrom?: SwapToken;
  initialTo?: SwapToken;
  onSwapped?: () => void;
}) {
  const wallet = useWallet();
  const { deployment: d, address, openConnect } = wallet;
  const [from, setFrom] = useState<SwapToken>(initialFrom);
  const [to, setTo] = useState<SwapToken>(initialTo);
  const [input, setInput] = useState("");
  const [balances, setBalances] = useState<Partial<Record<SwapToken, bigint>>>({});
  const [quote, setQuote] = useState<SwapQuote>();
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useNoticeToast(notice);
  const seq = useRef(0);
  const mainnet = d?.mode === "mainnet";
  const { delegated, reserve } = useMonReserve();

  const readBalances = useCallback(async () => {
    if (!d || !address) return setBalances({});
    const c = clientFor(d);
    const [mon, usdc, ausd] = await Promise.all([
      c.getBalance({ address }),
      c.readContract({ address: SWAP_TOKENS.USDC.address, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
      c.readContract({ address: SWAP_TOKENS.AUSD.address, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
    ]).catch(() => [undefined, undefined, undefined] as const);
    setBalances({ MON: mon, USDC: usdc, AUSD: ausd });
  }, [d, address]);
  useEffect(() => {
    void readBalances();
    const t = setInterval(() => void readBalances(), 15_000);
    return () => clearInterval(t);
  }, [readBalances]);

  const decimals = SWAP_TOKENS[from].decimals;
  let amountIn = BigInt(0);
  if (new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`).test(input)) {
    try {
      amountIn = parseUnits(input, decimals);
    } catch {
      amountIn = BigInt(0);
    }
  }
  const balance = balances[from];
  const spendable =
    balance === undefined ? undefined : from === "MON" ? (balance > GAS_RESERVE + reserve ? balance - GAS_RESERVE - reserve : BigInt(0)) : balance;

  // Quote once the amount settles; refresh when it ages.
  useEffect(() => {
    setQuote(undefined);
    setQuoteError("");
    if (!mainnet || amountIn === BigInt(0) || from === to) return;
    const mine = ++seq.current;
    setQuoting(true);
    const t = setTimeout(async () => {
      try {
        const q = await quoteSwap(from, to, amountIn);
        if (mine === seq.current) setQuote(q);
      } catch (e) {
        if (mine === seq.current) setQuoteError(message(e));
      } finally {
        if (mine === seq.current) setQuoting(false);
      }
    }, 400);
    const refresh = setInterval(() => setQuote((q) => (q && Date.now() - q.at > QUOTE_TTL_MS ? undefined : q)), 5_000);
    return () => {
      clearTimeout(t);
      clearInterval(refresh);
    };
    // amountIn is derived from input; depend on the input string to avoid bigint identity churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, input, mainnet]);

  function pick(side: "from" | "to", token: SwapToken) {
    if (side === "from") {
      if (token === to) setTo(from);
      setFrom(token);
    } else {
      if (token === from) setFrom(to);
      setTo(token);
    }
    setInput("");
    setError("");
  }

  const reason = !mainnet
    ? "Swaps run on Monad mainnet."
    : from === to
      ? "Choose two different tokens."
      : input && amountIn === BigInt(0)
        ? "Enter a valid amount."
        : address && spendable !== undefined && amountIn > spendable
          ? from === "MON"
            ? delegated
              ? `You can swap up to ${show(spendable, 18, 4)} MON. ${smartAccountHint}`
              : "Not enough MON. Keep 0.1 MON for gas."
            : `Not enough ${from}.`
          : address && from !== "MON" && (balances.MON ?? BigInt(0)) === BigInt(0) && amountIn > BigInt(0)
            ? "You need a little MON for the network fee."
            : quoteError;

  async function swap() {
    if (!d || !address || !quote || reason) return;
    setError("");
    try {
      // Fresh price at the moment of signing.
      setBusy("Getting the live price…");
      const fresh = await quoteSwap(from, to, amountIn);
      setQuote(fresh);
      const token = SWAP_TOKENS[from];
      if (!token.native) {
        const allowance = await clientFor(d).readContract({
          address: token.address,
          abi: erc20Abi,
          functionName: "allowance",
          args: [address, SWAP_ROUTER],
        });
        if (allowance < amountIn) {
          setBusy(`Approve ${from}…`);
          await wallet.send(token.address, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [SWAP_ROUTER, amountIn] }));
        }
      }
      setBusy("Confirm swap…");
      const tx = await buildSwap(fresh, address);
      await wallet.send(tx.to, tx.data, undefined, tx.value);
      setNotice(`Swapped ${show(amountIn, decimals, 4)} ${from} for about ${show(fresh.amountOut, SWAP_TOKENS[to].decimals, 4)} ${to}.`);
      setInput("");
      setQuote(undefined);
      await readBalances();
      onSwapped?.();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy("");
    }
  }

  const tokenRow = (side: "from" | "to", selected: SwapToken) => (
    <div className="sw-tokens" role="group" aria-label={side === "from" ? "Swap from" : "Swap to"}>
      {TOKENS.map((t) => (
        <button key={t} type="button" aria-pressed={selected === t} disabled={!!busy} onClick={() => pick(side, t)}>
          <TokenIcon asset={t} size={16} />
          {t}
        </button>
      ))}
    </div>
  );

  return (
    <div className="sw-form">
      <div className="db-available">
        <span>From</span>
        <strong>
          {address ? `${show(balance, decimals, 4)} ${from}` : "—"}
        </strong>
      </div>
      {tokenRow("from", from)}
      <label className="db-input">
        <span>
          You pay <i>{from}</i>
        </span>
        <div>
          <input
            aria-label={`Amount of ${from} to swap`}
            inputMode="decimal"
            placeholder="0.00"
            value={input}
            disabled={!!busy}
            onChange={(e) => setInput(e.target.value)}
          />
          <span className="s-token-label">
            <TokenIcon asset={from} size={18} />
            {from}
          </span>
        </div>
      </label>
      <div className="db-fractions" role="group" aria-label="Use wallet balance">
        {[25, 50, 75, 100].map((n) => (
          <button
            key={n}
            type="button"
            disabled={!address || !spendable || !!busy}
            onClick={() => setInput(formatUnits(((spendable ?? BigInt(0)) * BigInt(n)) / BigInt(100), decimals))}
          >
            {n === 100 ? "Max" : `${n}%`}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="sw-flip"
        aria-label="Swap direction"
        disabled={!!busy}
        onClick={() => {
          setFrom(to);
          setTo(from);
          setInput("");
        }}
      >
        ⇅
      </button>
      <div className="db-available">
        <span>To</span>
        <strong>{address ? `${show(balances[to], SWAP_TOKENS[to].decimals, 4)} ${to}` : "—"}</strong>
      </div>
      {tokenRow("to", to)}
      <dl className="db-review">
        <div>
          <dt>You receive</dt>
          <dd>
            {quoting ? "…" : show(quote?.amountOut, SWAP_TOKENS[to].decimals)} {to}
          </dd>
        </div>
        <div>
          <dt>Minimum receive</dt>
          <dd>
            {show(quote?.minOut, SWAP_TOKENS[to].decimals)} {to}
          </dd>
        </div>
        <div>
          <dt>Setsuna fee · {(SWAP_FEE_BPS / 100).toFixed(2)}%</dt>
          <dd>
            {quote ? `${show(quote.fee, decimals)} ${from}` : "—"}
          </dd>
        </div>
        <div>
          <dt>Max slippage</dt>
          <dd>{(SWAP_SLIPPAGE_BPS / 100).toFixed(2)}%</dd>
        </div>
        <div>
          <dt>Route</dt>
          <dd>{quote?.venues.length ? quote.venues.join(" · ") : "—"}</dd>
        </div>
      </dl>
      {(reason || error) && (input || error) && (
        <p className={error ? "s-error" : "db-ticket-note"} role={error ? "alert" : "status"}>
          {error || reason}
        </p>
      )}
      {!address ? (
        <button className="s-btn is-primary is-wide db-submit" onClick={openConnect}>
          Connect to swap
        </button>
      ) : (
        <button
          className="s-btn is-primary is-wide db-submit"
          disabled={!quote || !!reason || !!busy}
          onClick={() => void swap()}
        >
          {busy || (quoting ? "Getting the live price…" : `Swap ${from} for ${to}`)}
        </button>
      )}
      <details className="db-execution-details">
        <summary>
          Execution details <span>⌄</span>
        </summary>
        <p>
          Routed by KyberSwap across Monad&apos;s pools (Uniswap v4, Curve, Balancer and others) for the best price. The swap reverts if
          you&apos;d receive less than the minimum. Setsuna&apos;s 0.1% is taken from the amount in. Gas is paid in MON.
        </p>
        <p>USDC and AUSD need an exact-amount approval the first time. The Max shortcut keeps 0.1 MON for gas.</p>
      </details>
    </div>
  );
}
