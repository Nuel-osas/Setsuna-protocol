"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { encodeFunctionData, erc20Abi, formatUnits, parseUnits, type Hex } from "viem";
import { clientFor, useWallet } from "./WalletProvider";
import { Mark } from "./Brand";
import TokenIcon from "./TokenIcon";
import { EarnAssetPicker, earnAmount, type EarnMode, type PickerAsset } from "./EarnForm";
import { message } from "@/lib/setsuna/format";
import { AUSD_SAVINGS, ausdWrapperAbi, readAUSD, type AUSDSnapshot } from "@/lib/setsuna/ausd";
import { useNoticeToast } from "./Toaster";

const { wrapper, ausd, assetDecimals: A, shareDecimals: S } = AUSD_SAVINGS;

const parseAmount = (value: string, decimals: number) => {
  if (!new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`).test(value)) return BigInt(0);
  try {
    return parseUnits(value, decimals);
  } catch {
    return BigInt(0);
  }
};

function Token({ receipt }: { receipt: boolean }) {
  return (
    <span aria-hidden="true" className={`s-earn-token is-ausd ${receipt ? "is-receipt" : ""}`}>
      {receipt ? (
        <>
          <Mark size={24} />
          <span className="e-underlying-badge">
            <TokenIcon asset="AUSD" size={12} />
          </span>
        </>
      ) : (
        <TokenIcon asset="AUSD" size={30} />
      )}
    </span>
  );
}

/** Save AUSD in setsUSDC through setsAUSD: AUSD in, AUSD out. */
export default function AUSDEarnForm({
  mode,
  setMode,
  setAsset,
  blendedApr,
  onChanged,
}: {
  mode: EarnMode;
  setMode: (mode: EarnMode) => void;
  setAsset: (asset: PickerAsset) => void;
  /** setsUSDC's current base rate, 1e18 = 100%. */
  blendedApr?: bigint;
  /** Lets the setsUSDC view refresh after a move changes the vault. */
  onChanged?: () => void;
}) {
  const wallet = useWallet();
  const { deployment: d, address, openConnect } = wallet;
  const mainnet = d?.mode === "mainnet";
  const [snap, setSnap] = useState<AUSDSnapshot>();
  const [readError, setReadError] = useState("");
  const [amount, setAmount] = useState("");
  const [shares, setShares] = useState("");
  const [quote, setQuote] = useState<{ key: string; value?: bigint; failed?: boolean }>();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useNoticeToast(notice);
  const inFlight = useRef(false);
  const withdrawing = mode === "withdraw";

  const refresh = useCallback(async () => {
    if (!d || !mainnet) return;
    try {
      setSnap(await readAUSD(clientFor(d), address));
      setReadError("");
    } catch {
      setReadError("Could not read setsAUSD on Monad mainnet. AUSD savings are disabled until it can be read.");
    }
  }, [d, mainnet, address]);

  useEffect(() => {
    setSnap(undefined);
    void refresh();
    const timer = setInterval(() => !inFlight.current && void refresh(), 15_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const depositUnits = parseAmount(amount, A);
  const redeemUnits = parseAmount(shares, S);
  const units = withdrawing ? redeemUnits : depositUnits;
  const quoteKey = `${address}:${mode}:${units}:${snap?.block}`;
  const quoted = quote?.key === quoteKey ? quote : undefined;

  useEffect(() => {
    if (!d || !snap || units <= BigInt(0)) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const value = await clientFor(d).readContract({
          address: wrapper,
          abi: ausdWrapperAbi,
          functionName: withdrawing ? "previewRedeem" : "previewDeposit",
          args: [units],
        });
        if (!cancelled) setQuote({ key: quoteKey, value });
      } catch {
        if (!cancelled) setQuote({ key: quoteKey, failed: true });
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [d, snap, units, withdrawing, quoteKey]);

  const locked = !!busy;
  const healthy = !!snap && !readError;
  const maximum = withdrawing
    ? (snap?.maxRedeem ?? BigInt(0))
    : (snap?.walletBalance ?? BigInt(0)) < (snap?.maxDeposit ?? BigInt(0))
      ? (snap?.walletBalance ?? BigInt(0))
      : (snap?.maxDeposit ?? BigInt(0));
  const reason = locked
    ? busy
    : !mainnet
      ? "AUSD savings are on Monad mainnet only."
      : readError
        ? readError
        : !snap
          ? "Reading setsAUSD…"
          : !snap.pegOk
            ? "AUSD and USDC are more than 0.2% apart right now, so AUSD savings are paused until the peg returns. Your savings stay safe in setsUSDC."
            : units > BigInt(0) && withdrawing && units > snap.maxRedeem
              ? "This exceeds your currently withdrawable setsAUSD."
              : units > BigInt(0) && !withdrawing && address && units > (snap.walletBalance ?? BigInt(0))
                ? "Insufficient AUSD balance."
                : units > BigInt(0) && !withdrawing && units > snap.maxDeposit
                  ? "This exceeds setsUSDC's remaining deposit capacity."
                  : quoted?.failed
                    ? "Could not load an onchain quote. Try changing the amount."
                    : (withdrawing ? shares : amount) && units === BigInt(0)
                      ? "Enter a valid amount greater than zero."
                      : "";
  const canSubmit = healthy && snap!.pegOk && !reason && units > BigInt(0) && !!quoted?.value;

  async function act(kind: "deposit" | "withdraw" | "unwrap") {
    if (!d || !address || !snap) return;
    inFlight.current = true;
    setError("");
    setNotice("");
    try {
      const c = clientFor(d);
      if (kind === "deposit") {
        setBusy("Approve AUSD…");
        await wallet.send(ausd, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [wrapper, depositUnits] }));
        setBusy("Confirm AUSD deposit…");
        const preview = await c.readContract({ address: wrapper, abi: ausdWrapperAbi, functionName: "previewDeposit", args: [depositUnits] });
        if (preview === BigInt(0)) throw new Error("Deposit is too small to mint shares.");
        await wallet.send(
          wrapper,
          encodeFunctionData({ abi: ausdWrapperAbi, functionName: "depositWithMinShares", args: [depositUnits, address, preview - preview / BigInt(1000)] }),
        );
        setAmount("");
        setNotice("Deposit confirmed. Your AUSD is saved in setsUSDC, held as setsAUSD.");
      } else {
        const available = await c.readContract({ address: wrapper, abi: ausdWrapperAbi, functionName: "maxRedeem", args: [address] });
        if (redeemUnits > available) throw new Error("Your available setsAUSD changed. Select Max again.");
        if (kind === "withdraw") {
          setBusy("Confirm AUSD withdrawal…");
          const out = await c.readContract({ address: wrapper, abi: ausdWrapperAbi, functionName: "previewRedeem", args: [redeemUnits] });
          if (out === BigInt(0)) throw new Error("Select more setsAUSD to withdraw.");
          await wallet.send(
            wrapper,
            encodeFunctionData({ abi: ausdWrapperAbi, functionName: "redeemWithMinAssets", args: [redeemUnits, address, address, out - out / BigInt(1000)] }),
          );
          setNotice("Withdrawal confirmed. AUSD has returned to your wallet.");
        } else {
          setBusy("Confirm conversion to setsUSDC…");
          await wallet.send(wrapper, encodeFunctionData({ abi: ausdWrapperAbi, functionName: "unwrap", args: [redeemUnits, address, address] }));
          setNotice("Converted. You now hold the same amount as setsUSDC; withdraw it as USDC from the USDC tab.");
        }
        setShares("");
      }
      onChanged?.();
      await refresh();
    } catch (e) {
      setError(message(e));
      await refresh();
    } finally {
      inFlight.current = false;
      setBusy("");
    }
  }

  function changeMode(next: EarnMode) {
    if (locked || next === mode) return;
    setAmount("");
    setShares("");
    setMode(next);
  }

  const input = withdrawing ? shares : amount;
  const setInput = withdrawing ? setShares : setAmount;

  return (
    <section className="s-card s-earn-form" aria-label="AUSD savings transaction">
      <div className="s-earn-mode" role="group" aria-label="Earn action">
        {(["deposit", "withdraw"] as const).map((action) => (
          <button key={action} type="button" disabled={locked} aria-pressed={mode === action} onClick={() => changeMode(action)}>
            {action === "deposit" ? "Deposit" : "Withdraw"}
          </button>
        ))}
      </div>
      <div className="s-earn-form-body">
        <div className="s-earn-amount-panel">
          <div className="s-earn-panel-label">
            <label htmlFor="ausd-amount">{withdrawing ? "You redeem" : "You deposit"}</label>
            <span className="s-earn-balance-inline">
              Balance{" "}
              {address ? `${earnAmount(withdrawing ? snap?.shares : snap?.walletBalance, withdrawing ? S : A)} ${withdrawing ? "setsAUSD" : "AUSD"}` : "—"}
            </span>
          </div>
          <div className="s-earn-amount-row">
            <input
              id="ausd-amount"
              aria-label={withdrawing ? "setsAUSD to withdraw" : "Amount of AUSD"}
              placeholder="0.00"
              inputMode="decimal"
              autoComplete="off"
              value={input}
              disabled={locked}
              onChange={(e) => setInput(e.target.value)}
            />
            <EarnAssetPicker asset="AUSD" receipt={withdrawing} disabled={locked || !d} onSelect={setAsset} />
          </div>
          <div className="s-earn-percentages" role="group" aria-label="Amount shortcuts">
            {[25, 50, 75, 100].map((percent) => (
              <button
                key={percent}
                type="button"
                className={percent === 100 ? "s-earn-max" : undefined}
                disabled={!address || !healthy || locked || maximum <= BigInt(0)}
                onClick={() => setInput(formatUnits((maximum * BigInt(percent)) / BigInt(100), withdrawing ? S : A))}
              >
                {percent === 100 ? "Max" : `${percent}%`}
              </button>
            ))}
          </div>
        </div>
        <div className="s-earn-direction">
          <button type="button" disabled={locked} aria-label={withdrawing ? "Switch to deposit" : "Switch to withdraw"} onClick={() => changeMode(withdrawing ? "deposit" : "withdraw")}>
            ↓
          </button>
        </div>
        <div className="s-earn-amount-panel is-output">
          <span className="s-earn-panel-label">You receive · estimated</span>
          <div className="s-earn-amount-row">
            <output aria-label="Estimated amount received" aria-live="polite">
              {units === BigInt(0) ? "0.00" : quoted?.failed || !healthy ? "—" : quoted?.value === undefined ? "…" : earnAmount(quoted.value, withdrawing ? A : S, 6)}
            </output>
            <span className="s-earn-receipt-token">
              <Token receipt={!withdrawing} />
              {withdrawing ? "AUSD" : "setsAUSD"}
            </span>
          </div>
          <p className="s-earn-balance">
            {withdrawing ? "Swapped back to AUSD and returned to your wallet" : "Swapped to USDC and saved in setsUSDC, one setsAUSD per setsUSDC share"}
          </p>
        </div>
        <dl className="s-earn-form-facts">
          <div>
            <dt>Current base rate</dt>
            <dd>{blendedApr === undefined ? "—" : `${(Number(formatUnits(blendedApr, 18)) * 100).toFixed(2)}% APR`}</dd>
          </div>
          <div>
            <dt>Swap cost, in and out</dt>
            <dd>{snap ? `~${(snap.roundTripBps / 100).toFixed(3)}%` : "—"}</dd>
          </div>
          {address && snap && snap.shares > BigInt(0) && (
            <div>
              <dt>Your AUSD savings</dt>
              <dd>
                {earnAmount(snap.value, A, 4)} AUSD · {earnAmount(snap.shares, S, 4)} setsAUSD
              </dd>
            </div>
          )}
        </dl>
        {(reason || error) && (
          <p className={error ? "s-error" : "s-earn-form-hint"} role={error ? "alert" : "status"}>
            {error || reason}
          </p>
        )}
        <button
          type="button"
          className="s-btn is-primary is-wide"
          disabled={!!address && !canSubmit}
          onClick={() => (address ? void act(withdrawing ? "withdraw" : "deposit") : openConnect())}
        >
          {!address ? "Connect account" : busy || `${withdrawing ? "Withdraw" : "Deposit"} AUSD`}
        </button>
        {withdrawing && address && (
          <button
            type="button"
            className="s-btn is-small"
            disabled={locked || !healthy || redeemUnits <= BigInt(0) || redeemUnits > (snap?.maxRedeem ?? BigInt(0))}
            onClick={() => void act("unwrap")}
          >
            Take setsUSDC instead
          </button>
        )}
        <p className="s-earn-form-note">
          {withdrawing
            ? "Redeem setsAUSD for AUSD, or convert it to setsUSDC to withdraw as USDC."
            : "Deposit AUSD. It earns setsUSDC's rate, held as setsAUSD."}
        </p>
        <details className="s-earn-transaction-details">
          <summary>Transaction details</summary>
          <dl className="s-earn-form-facts">
            <div>
              <dt>Setsuna fee</dt>
              <dd>2% of yield · none on deposits or withdrawals</dd>
            </div>
            <div>
              <dt>Slippage limit</dt>
              <dd>0.1%</dd>
            </div>
            <div>
              <dt>Peg guard</dt>
              <dd>Swaps below 99.8% revert</dd>
            </div>
            <div>
              <dt>Remaining deposit capacity</dt>
              <dd>{earnAmount(snap?.maxDeposit, A, 3)} AUSD</dd>
            </div>
          </dl>
          <p className="s-footnote">
            AUSD is swapped to USDC on Curve&apos;s AUSD/USDC/USDT0 stable pool and supplied to setsUSDC, under setsUSDC&apos;s 2,000 USDC cap. Deposits need an exact AUSD approval, then
            confirmation. Keep MON for gas. setsAUSD <code>{wrapper}</code> has no owner or admin and is verified on Sourcify. Setsuna&apos;s contracts are unaudited.
          </p>
        </details>
      </div>
    </section>
  );
}
