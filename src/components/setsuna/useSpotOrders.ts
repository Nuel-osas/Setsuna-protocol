"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { encodeFunctionData, erc20Abi, zeroAddress, type Hex } from "viem";
import { clientFor, useWallet } from "./WalletProvider";
import {
  kuruMargin,
  spotOrdersABI as abi,
  type SpotOrderSnapshot,
} from "@/lib/setsuna/spot-orders";
import { message } from "@/lib/setsuna/format";

export function useSpotOrders(
  externalBusy: boolean,
  onChanged: () => Promise<void>,
) {
  const wallet = useWallet(),
    { deployment: d, address } = wallet;
  const factory = d?.spot?.ordersFactory;
  const [snapshot, setSnapshot] = useState<SpotOrderSnapshot>();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Hex>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [readError, setReadError] = useState("");
  const epoch = useRef(0),
    running = useRef(false);
  const key =
    d && factory && address
      ? `setsuna.spot.orders.${d.chainId}.${factory}.${address}`
      : undefined;
  const refresh = useCallback(async () => {
    if (!d?.spot || !factory || !address) return;
    const generation = epoch.current;
    try {
      const c = clientFor(d),
        block = await c.getBlock();
      if ((await c.getChainId()) !== d.chainId)
        throw new Error("Wrong Spot network");
      const read = (functionName: "market" | "margin" | "usdc") =>
        c.readContract({
          address: factory,
          abi,
          functionName,
          blockNumber: block.number,
        });
      const [account, market, margin, usdc] = await Promise.all([
        c.readContract({
          address: factory,
          abi,
          functionName: "accountOf",
          args: [address],
          blockNumber: block.number,
        }),
        read("market"),
        read("margin"),
        read("usdc"),
      ]);
      if (
        market.toLowerCase() !== d.spot.market.toLowerCase() ||
        margin.toLowerCase() !== kuruMargin.toLowerCase() ||
        usdc.toLowerCase() !== d.spot.usdc.toLowerCase()
      )
        throw new Error("Spot order contracts do not match the market.");
      let next: SpotOrderSnapshot = {
        availableMON: BigInt(0),
        availableUSDC: BigInt(0),
        orders: [],
        timestamp: block.timestamp,
      };
      if (account !== zeroAddress) {
        const [owner, [ids, orders], mon, quote] = await Promise.all([
          c.readContract({
            address: account,
            abi,
            functionName: "owner",
            blockNumber: block.number,
          }),
          c.readContract({
            address: account,
            abi,
            functionName: "getOpenOrders",
            blockNumber: block.number,
          }),
          c.readContract({
            address: kuruMargin,
            abi,
            functionName: "getBalance",
            args: [account, zeroAddress],
            blockNumber: block.number,
          }),
          c.readContract({
            address: kuruMargin,
            abi,
            functionName: "getBalance",
            args: [account, d.spot.usdc],
            blockNumber: block.number,
          }),
        ]);
        if (owner.toLowerCase() !== address.toLowerCase())
          throw new Error("Spot account owner mismatch");
        next = {
          account,
          availableMON: mon,
          availableUSDC: quote,
          orders: orders.map((o, i) => ({ ...o, id: ids[i] })),
          timestamp: block.timestamp,
        };
      }
      if (generation === epoch.current) {
        setSnapshot(next);
        setReadError("");
      }
    } catch (e) {
      if (generation === epoch.current) {
        setSnapshot(undefined);
        setReadError(`Could not read Spot orders. ${message(e)}`);
      }
    }
  }, [d, factory, address]);
  useEffect(() => {
    epoch.current++;
    running.current = false;
    setSnapshot(undefined);
    setPending(undefined);
    setBusy(false);
    setError("");
    setNotice("");
    setReadError("");
    if (key)
      try {
        const hash = localStorage.getItem(key);
        if (hash && /^0x[0-9a-f]{64}$/i.test(hash)) setPending(hash as Hex);
      } catch {
        /* optional storage */
      }
    void refresh();
    const timer = setInterval(() => void refresh(), 8000);
    return () => {
      epoch.current++;
      clearInterval(timer);
    };
  }, [key, refresh]);
  const ready =
    !!factory &&
    !!address &&
    !!snapshot &&
    !readError &&
    !pending &&
    !busy &&
    !externalBusy;
  async function run(
    action: (
      send: (to: Hex, data: Hex, value?: bigint) => Promise<Hex>,
      unchanged: () => void,
    ) => Promise<void>,
    success: string,
  ) {
    if (!ready || running.current || !d) return;
    const generation = epoch.current,
      savedKey = key;
    running.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const unchanged = () => {
      if (generation !== epoch.current)
        throw new Error("Wallet changed. Review the order again.");
    };
    const track = (hash?: Hex) => {
      if (generation === epoch.current) setPending(hash);
      if (savedKey)
        try {
          if (hash) localStorage.setItem(savedKey, hash);
          else localStorage.removeItem(savedKey);
        } catch {
          /* optional */
        }
    };
    const send = async (to: Hex, data: Hex, value = BigInt(0)) => {
      unchanged();
      const hash = await wallet.send(to, data, track, value);
      track();
      unchanged();
      return hash;
    };
    try {
      await action(send, unchanged);
      unchanged();
      setNotice(success);
      await Promise.all([refresh(), onChanged()]);
    } catch (e) {
      if (generation === epoch.current) setError(message(e));
    } finally {
      if (generation === epoch.current) {
        running.current = false;
        setBusy(false);
      }
    }
  }
  return {
    snapshot,
    busy,
    pending,
    error,
    notice,
    readError,
    ready,
    refresh,
    factory,
    create: () =>
      run(async (send) => {
        await send(
          factory!,
          encodeFunctionData({ abi, functionName: "createAccount" }),
        );
      }, "Spot limit account created. Review your order to continue."),
    place: (order: {
      isBuy: boolean;
      price: number;
      size: bigint;
      funding: bigint;
      deadline: bigint;
      reviewedAt: number;
    }) =>
      run(async (send, unchanged) => {
        if (!snapshot?.account || !d?.spot || !address)
          throw new Error("Create a Spot account first.");
        const account = snapshot.account,
          c = clientFor(d);
        const fresh = async () => {
          const block = await c.getBlock();
          unchanged();
          if (
            block.timestamp > order.deadline ||
            Date.now() - order.reviewedAt > 90_000
          )
            throw new Error(
              "Order review expired. Review the price and funding again.",
            );
        };
        await fresh();
        if (order.isBuy && order.funding > BigInt(0)) {
          const allowance = await c.readContract({
            address: d.spot.usdc,
            abi: erc20Abi,
            functionName: "allowance",
            args: [address, account],
          });
          unchanged();
          if (allowance < order.funding)
            await send(
              d.spot.usdc,
              encodeFunctionData({
                abi: erc20Abi,
                functionName: "approve",
                args: [account, order.funding],
              }),
            );
        }
        await fresh();
        await send(
          account,
          encodeFunctionData({
            abi,
            functionName: "placeLimit",
            args: [
              order.isBuy,
              order.price,
              order.size,
              false,
              order.funding,
              order.deadline,
            ],
          }),
          order.isBuy ? BigInt(0) : order.funding,
        );
      }, "Limit order transaction confirmed. Check remaining orders and your Spot trading balances for fills."),
    cancel: (id: number) =>
      run(async (send) => {
        if (!snapshot?.account || !snapshot.orders.some((o) => o.id === id))
          throw new Error("This order is no longer open. Refresh the list.");
        await send(
          snapshot.account,
          encodeFunctionData({ abi, functionName: "cancelOrder", args: [id] }),
        );
      }, "Cancellation confirmed. Released funds are available in Spot trading balances."),
    withdraw: (mon: boolean) =>
      run(async (send) => {
        if (!snapshot?.account || !d?.spot)
          throw new Error("Spot account unavailable.");
        const value = mon ? snapshot.availableMON : snapshot.availableUSDC;
        if (value <= BigInt(0)) throw new Error("No free balance to withdraw.");
        await send(
          snapshot.account,
          encodeFunctionData({
            abi,
            functionName: "withdraw",
            args: [mon ? zeroAddress : d.spot.usdc, value],
          }),
        );
      }, "Spot balance withdrawn to your wallet."),
    reconcile: async () => {
      if (!d || !pending || running.current) return;
      const generation = epoch.current;
      running.current = true;
      setBusy(true);
      try {
        const receipt = await clientFor(d).getTransactionReceipt({
          hash: pending,
        });
        if (generation !== epoch.current) return;
        if (key)
          try {
            localStorage.removeItem(key);
          } catch {
            /* optional */
          }
        setPending(undefined);
        setError("");
        setNotice(
          receipt.status === "success"
            ? "Transaction confirmed. Review the updated balances and orders before continuing."
            : "Transaction reverted. Review the order before retrying.",
        );
        await Promise.all([refresh(), onChanged()]);
      } catch {
        if (generation === epoch.current)
          setError(
            "Receipt is still unavailable. Do not repeat the transaction yet.",
          );
      } finally {
        if (generation === epoch.current) {
          running.current = false;
          setBusy(false);
        }
      }
    },
  };
}
export type SpotOrdersController = ReturnType<typeof useSpotOrders>;
