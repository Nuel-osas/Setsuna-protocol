"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  parseUnits,
  type Hex,
} from "viem";
import {
  monGatewayAbi,
  monVaultAbi,
  readMON,
  type MONSnapshot,
} from "@/lib/setsuna/mon";
import { clientFor, useWallet } from "./WalletProvider";
import EarnForm, { EarnToken, type EarnControls } from "./EarnForm";
import { message, shortAddress } from "@/lib/setsuna/format";
import DemoFunding from "./DemoFunding";
import EarnDecision from "./EarnDecision";
import { earnDecision } from "@/lib/setsuna/earn-decision";

const amountLabel = (value: bigint | undefined, decimals = 18, digits = 5) =>
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

export default function MONEarn(controls: EarnControls) {
  const wallet = useWallet();
  const { deployment: d, address } = wallet;
  const m = d?.earnMON;
  const [snapshot, setSnapshot] = useState<MONSnapshot>();
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
      ? `setsuna.mon.pending.${d.chainId}.${m.vault}.${address}`
      : undefined;
  const refresh = useCallback(async () => {
    if (!d?.earnMON) return;
    const current = generation.current;
    const read = ++readSequence.current;
    try {
      const next = await readMON(d, address);
      if (generation.current !== current || read !== readSequence.current)
        return;
      setSnapshot(next);
      setReadError("");
    } catch {
      if (generation.current === current && read === readSequence.current) {
        setSnapshot(undefined);
        setReadError(
          "Could not read the setsMON vault. Transactions are disabled until the fork is available.",
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

  const depositAssets = parseAmount(amount, 18);
  const redeemShares = parseAmount(exitShares, 24);
  const ready = !!snapshot?.healthy && !readError && !busy && !pending;
  const gasReserve = parseUnits("0.1", 18);
  const canDeposit =
    ready &&
    depositAssets > BigInt(0) &&
    !!snapshot &&
    depositAssets <= snapshot.maxDeposit &&
    snapshot.walletBalance !== undefined &&
    depositAssets + gasReserve <= snapshot.walletBalance;
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
    setBusy(
      action === "withdraw" ? "Approving shares…" : "Confirm transaction…",
    );
    setError("");
    setNotice("");
    try {
      const c = clientFor(d);
      let block = await c.getBlock();
      if (action === "deposit") {
        const quote = await c.readContract({
          address: m.vault,
          abi: monVaultAbi,
          functionName: "previewDeposit",
          args: [depositAssets],
        });
        if (quote === BigInt(0))
          throw new Error("Deposit is too small to mint shares.");
        unchanged();
        await wallet.send(
          m.gateway,
          encodeFunctionData({
            abi: monGatewayAbi,
            functionName: "depositMON",
            args: [
              address,
              quote - quote / BigInt(1000),
              block.timestamp + BigInt(600),
            ],
          }),
          track,
          depositAssets,
        );
        track();
        setNotice(
          "Deposit confirmed. Your MON is represented by setsMON shares.",
        );
      } else if (action === "withdraw") {
        // Only the selected shares are approved. The gateway always redeems for msg.sender.
        unchanged();
        await wallet.send(
          m.vault,
          encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [m.gateway, redeemShares],
          }),
          track,
        );
        track();
        unchanged();
        setBusy("Confirm MON withdrawal…");
        block = await c.getBlock();
        const quote = await c.readContract({
          address: m.vault,
          abi: monVaultAbi,
          functionName: "previewRedeem",
          args: [redeemShares],
        });
        if (quote === BigInt(0))
          throw new Error("Select more shares to withdraw.");
        unchanged();
        await wallet.send(
          m.gateway,
          encodeFunctionData({
            abi: monGatewayAbi,
            functionName: "redeemMON",
            args: [
              redeemShares,
              address,
              quote - quote / BigInt(1000),
              block.timestamp + BigInt(600),
            ],
          }),
          track,
        );
        track();
        setExitShares("");
        setNotice(
          "Withdrawal confirmed. Native MON has returned to your wallet.",
        );
      } else {
        unchanged();
        await wallet.send(
          m.vault,
          encodeFunctionData({ abi: monVaultAbi, functionName: action }),
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
          : "setsMON is implemented and tested on a mainnet fork. Public deposits are not open."}
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
          asset="MON"
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
                <h2>Your setsMON</h2>
              </div>
              <EarnToken asset="MON" receipt />
            </header>
            <p className="s-lede">
              Your MON earns through Neverland and Euler. Hold setsMON while the
              vault allocates within its public onchain rules.
            </p>
            <div className="s-money-row is-2">
              <div className="s-money">
                <span>Shares</span>
                <strong data-testid="mon-shares">
                  {address ? amountLabel(snapshot?.shares, 24) : "—"}
                  <small>setsMON</small>
                </strong>
              </div>
              <div className="s-money">
                <span>Worth</span>
                <strong data-testid="mon-worth">
                  {address ? amountLabel(snapshot?.worth) : "—"}
                  <small>MON</small>
                </strong>
              </div>
            </div>
            <dl className="s-facts">
              <div>
                <dt>Total in vault</dt>
                <dd>{amountLabel(snapshot?.nav, 18, 2)} MON</dd>
              </div>
              <div>
                <dt>Available to withdraw</dt>
                <dd>{address ? amountLabel(snapshot?.available) : "—"} MON</dd>
              </div>
              <div>
                <dt>Lending protocols</dt>
                <dd>2</dd>
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
            <h2>Where your MON works</h2>
          </div>
          <span>{amountLabel(snapshot?.nav, 18, 2)} MON in the vault</span>
        </header>
        <div className="s-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Destination</th>
                <th>MON supplied</th>
                <th>Allocation</th>
                <th>Base rate</th>
              </tr>
            </thead>
            <tbody>
              {[
                "Neverland · WMON",
                "Euler · WMON / shMON market",
                "Cash buffer · WMON",
              ].map((label, i) => {
                const position =
                  i === 2 ? snapshot?.idle : snapshot?.positions[i];
                const weight =
                  position !== undefined && snapshot?.nav
                    ? `${((Number(position) / Number(snapshot.nav)) * 100).toFixed(2)}%`
                    : "—";
                return (
                  <tr key={label}>
                    <th>{label}</th>
                    <td>{amountLabel(position, 18, 3)}</td>
                    <td>{weight}</td>
                    <td>{i === 2 ? "0%" : aprLabel(snapshot?.rates[i])}</td>
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
          and governance risk; MON’s market price also varies.
        </p>
        {m && (
          <EarnDecision
            snapshot={snapshot}
            asset="MON"
            destinations={["Neverland · WMON", "Euler · WMON / shMON market"]}
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
