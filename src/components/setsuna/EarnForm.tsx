"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { erc4626Abi, formatUnits, type Address } from "viem";
import { clientFor, useWallet } from "./WalletProvider";
import { Mark } from "./Brand";

export type EarnAsset = "MON" | "USDC";
export type EarnMode = "deposit" | "withdraw";
export type EarnControls = {
  setAsset: (asset: EarnAsset) => void;
  mode: EarnMode;
  setMode: (mode: EarnMode) => void;
};

export const earnAmount = (
  value: bigint | undefined,
  decimals: number,
  digits = 5,
) =>
  value === undefined
    ? "—"
    : Number(formatUnits(value, decimals)).toLocaleString("en-US", {
        maximumFractionDigits: digits,
      });

export function EarnToken({
  asset,
  receipt = false,
}: {
  asset: EarnAsset;
  receipt?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={`s-earn-token is-${asset.toLowerCase()} ${receipt ? "is-receipt" : ""}`}
    >
      {receipt ? (
        <Mark size={24} />
      ) : asset === "USDC" ? (
        "$"
      ) : (
        <svg width="23" height="23" viewBox="0 0 24 24">
          <path
            fill="currentColor"
            fillRule="evenodd"
            d="M12 2C9 2 2 9 2 12s7 10 10 10 10-7 10-10S15 2 12 2Zm0 5c-1.4 0-5 3.6-5 5s3.6 5 5 5 5-3.6 5-5-3.6-5-5-5Z"
          />
        </svg>
      )}
    </span>
  );
}

