"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { erc4626Abi, formatUnits, type Address } from "viem";
import { clientFor, useWallet } from "./WalletProvider";
import { Mark } from "./Brand";
import TokenIcon from "./TokenIcon";
import { smartAccountHint, useMonReserve } from "./useMonReserve";

export type EarnAsset = "MON" | "USDC";
/** What the token picker offers: the two vaults, plus AUSD, saved in setsUSDC through setsAUSD. */
export type PickerAsset = EarnAsset | "AUSD";
export type EarnMode = "deposit" | "withdraw";
export type EarnControls = {
  setAsset: (asset: PickerAsset) => void;
  mode: EarnMode;
  setMode: (mode: EarnMode) => void;
};

export const earnAmount = (
  value: bigint | undefined,
  decimals: number,
  digits = 5,
) => {
  if (value === undefined) return "—";
  const number = Number(formatUnits(value, decimals));
  if (number !== 0 && Math.abs(number) < 10 ** -digits)
    return `${number < 0 ? "−" : ""}<${(10 ** -digits).toFixed(digits)}`;
  return number.toLocaleString("en-US", { maximumFractionDigits: digits });
};

export function EarnToken({
  asset,
  receipt = false,
}: {
  asset: PickerAsset;
  receipt?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={`s-earn-token is-${asset.toLowerCase()} ${receipt ? "is-receipt" : ""}`}
    >
      {receipt ? (
        <>
          <Mark size={24} />
          <span className="e-underlying-badge">
            <TokenIcon asset={asset} size={12} />
          </span>
        </>
      ) : (
        <TokenIcon asset={asset} size={asset === "MON" ? 22 : 30} />
      )}
    </span>
  );
}

export function EarnAssetPicker({
  asset,
  receipt,
  disabled,
  onSelect,
}: {
  asset: PickerAsset;
  receipt: boolean;
  disabled: boolean;
  onSelect: (asset: PickerAsset) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<PickerAsset>(asset);
  const [above, setAbove] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const listId = useId();
  const expanded = open && !disabled;
  const options = ["MON", "USDC", "AUSD"] as const;

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

  function choose(next: PickerAsset) {
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
            const at = options.indexOf(active);
            setActive(
              event.key === "Home"
                ? options[0]
                : event.key === "End"
                  ? options[options.length - 1]
                  : expanded
                    ? options[
                        (at + (event.key === "ArrowUp" ? options.length - 1 : 1)) %
                          options.length
                      ]
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
          } else if (["m", "u", "a", "s"].includes(event.key.toLowerCase())) {
            event.preventDefault();
            const k = event.key.toLowerCase();
            setActive(k === "u" ? "USDC" : k === "a" ? "AUSD" : "MON");
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
                      ? token === "AUSD"
                        ? "AUSD saved in setsUSDC"
                        : `${token} vault shares`
                      : token === "MON"
                        ? "Monad"
                        : token === "USDC"
                          ? "USD Coin"
                          : "Agora Dollar"}
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
  /** Assets still in the retired vault, withdrawn first on any withdrawal. */
  earlier?: bigint;
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

  const { delegated, reserve: smartReserve } = useMonReserve();
  const gasReserve = asset === "MON" ? BigInt("100000000000000000") + smartReserve : BigInt(0);
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
  const earlier = withdrawing ? (p.earlier ?? BigInt(0)) : BigInt(0);
  const canSubmit = withdrawing
    ? p.canRedeem && (units === BigInt(0) ? earlier > BigInt(0) : validQuote)
    : p.canDeposit && validQuote;
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
              ? delegated
                ? `You can deposit up to ${Number(formatUnits(spendable, 18)).toLocaleString("en-US", { maximumFractionDigits: 4 })} MON. ${smartAccountHint}`
                : "Insufficient MON. Leave 0.1 MON for gas."
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
            <span className="s-earn-balance-inline">
              Balance{" "}
              {address
                ? `${earnAmount(withdrawing ? p.shares : p.walletBalance, withdrawing ? shareDecimals : decimals)} ${inputSymbol}`
                : "—"}
            </span>
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
          <div
            className="s-earn-percentages"
            role="group"
            aria-label="Amount shortcuts"
          >
            {[25, 50, 75, 100].map((percent) => (
              <button
                key={percent}
                type="button"
                className={percent === 100 ? "s-earn-max" : undefined}
                disabled={
                  !address || !p.healthy || locked || maximum <= BigInt(0)
                }
                onClick={() =>
                  setInput(
                    formatUnits(
                      (maximum * BigInt(percent)) / BigInt(100),
                      withdrawing ? shareDecimals : decimals,
                    ),
                  )
                }
              >
                {percent === 100 ? "Max" : `${percent}%`}
              </button>
            ))}
          </div>
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
                ? earlier > BigInt(0)
                  ? earnAmount(earlier, decimals, 6)
                  : "0.00"
                : quoted?.failed || !p.healthy
                  ? "—"
                  : quoted?.value === undefined
                    ? "…"
                    : earnAmount(
                        quoted.value + earlier,
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
            {earlier > BigInt(0)
              ? `Includes ${earnAmount(earlier, decimals, 4)} ${asset} from your earlier deposit, withdrawn first`
              : withdrawing
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
              <dd>2% of yield · none on deposits or withdrawals</dd>
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
