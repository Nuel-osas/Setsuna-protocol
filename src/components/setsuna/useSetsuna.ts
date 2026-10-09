"use client";
/**
 * All Setsuna account state and transaction flows.
 *
 * The safety behaviour here is carried over unchanged from Codex's original
 * Dashboard: every write goes through a review step, is re-checked against the
 * connected owner, simulated by WalletProvider.send before signing, and an
 * unknown confirmation blocks further writes until reconciled.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  encodeFunctionData,
  decodeEventLog,
  erc20Abi,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { useWallet, clientFor } from "./WalletProvider";
import {
  accountAbi,
  factoryAbi,
  readSnapshot,
  statuses,
} from "@/lib/setsuna/contracts";
import { tradeOutcome, tradeDescription } from "@/lib/setsuna/trading-receipt";
import { amount, ausd, message, shortAddress } from "@/lib/setsuna/format";
import type { Snapshot } from "@/lib/setsuna/types";

export type Review = {
  title: string;
  description: string;
  rows: [string, string][];
  run: () => Promise<string>;
  owner: Address;
};

export type ArmInput = {
  cap: string;
  triggerBps: number;
  targetBps: number;
  minTopUp: string;
  feePct: string;
  feeMax: string;
  markAge: string;
};

export function useSetsuna() {
  const wallet = useWallet();
  const { deployment: d, address } = wallet;
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [readError, setReadError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [review, setReview] = useState<Review>();
  const [busy, setBusy] = useState(false);
  const [hash, setHash] = useState<Hex>();
  const [unknownHash, setUnknownHash] = useState<Hex>();
  const epoch = useRef(0);
  const inFlight = useRef<Promise<void> | undefined>(undefined);
  const latestOwner = useRef(address);
  latestOwner.current = address;
  const pendingKey =
    d?.factory && address
      ? `setsuna.perps.pending.${d.chainId}.${d.factory}.${address}`
      : undefined;

  function rememberPending(value?: Hex) {
    if (!pendingKey) return;
    try {
      if (value) localStorage.setItem(pendingKey, value);
      else localStorage.removeItem(pendingKey);
    } catch {
      /* optional persistence */
    }
  }

  const refresh = useCallback(async () => {
    if (!d || !address) return;
    const current = epoch.current;
    // A transaction refresh must not be dropped behind an older polling read.
    while (inFlight.current) await inFlight.current;
    if (current !== epoch.current) return;
    const task = (async () => {
      setLoading(true);
      try {
        const state = await readSnapshot(d, address);
        if (current === epoch.current) {
          setSnapshot(state);
          setReadError("");
        }
      } catch (e) {
        if (current === epoch.current) {
          setReadError(message(e));
          setSnapshot(undefined);
        }
      } finally {
        inFlight.current = undefined;
        if (current === epoch.current) setLoading(false);
      }
    })();
    inFlight.current = task;
    await task;
  }, [d, address]);

  useEffect(() => {
    epoch.current++;
    setSnapshot(undefined);
    setReadError("");
    setNotice("");
    setReview(undefined);
    setError("");
    setUnknownHash(undefined);
    if (pendingKey) {
      try {
        const pending = localStorage.getItem(pendingKey);
        if (pending && /^0x[0-9a-fA-F]{64}$/.test(pending))
          setUnknownHash(pending as Hex);
      } catch {
        /* optional persistence */
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 8000);
    return () => {
      epoch.current++;
      clearInterval(timer);
    };
  }, [refresh, pendingKey]);

  const account = snapshot?.account;
  const policy = snapshot?.policy;
  const quote = snapshot?.quote;
  const position = snapshot?.position;
  const market = snapshot?.market;
  const hasPosition = !!position && position.lotLNS > BigInt(0);
  const ready = !!(
    d?.factory &&
    address &&
    snapshot &&
    !readError &&
    !busy &&
    !unknownHash
  );

  function ask(
    title: string,
    description: string,
    rows: [string, string][],
    run: () => Promise<string>,
  ) {
    if (!address || !ready) return;
    setError("");
    setNotice("");
    setHash(undefined);
    setReview({ title, description, rows, run, owner: address });
  }

  async function send(
    to: Address,
    abi: Abi,
    functionName: string,
    args: unknown[] = [],
  ) {
    try {
      const result = await wallet.send(
        to,
        encodeFunctionData({ abi, functionName, args }),
        (hash) => {
          setHash(hash);
          rememberPending(hash);
        },
      );
      rememberPending();
      return result;
    } catch (e) {
      if (message(e).includes("Transaction reverted")) rememberPending();
      throw e;
    }
  }

  async function confirm() {
    if (!review || busy || review.owner !== address) return;
    setBusy(true);
    setError("");
    const initiatingOwner = address;
    try {
      const result = await review.run();
      await refresh();
      if (latestOwner.current === initiatingOwner) {
        setNotice(result);
        setReview(undefined);
      }
    } catch (e) {
      const text = message(e);
      if (latestOwner.current === initiatingOwner) {
        setError(text);
        const submitted = text.match(/0x[0-9a-fA-F]{64}/)?.[0];
        if (text.includes("confirmation is unknown") && submitted)
          setUnknownHash(submitted as Hex);
      }
    } finally {
      setBusy(false);
    }
  }

  async function reconcile() {
    if (!unknownHash || !d) return;
    setBusy(true);
    try {
      const receipt = await clientFor(d).getTransactionReceipt({
        hash: unknownHash,
      });
      setUnknownHash(undefined);
      rememberPending();
      setError("");
      setReview(undefined);
      setNotice(
        receipt.status === "success"
          ? "The submitted transaction is confirmed. Check your balances before the next action."
          : "The submitted transaction reverted. Nothing from it was applied.",
      );
      await refresh();
    } catch {
      setError(
        "The submitted transaction is still unconfirmed. Do not repeat it yet.",
      );
    } finally {
      setBusy(false);
    }
  }

  const guard = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      setError(message(e));
    }
  };

  const actions = {
    createAccount: () =>
      guard(() => {
        if (!d?.factory || !address) return;
        ask(
          "Create your Setsuna account",
          "Deploys an account that only your connected address owns. It holds your reserve and your Perpl trading account.",
          [
            ["Owner", shortAddress(address)],
            ["Network", d.name],
          ],
          async () => {
            await send(d.factory!, factoryAbi, "createAccount");
            return "Account created. Add trading collateral to open your first position.";
          },
        );
      }),

    fund: (
      kind: "fundReserve" | "initialize" | "depositTrading",
      raw: string,
    ) =>
      guard(() => {
        const value = amount(raw);
        if (!account || !d || !address) return;
        if (value > (snapshot?.walletBalance ?? BigInt(0)))
          throw new Error("That is more AUSD than your wallet holds.");
        ask(
          kind === "fundReserve"
            ? "Fund your reserve"
            : kind === "initialize"
              ? "Open your trading account"
              : "Add trading collateral",
          "Two signatures: approve exactly this amount, then deposit it. If the deposit fails, the approval may remain.",
          [
            ["Amount", `${ausd(value, 6)} AUSD`],
            [
              "Goes to",
              kind === "fundReserve"
                ? "Protection reserve"
                : "Perpl trading balance",
            ],
            ["Approval spender", shortAddress(account)],
          ],
          async () => {
            await send(d.collateral, erc20Abi, "approve", [account, value]);
            if (latestOwner.current !== address)
              throw new Error(
                "Account changed after approval. Deposit cancelled.",
              );
            await send(account, accountAbi, kind, [value]);
            return kind === "fundReserve"
              ? "Reserve funded."
              : "Trading balance updated.";
          },
        );
      }),

    withdrawReserve: (raw: string) =>
      guard(() => {
        if (!account) return;
        const value = amount(raw);
        if (value > (snapshot?.reserve ?? BigInt(0)))
          throw new Error("That is more than your reserve holds.");
        ask(
          "Withdraw from reserve",
          "Returns unused AUSD to you. Budget already spent stays on record.",
          [
            ["Amount", `${ausd(value, 6)} AUSD`],
            ["To", shortAddress(address!)],
          ],
          async () => {
            await send(account, accountAbi, "withdrawReserve", [value]);
            return "Reserve withdrawn.";
          },
        );
      }),

    withdrawTrading: (raw: string) =>
      guard(() => {
        if (!account) return;
        const value = amount(raw);
        if (value > (snapshot?.freeTrading ?? BigInt(0)))
          throw new Error(
            "That exceeds your free trading balance. Close the position first to release its collateral.",
          );
        ask(
          "Withdraw trading collateral",
          "Withdraws free collateral from Perpl, subject to venue limits. Collateral inside a position stays there.",
          [["Amount", `${ausd(value, 6)} AUSD`]],
          async () => {
            await send(account, accountAbi, "withdrawTrading", [value]);
            return "Trading collateral withdrawn.";
          },
        );
      }),

    arm: (input: ArmInput, summary: [string, string][]) =>
      guard(() => {
        if (!account) return;
        const capCNS = amount(input.cap);
        const minTopUpCNS = amount(input.minTopUp);
        const feeMaxCNS = amount(input.feeMax);
        if (!/^\d+(\.\d{1,2})?$/.test(input.feePct))
          throw new Error("Keeper fee supports up to two decimal places.");
        const feeBps =
          input.feePct === "0" ? 0 : Number(amount(input.feePct, 2));
        const age = Number(input.markAge);
        if (input.targetBps <= input.triggerBps || input.targetBps > 65535)
          throw new Error("Target must sit above the trigger.");
        if (
          feeBps > 1000 ||
          !Number.isInteger(age) ||
          age < 1 ||
          age > 300 ||
          minTopUpCNS > capCNS
        )
          throw new Error(
            "Use a fee of 0–10%, a price age of 1–300 seconds, and a minimum no larger than the budget.",
          );
        ask(
          "Protect this position",
          "Authorises top-ups for this exact position, up to your budget. Keeper fees count inside the budget. Trading again ends this protection until you re-arm it.",
          summary,
          async () => {
            await send(account, accountAbi, "armPolicy", [
              {
                capCNS,
                minTopUpCNS,
                feeMaxCNS,
                triggerBufferBps: input.triggerBps,
                targetBufferBps: input.targetBps,
                feeBps,
                maxMarkAgeSec: age,
              },
            ]);
            return "Protection policy armed. Eligible top-ups can now be submitted by a funded keeper.";
          },
        );
      }),

    changeCap: (raw: string) =>
      guard(() => {
        if (!account || !policy) return;
        const value = amount(raw);
        if (value < policy.usedCNS)
          throw new Error(
            "The budget cannot be lower than what is already spent.",
          );
        ask(
          "Change budget",
          "Changes the total this protection may ever spend. It does not reset what is already spent.",
          [
            ["New budget", `${ausd(value, 6)} AUSD`],
            ["Already spent", `${ausd(policy.usedCNS, 6)} AUSD`],
          ],
          async () => {
            await send(account, accountAbi, "setCap", [value]);
            return "Budget updated.";
          },
        );
      }),

    revoke: () =>
      guard(() => {
        if (!account || !policy) return;
        ask(
          "Turn protection off",
          "Stops all future top-ups for this position. Your reserve stays yours and stays withdrawable.",
          [
            ["Protection", `#${snapshot?.policyId}`],
            ["Already spent", `${ausd(policy.usedCNS, 6)} AUSD`],
          ],
          async () => {
            await send(account, accountAbi, "revokePolicy");
            return "Protection is off.";
          },
        );
      }),

    trade: (side: number, size: string, price: string, leverage: string) =>
      guard(() => {
        if (!account || !market || !d) return;
        const pricePNS = amount(price, Number(market.priceDecimals));
        const lotLNS = amount(size, Number(market.lotDecimals));
        const leverageHdths = amount(leverage, 2);
        if (![0, 1, 2, 3].includes(side))
          throw new Error("Invalid order side.");
        if (side >= 2 && (!hasPosition || position!.positionType !== side - 2))
          throw new Error("There is no matching position to close.");
        if (side >= 2 && lotLNS > position!.lotLNS)
          throw new Error("Close size exceeds your open position.");
        if (side < 2 && hasPosition && position!.positionType !== side)
          throw new Error(
            "Close your existing position before opening the opposite side.",
          );
        if (leverageHdths > BigInt(1500))
          throw new Error("This preview limits leverage to 15×.");
        ask(
          "Place order",
          "Fill-or-kill: it fills in full or not at all. Any trade ends current protection; re-arm for the new position.",
          [
            [
              "Order",
              [
                "Open or add long",
                "Open or add short",
                "Close long",
                "Close short",
              ][side],
            ],
            ["Size", `${size} BTC`],
            ["Limit price", `$${price}`],
            ["Leverage", `${leverage}×`],
          ],
          async () => {
            const hash = await send(account, accountAbi, "executeOrder", [
              {
                orderDescId: BigInt(0),
                perpId: BigInt(d.perpId),
                orderType: side,
                orderId: BigInt(0),
                pricePNS,
                lotLNS,
                expiryBlock: BigInt(0),
                postOnly: false,
                fillOrKill: true,
                immediateOrCancel: false,
                maxMatches: BigInt(30),
                leverageHdths,
                lastExecutionBlock: BigInt(0),
                amountCNS: BigInt(0),
                maxNegPnlCollatBPS: BigInt(100),
              },
            ]);
            try {
              const receipt = await clientFor(d).getTransactionReceipt({
                hash,
              });
              const outcome = tradeOutcome(
                receipt,
                account,
                d.exchange,
                snapshot!.accountId,
                BigInt(d.perpId),
              );
              return `Order confirmed. ${tradeDescription(outcome, Number(market.lotDecimals), Number(market.priceDecimals))}`;
            } catch {
              return "Order confirmed. Fill details are unavailable; check your position before trading again.";
            }
          },
        );
      }),

    topUp: () =>
      guard(() => {
        if (!account || !quote || !d) return;
        ask(
          "Step in now",
          "Submits the contract's own quote, as any keeper could. The account that submits receives the keeper fee.",
          [
            ["Margin added", `${ausd(quote.amountCNS, 6)} AUSD`],
            ["Keeper fee", `${ausd(quote.feeCNS, 6)} AUSD`],
          ],
          async () => {
            const hash = await send(account, accountAbi, "topUp");
            try {
              const receipt = await clientFor(d).getTransactionReceipt({
                hash,
              });
              for (const log of receipt.logs) {
                if (log.address.toLowerCase() !== account.toLowerCase())
                  continue;
                try {
                  const event = decodeEventLog({
                    abi: accountAbi,
                    data: log.data,
                    topics: log.topics,
                  });
                  const args = event.args as unknown as Record<string, bigint>;
                  if (event.eventName === "ToppedUp")
                    return `Top-up confirmed. ${ausd(args.amountCNS, 6)} AUSD added to margin.`;
                  if (event.eventName === "Refused")
                    return `Top-up not applied: ${statuses[Number(args.reason)] ?? "policy check failed"}. Your reserve was not spent.`;
                } catch {
                  /* unrelated event */
                }
              }
            } catch {
              /* receipt detail can be retried in Activity */
            }
            return "Transaction confirmed. Top-up outcome could not be verified; check Activity and your reserve before retrying.";
          },
        );
      }),
  };

  return {
    wallet,
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
    loading,
    readError,
    error,
    setError,
    notice,
    setNotice,
    review,
    setReview,
    busy,
    hash,
    unknownHash,
    refresh,
    confirm,
    reconcile,
    actions,
  };
}

export type Setsuna = ReturnType<typeof useSetsuna>;