function EarnAssetPicker({
  asset,
  receipt,
  disabled,
  onSelect,
}: {
  asset: EarnAsset;
  receipt: boolean;
  disabled: boolean;
  onSelect: (asset: EarnAsset) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(asset);
  const [above, setAbove] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const listId = useId();
  const expanded = open && !disabled;
  const options = ["MON", "USDC"] as const;

  useLayoutEffect(() => {
    if (!expanded) return;
    const place = () => {
      const anchor = root.current?.getBoundingClientRect();
      const height = menu.current?.offsetHeight;
      if (anchor && height) {
        const below = window.innerHeight - anchor.bottom - 12;
        setAbove(below < height + 8 && anchor.top > below);
      }
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [expanded]);

  useEffect(() => {
    setOpen(false);
  }, [asset, receipt, disabled]);

  function choose(next: EarnAsset) {
    if (disabled) return;
    setOpen(false);
    onSelect(next);
    // Selecting the other vault mounts its controller; keep keyboard focus on the picker.
    requestAnimationFrame(() =>
      document
        .getElementById("earn-asset-trigger")
        ?.focus({ preventScroll: true }),
    );
  }

  return (
    <div
      className="s-earn-picker"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        id="earn-asset-trigger"
        type="button"
        className="s-earn-picker-trigger"
        role="combobox"
        aria-label="Earn asset"
        aria-haspopup="listbox"
        aria-expanded={expanded}
        aria-controls={expanded ? listId : undefined}
        aria-activedescendant={expanded ? `${listId}-${active}` : undefined}
        disabled={disabled}
        onClick={() => {
          setActive(asset);
          setOpen(!expanded);
        }}
        onKeyDown={(event) => {
          if (event.key === "Tab") {
            setOpen(false);
            return;
          }
          if (event.key === "Escape") {
            if (expanded) {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
            }
            return;
          }
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            setActive(
              event.key === "Home"
                ? "MON"
                : event.key === "End"
                  ? "USDC"
                  : expanded
                    ? active === "MON"
                      ? "USDC"
                      : "MON"
                    : asset,
            );
            setOpen(true);
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (expanded) choose(active);
            else {
              setActive(asset);
              setOpen(true);
            }
          } else if (["m", "u", "s"].includes(event.key.toLowerCase())) {
            event.preventDefault();
            setActive(event.key.toLowerCase() === "u" ? "USDC" : "MON");
            setOpen(true);
          }
        }}
      >
        <EarnToken asset={asset} receipt={receipt} />
        <span>{receipt ? `sets${asset}` : asset}</span>
        <svg
          className="s-earn-picker-chevron"
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="m4 6 4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {expanded && (
        <div
          className="s-earn-picker-menu"
          ref={menu}
          data-side={above ? "top" : "bottom"}
        >
          <p className="s-earn-picker-heading">
            Select {receipt ? "receipt token" : "asset"}
          </p>
          <div id={listId} role="listbox" aria-label="Earn assets">
            {options.map((token) => (
              <div
                key={token}
                id={`${listId}-${token}`}
                role="option"
                aria-label={receipt ? `sets${token}` : token}
                aria-selected={asset === token}
                data-active={active === token}
                className="s-earn-picker-option"
                onPointerMove={() => setActive(token)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(token)}
              >
                <EarnToken asset={token} receipt={receipt} />
                <span className="s-earn-picker-copy">
                  <span>{receipt ? `sets${token}` : token}</span>
                  <small>
                    {receipt
                      ? `${token} vault shares`
                      : token === "MON"
                        ? "Monad"
                        : "USD Coin"}
                  </small>
                </span>
                {asset === token && (
                  <svg
                    className="s-earn-picker-check"
                    width="18"
                    height="18"
                    viewBox="0 0 20 20"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="m4.5 10 3.5 3.5 7.5-7.5"
                      stroke="currentColor"
                      strokeWidth="1.75"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

type Props = EarnControls & {
  asset: EarnAsset;
  vault?: Address;
  amount: string;
  setAmount: (value: string) => void;
  exitShares: string;
  setExitShares: (value: string) => void;
  depositAssets: bigint;
  redeemShares: bigint;
  walletBalance?: bigint;
  shares?: bigint;
  maxDeposit?: bigint;
  maxRedeem?: bigint;
  available?: bigint;
  shareValue?: bigint;
  blendedApr?: bigint;
  block?: bigint;
  healthy: boolean;
  busy: string;
  pending: boolean;
  canDeposit: boolean;
  canRedeem: boolean;
  onSubmit: (action: EarnMode) => void;
};

export default function EarnForm(p: Props) {
  const { asset, mode, setMode, setAsset } = p;
  const { deployment, address, openConnect } = useWallet();
  const decimals = asset === "MON" ? 18 : 6;
  const shareDecimals = decimals + 6;
  const withdrawing = mode === "withdraw";
  const inputSymbol = withdrawing ? `sets${asset}` : asset;
  const outputSymbol = withdrawing ? asset : `sets${asset}`;
  const input = withdrawing ? p.exitShares : p.amount;
  const setInput = withdrawing ? p.setExitShares : p.setAmount;
  const units = withdrawing ? p.redeemShares : p.depositAssets;
  const locked = !!p.busy || p.pending;
  const [quote, setQuote] = useState<{
    key: string;
    value?: bigint;
    failed?: boolean;
  }>();
  const quoteKey = `${deployment?.chainId}:${deployment?.rpc}:${p.vault}:${address}:${mode}:${units}:${p.block}:${p.healthy}`;
  const quoted = quote?.key === quoteKey ? quote : undefined;

  useEffect(() => {
    if (!deployment || !p.vault || !p.healthy || units <= BigInt(0)) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const value = await clientFor(deployment).readContract({
          address: p.vault!,
          abi: erc4626Abi,
          functionName: withdrawing ? "previewRedeem" : "previewDeposit",
          args: [units],
          blockNumber: p.block,
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
  }, [deployment, p.vault, p.healthy, p.block, units, withdrawing, quoteKey]);

  const gasReserve = asset === "MON" ? BigInt("100000000000000000") : BigInt(0);
  const spendable =
    (p.walletBalance ?? BigInt(0)) > gasReserve
      ? p.walletBalance! - gasReserve
      : BigInt(0);
  const maxDeposit =
    spendable < (p.maxDeposit ?? BigInt(0))
      ? spendable
      : (p.maxDeposit ?? BigInt(0));
  const maximum = withdrawing ? (p.maxRedeem ?? BigInt(0)) : maxDeposit;
  const validQuote =
    p.healthy && quoted?.value !== undefined && quoted.value > BigInt(0);
  const canSubmit = (withdrawing ? p.canRedeem : p.canDeposit) && validQuote;
  const reason = locked
    ? p.busy || "Check your submitted transaction before continuing."
    : !p.vault
      ? "This vault is not available in this environment."
      : !p.healthy
        ? "Waiting for a healthy vault reading."
        : units > BigInt(0) && withdrawing && units > (p.maxRedeem ?? BigInt(0))
          ? "This exceeds your currently withdrawable shares."
          : units > BigInt(0) && !withdrawing && address && units > spendable
            ? asset === "MON"
              ? "Insufficient MON. Leave 0.1 MON for gas."
              : "Insufficient USDC balance."
            : units > BigInt(0) &&
                !withdrawing &&
                units > (p.maxDeposit ?? BigInt(0))
              ? "This exceeds the vault’s remaining deposit capacity."
              : quoted?.failed
                ? "Could not load an onchain quote. Try changing the amount."
                : input && units === BigInt(0)
                  ? "Enter a valid amount greater than zero."
                  : units > BigInt(0) && quoted?.value === BigInt(0)
                    ? "This amount is too small."
                    : "";

  function changeMode(next: EarnMode) {
    if (locked || next === mode) return;
    p.setAmount("");
    p.setExitShares("");
    setMode(next);
  }

  return (
    <section className="s-card s-earn-form" aria-label="Earn transaction">
      <div className="s-earn-mode" role="group" aria-label="Earn action">
        {(["deposit", "withdraw"] as const).map((action) => (
          <button
            key={action}
            type="button"
            disabled={locked}
            aria-pressed={mode === action}
            onClick={() => changeMode(action)}
          >
            {action === "deposit" ? "Deposit" : "Withdraw"}
          </button>
        ))}
      </div>
      <div className="s-earn-form-body">
        <div className="s-earn-amount-panel">
          <div className="s-earn-panel-label">
            <label htmlFor="earn-amount">
              {withdrawing ? "You redeem" : "You deposit"}
            </label>
            <button
              type="button"
              className="s-earn-max"
              disabled={
                !address || !p.healthy || locked || maximum <= BigInt(0)
              }
              onClick={() =>
                setInput(
                  formatUnits(maximum, withdrawing ? shareDecimals : decimals),
                )
              }
            >
              Max
            </button>
          </div>
          <div className="s-earn-amount-row">
            <input
              id="earn-amount"
              aria-label={
                withdrawing
                  ? `sets${asset} shares to withdraw`
                  : `Amount of ${asset}`
              }
              placeholder="0.00"
              inputMode="decimal"
              autoComplete="off"
              value={input}
              disabled={locked}
              onChange={(e) => setInput(e.target.value)}
            />
            <EarnAssetPicker
              asset={asset}
              receipt={withdrawing}
              disabled={locked || !deployment}
              onSelect={setAsset}
            />
          </div>
          <p className="s-earn-balance">
            {address
              ? `Balance: ${earnAmount(withdrawing ? p.shares : p.walletBalance, withdrawing ? shareDecimals : decimals)} ${inputSymbol}`
              : "Connect to see your balance"}
          </p>
        </div>
        <div className="s-earn-direction">
          <button
            type="button"
            disabled={locked}
            aria-label={
              withdrawing ? "Switch to deposit" : "Switch to withdraw"
            }
            onClick={() => changeMode(withdrawing ? "deposit" : "withdraw")}
          >
            ↓
          </button>
        </div>
        <div className="s-earn-amount-panel is-output">
          <span className="s-earn-panel-label">You receive · estimated</span>
          <div className="s-earn-amount-row">
            <output aria-label="Estimated amount received" aria-live="polite">
              {units === BigInt(0)
                ? "0.00"
                : quoted?.failed || !p.healthy
                  ? "—"
                  : quoted?.value === undefined
                    ? "…"
                    : earnAmount(
                        quoted.value,
                        withdrawing ? decimals : shareDecimals,
                        6,
                      )}
            </output>
            <span className="s-earn-receipt-token">
              <EarnToken asset={asset} receipt={!withdrawing} />
              {outputSymbol}
            </span>
          </div>
          <p className="s-earn-balance">
            {withdrawing
              ? "Returned to your connected wallet"
              : "Your share of the vault, including interest or losses"}
          </p>
        </div>
        <dl className="s-earn-form-facts">
          <div>
            <dt>Current base rate</dt>
            <dd>
              {p.blendedApr === undefined
                ? "—"
                : `${(Number(formatUnits(p.blendedApr, 18)) * 100).toFixed(2)}% APR`}
            </dd>
          </div>
          <div>
            <dt>Exchange rate</dt>
            <dd>
              1 sets{asset} ≈ {earnAmount(p.shareValue, decimals, 8)} {asset}
            </dd>
          </div>
        </dl>
        {reason && (
          <p className="s-earn-form-hint" role="status">
            {reason}
          </p>
        )}
        <button
          type="button"
          className="s-btn is-primary is-wide"
          disabled={!!address && !canSubmit}
          onClick={() => (address ? p.onSubmit(mode) : openConnect())}
        >
          {!address
            ? "Connect account"
            : p.busy || `${withdrawing ? "Withdraw" : "Deposit"} ${asset}`}
        </button>
        <p className="s-earn-form-note">
          {withdrawing
            ? `Redeem sets${asset} for ${asset}, subject to available liquidity.`
            : `Deposit ${asset}. Receive sets${asset}. The vault handles allocation.`}
        </p>
        <details className="s-earn-transaction-details">
          <summary>Transaction details</summary>
          <dl className="s-earn-form-facts">
            <div>
              <dt>Setsuna fee</dt>
              <dd>None</dd>
            </div>
            <div>
              <dt>Slippage limit</dt>
              <dd>0.1%</dd>
            </div>
            <div>
              <dt>
                {withdrawing
                  ? "Available to withdraw"
                  : "Remaining deposit capacity"}
              </dt>
              <dd>
                {earnAmount(
                  withdrawing ? p.available : p.maxDeposit,
                  decimals,
                  3,
                )}{" "}
                {asset}
              </dd>
            </div>
          </dl>
          <p className="s-footnote">
            {asset === "MON"
              ? "MON is wrapped internally as WMON. Keep 0.1 MON for gas. Withdrawals require a share approval, then confirmation."
              : "Deposits require approval of the exact USDC amount, then confirmation. Keep MON for gas."}{" "}
            Rates vary and exclude external reward tokens. The quote refreshes
            before signing.
          </p>
        </details>
      </div>
    </section>
  );
}
