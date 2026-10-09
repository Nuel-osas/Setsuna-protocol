"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  parseUnits,
  type Hex,
} from "viem";
import { usdcVaultAbi, readUSDC, type USDCSnapshot } from "@/lib/setsuna/usdc";
import { clientFor, useWallet } from "./WalletProvider";
import EarnForm, { EarnToken, type EarnControls } from "./EarnForm";
import { message, shortAddress } from "@/lib/setsuna/format";
import DemoFunding from "./DemoFunding";
import EarnDecision from "./EarnDecision";
import { earnDecision } from "@/lib/setsuna/earn-decision";

const amountLabel = (value: bigint | undefined, decimals = 6, digits = 5) =>
  value === undefined
    ? "—"
    : Number(formatUnits(value, decimals)).toLocaleString("en-US", {
        maximumFractionDigits: digits,
      });
const aprLabel = (value: bigint | undefined) =>
  value === undefined
    ? "—"
    : `${(Number(formatUnits(value, 18)) * 100).toFixed(2)}% APR`;
const parseAmount = (value: string, decimals: number) => {
  if (!new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`).test(value))
    return BigInt(0);
  try {
    return parseUnits(value, decimals);
  } catch {
    return BigInt(0);
  }
};

export default function USDCEarn(controls: EarnControls) {
  const wallet = useWallet();
  const { deployment: d, address } = wallet;
  const m = d?.earnUSDC;
  const withCurvance = m?.adapters.length === 5;
  const destinations = [
    "Aave · USDC reserve",
    "Morpho · aHYPER / USDC",
    "Euler · eUSDC-12",
    "Neverland · USDC reserve",
    ...(withCurvance ? ["Curvance · wsrUSD / USDC"] : []),
  ];
  const [snapshot, setSnapshot] = useState<USDCSnapshot>();
  const [readError, setReadError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [amount, setAmount] = useState("");
  const [exitShares, setExitShares] = useState("");
  const [busy, setBusy] = useState("");
  const [pending, setPending] = useState<Hex>();
  const generation = useRef(0);
  const readSequence = useRef(0);
  const actionInFlight = useRef(false);
  const pendingKey =
    d && m && address
      ? `setsuna.usdc.pending.${d.chainId}.${m.vault}.${address}`
      : undefined;
  const refresh = useCallback(async () => {
    if (!d?.earnUSDC) return;
    const current = generation.current;
    const read = ++readSequence.current;
    try {
      const next = await readUSDC(d, address);
      if (generation.current !== current || read !== readSequence.current)
        return;
      setSnapshot(next);
      setReadError("");
    } catch {
      if (generation.current === current && read === readSequence.current) {
        setSnapshot(undefined);
        setReadError(
          "Could not read the setsUSDC vault. Transactions are disabled until the fork is available.",
        );
      }
    }
  }, [d, address]);
  useEffect(() => {
    generation.current++;
    setSnapshot(undefined);
    setError("");
    setNotice("");
    setPending(undefined);
    if (pendingKey) {
      try {
        const hash = localStorage.getItem(pendingKey);
        if (hash && /^0x[0-9a-fA-F]{64}$/.test(hash)) setPending(hash as Hex);
      } catch {
        /* Private browser storage may be unavailable. */
      }
    }
    void refresh();
    const timer = setInterval(() => {
      if (!actionInFlight.current) void refresh();
    }, 15_000);
    return () => {
      generation.current++;
      clearInterval(timer);
    };
  }, [refresh, pendingKey]);

  function track(hash?: Hex) {
    setPending(hash);
    if (pendingKey) {
      try {
        if (hash) localStorage.setItem(pendingKey, hash);
        else localStorage.removeItem(pendingKey);
      } catch {
        /* Optional persistence. */
      }
    }
  }

  const depositAssets = parseAmount(amount, 6);
  const redeemShares = parseAmount(exitShares, 12);
  const ready = !!snapshot?.healthy && !readError && !busy && !pending;
  const canDeposit =
    ready &&
    depositAssets > BigInt(0) &&
    !!snapshot &&
    depositAssets <= snapshot.maxDeposit &&
    snapshot.walletBalance !== undefined &&
    depositAssets <= snapshot.walletBalance;
  const canRedeem =
    ready &&
    redeemShares > BigInt(0) &&
    !!snapshot &&
    redeemShares <= snapshot.maxRedeem;

  async function act(
    action: "deposit" | "withdraw" | "observeRates" | "rebalance",
  ) {
    if (!d || !m || !address || !ready) return;
    actionInFlight.current = true;
    const current = generation.current;
    const unchanged = () => {
      if (generation.current !== current)
        throw new Error(
          "Account changed. Review the transaction before continuing.",
        );
    };
    setBusy(action === "deposit" ? "Approve USDC…" : "Confirm transaction…");
    setError("");
    setNotice("");
    try {
      const c = clientFor(d);
      let block = await c.getBlock();
      if (action === "deposit") {
        unchanged();
        await wallet.send(
          m.asset,
          encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [m.vault, depositAssets],
          }),
          track,
        );
        track();
        unchanged();
        setBusy("Confirm USDC deposit…");
        block = await c.getBlock();
        const quote = await c.readContract({
          address: m.vault,
          abi: usdcVaultAbi,
          functionName: "previewDeposit",
          args: [depositAssets],
        });
        if (quote === BigInt(0))
          throw new Error("Deposit is too small to mint shares.");
        unchanged();
        await wallet.send(
          m.vault,
          encodeFunctionData({
            abi: usdcVaultAbi,
            functionName: "depositWithMinShares",
            args: [
              depositAssets,
              address,
              quote - quote / BigInt(1000),
              block.timestamp + BigInt(600),
            ],
          }),
          track,
        );
        track();
        setNotice(
          "Deposit confirmed. Your USDC is represented by setsUSDC shares.",
        );
      } else if (action === "withdraw") {
        const available = await c.readContract({
          address: m.vault,
          abi: usdcVaultAbi,
          functionName: "maxRedeem",
          args: [address],
        });
        if (redeemShares > available)
          throw new Error(
            "Your available shares changed. Select Max again.",
          );
        const quote = await c.readContract({
          address: m.vault,
          abi: usdcVaultAbi,
          functionName: "previewRedeem",
          args: [redeemShares],
        });
        if (quote === BigInt(0))
          throw new Error("Select more shares to withdraw.");
        unchanged();
        await wallet.send(
          m.vault,
          encodeFunctionData({
            abi: usdcVaultAbi,
            functionName: "redeemWithMinAssets",
            args: [
              redeemShares,
              address,
              address,
              quote - quote / BigInt(1000),
              block.timestamp + BigInt(600),
            ],
          }),
          track,
        );
        track();
        setExitShares("");
        setNotice("Withdrawal confirmed. USDC has returned to your wallet.");
      } else {
        unchanged();
        await wallet.send(
          m.vault,
          encodeFunctionData({ abi: usdcVaultAbi, functionName: action }),
          track,
        );
        track();
        setNotice(
          action === "rebalance"
            ? "Rebalance confirmed under the vault’s fixed rules."
            : "Protocol rates recorded onchain.",
        );
      }
      await refresh();
    } catch (e) {
      setError(message(e));
      await refresh();
    } finally {
      actionInFlight.current = false;
      setBusy("");
    }
  }

  async function checkPending() {
    if (!pending || !d) return;
    actionInFlight.current = true;
    setBusy("Checking receipt…");
    try {
      const receipt = await clientFor(d).getTransactionReceipt({
        hash: pending,
      });
      track();
      setError("");
      setNotice(
        receipt.status === "success"
          ? "Transaction confirmed. Your position is refreshed; review it before continuing."
          : "Transaction reverted. No transfer from that transaction was committed.",
      );
      await refresh();
    } catch {
      setError(
        "Confirmation is still unknown. Keep this hash and check again before submitting another transaction.",
      );
    } finally {
      actionInFlight.current = false;
      setBusy("");
    }
  }

  return (
    <main id="main" className="s-app s-unified-earn">
      <div className="s-app-top">
        <div>
          <span className="s-eyebrow">Earn on Monad</span>
          <h1>
            Put your assets <em>to work.</em>
          </h1>
        </div>
        <span className={`s-net ${m ? "is-local" : ""}`}>
          <i />
          {m ? `${d?.name} · demo` : "Preview"}
        </span>
      </div>
      <p className="s-lede">
        One deposit. Automated allocation. Choose your asset to get started.
      </p>
      <p className="s-footnote">
        {m
          ? `Synthetic funds on a private fork of Monad block ${Number(m.forkBlock).toLocaleString()}. All balances, rates and transactions below use that same fork.`
          : "setsUSDC is implemented and tested on a mainnet fork. Public deposits are not open."}
      </p>
      {readError && (
        <p className="s-error" role="alert">
          {readError}
        </p>
      )}
      {error && (
        <p className="s-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="s-mon-notice">
          {notice}
        </p>
      )}
      {pending && (
        <div className="s-mon-pending">
          <p>
            Submitted transaction: <code>{pending}</code>
          </p>
          <button
            className="s-btn is-small"
            disabled={!!busy}
            onClick={() => void checkPending()}
          >
            Check transaction
          </button>
        </div>
      )}
      <div className="s-earn-workspace">
        <EarnForm
          {...controls}
          asset="USDC"
          vault={m?.vault}
          amount={amount}
          setAmount={setAmount}
          exitShares={exitShares}
          setExitShares={setExitShares}
          depositAssets={depositAssets}
          redeemShares={redeemShares}
          walletBalance={snapshot?.walletBalance}
          shares={snapshot?.shares}
          maxDeposit={snapshot?.maxDeposit}
          maxRedeem={snapshot?.maxRedeem}
          available={snapshot?.available}
          shareValue={snapshot?.shareValue}
          blendedApr={snapshot?.blendedApr}
          block={snapshot?.block}
          healthy={!!snapshot?.healthy && !readError}
          busy={busy}
          pending={!!pending}
          canDeposit={canDeposit}
          canRedeem={canRedeem}
          onSubmit={(action) => void act(action)}
        />
        <div className="s-earn-overview">
          <section className="s-card s-position">
            <header className="s-card-head">
              <div>
                <span className="s-eyebrow">Your position</span>
                <h2>Your setsUSDC</h2>
              </div>
              <EarnToken asset="USDC" receipt />
            </header>
            <p className="s-lede">
              Your USDC earns through Aave, Morpho, Euler and Neverland
              {withCurvance ? ", plus Curvance" : ""}. Hold setsUSDC while the
              vault manages allocation.
            </p>
            <div className="s-money-row is-2">
              <div className="s-money">
                <span>Shares</span>
                <strong data-testid="usdc-shares">
                  {address ? amountLabel(snapshot?.shares, 12) : "—"}
                  <small>setsUSDC</small>
                </strong>
              </div>
              <div className="s-money">
                <span>Worth</span>
                <strong data-testid="usdc-worth">
                  {address ? amountLabel(snapshot?.worth) : "—"}
                  <small>USDC</small>
                </strong>
              </div>
            </div>
            <dl className="s-facts">
              <div>
                <dt>Total in vault</dt>
                <dd>{amountLabel(snapshot?.nav, 6, 2)} USDC</dd>
              </div>
              <div>
                <dt>Available to withdraw</dt>
                <dd>{address ? amountLabel(snapshot?.available) : "—"} USDC</dd>
              </div>
              <div>
                <dt>Lending protocols</dt>
                <dd>{destinations.length}</dd>
              </div>
            </dl>
            <p className="s-footnote">
              Share value includes earned interest and any losses. Withdrawals
              use cash and available lending-market liquidity.
            </p>
            {address && (
              <p className="s-footnote">
                Connected as {shortAddress(address)}.
              </p>
            )}
          </section>
          <DemoFunding onFunded={refresh} disabled={!!busy || !!pending} />
        </div>
      </div>
      <section className="s-card s-rates-card">
        <header className="s-card-head">
          <div>
            <span className="s-eyebrow">Onchain allocation</span>
            <h2>Where your USDC works</h2>
          </div>
          <span>{amountLabel(snapshot?.nav, 6, 2)} USDC in the vault</span>
        </header>
        <div className="s-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Destination</th>
                <th>USDC supplied</th>
                <th>Allocation</th>
                <th>Base rate</th>
                <th>Withdrawable position</th>
                <th>Market cash</th>
                <th>Allocation status</th>
              </tr>
            </thead>
            <tbody>
              {[...destinations, "Cash buffer · USDC"].map((label, i) => {
                const isCash = i === destinations.length;
                const position = isCash
                  ? snapshot?.idle
                  : snapshot?.positions[i];
                const weight =
                  position !== undefined && snapshot?.nav
                    ? `${((Number(position) / Number(snapshot.nav)) * 100).toFixed(2)}%`
                    : "—";
                return (
                  <tr key={label}>
                    <th>{label}</th>
                    <td>{amountLabel(position, 6, 3)}</td>
                    <td>{weight}</td>
                    <td>{isCash ? "0%" : aprLabel(snapshot?.rates[i])}</td>
                    <td>
                      {amountLabel(
                        isCash
                          ? snapshot?.idle
                          : snapshot?.liquidity[i].available,
                        6,
                        2,
                      )}{" "}
                      USDC
                    </td>
                    <td>
                      {isCash
                        ? "—"
                        : `${amountLabel(snapshot?.liquidity[i].marketCash, 6, 0)} USDC`}
                    </td>
                    <td>
                      {isCash
                        ? "Available cash"
                        : (snapshot?.liquidity[i].reason ?? "Loading")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="s-footnote">
          Target cash buffer ≥10% · venue exposure ≤60% · gross movement ≤10%
          per rebalance · 10-minute cooldown. Withdrawals and accrued interest
          can temporarily reduce the buffer percentage. A keeper restores it as
          liquidity allows. Lending carries smart-contract, borrower, collateral
          and governance risk. Morpho’s aHYPER collateral is a managed Hyperithm
          strategy. Allocation is also capped at 10% of each destination’s
          available market cash.
          {withCurvance &&
            " Curvance borrowers post wsrUSD collateral, adding exposure to that stablecoin strategy. Curvance’s displayed rate is a conservative model estimate; settled interest is reflected in share value."}
        </p>
        {m && (
          <EarnDecision
            snapshot={snapshot}
            asset="USDC"
            destinations={destinations}
          />
        )}
        {m && (
          <details className="s-mon-details">
            <summary>Vault activity and public controls</summary>
            <p className="s-footnote">
              Vault <code>{m.vault}</code>
              <br />
              Read at block {snapshot?.block.toString() ?? "—"}. Anyone may
              trigger the fixed rules. The configured demo executor checks
              periodically.
            </p>
            <div className="s-mon-actions">
              <button
                className="s-btn is-small"
                disabled={
                  !address ||
                  !ready ||
                  !snapshot ||
                  snapshot.timestamp <
                    snapshot.observations[1].timestamp + BigInt(300)
                }
                onClick={() => void act("observeRates")}
              >
                Record protocol rates
              </button>
              <button
                className="s-btn is-small"
                disabled={
                  !address || !ready || !earnDecision(snapshot).canRebalance
                }
                onClick={() => void act("rebalance")}
              >
                Rebalance vault
              </button>
            </div>
            <p className="s-footnote">
              Transactions are simulated before signing. A rebalance also needs
              fresh observations and an eligible move that improves projected
              income or repairs a breached limit.
            </p>
            {snapshot?.historyUnavailable ? (
              <p>Activity could not be loaded.</p>
            ) : (
              <ol className="s-mon-history">
                {snapshot?.events.map((e) => (
                  <li key={`${e.transactionHash}-${e.logIndex}`}>
                    <strong>{e.eventName}</strong> · block{" "}
                    {e.blockNumber?.toString()}
                    {d?.explorer ? (
                      <a
                        href={`${d.explorer}/tx/${e.transactionHash}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <code>{e.transactionHash}</code>
                      </a>
                    ) : (
                      <code>{e.transactionHash}</code>
                    )}
                  </li>
                ))}
              </ol>
            )}
            <p className="s-footnote">
              Latest 10 vault events from the last 2,000 blocks. Fork hashes are
              on the demo fork and are not mainnet transactions.
            </p>
          </details>
        )}
      </section>
    </main>
  );
}
