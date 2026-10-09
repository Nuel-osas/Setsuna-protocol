"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { clientFor, useWallet } from "./WalletProvider";
import {
  confirmsDemoFunding,
  type FaucetStatus,
} from "@/lib/setsuna/demo-faucet";
import type { Hex } from "viem";

export default function DemoFunding({
  onFunded,
  disabled = false,
}: {
  onFunded: () => Promise<void>;
  disabled?: boolean;
}) {
  const { deployment: d, address } = useWallet();
  const [status, setStatus] = useState<FaucetStatus>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [pending, setPending] = useState<Hex>();
  const fundedCallback = useRef(onFunded);
  useEffect(() => {
    fundedCallback.current = onFunded;
  }, [onFunded]);
  const pendingKey =
    d?.faucet && address
      ? `setsuna.funding.pending.${d.chainId}.${d.faucet}.${address}`
      : undefined;
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    if (!address || !d?.faucet || d.mode !== "demo") return;
    const current = generation.current;
    try {
      const r = await fetch(`/api/demo/fund/?address=${address}`, {
        cache: "no-store",
      });
      if (!r.ok) throw new Error();
      const result: FaucetStatus = await r.json();
      if (current === generation.current) {
        setStatus(result);
        setUnavailable(false);
      }
    } catch {
      if (current === generation.current) {
        setStatus(undefined);
        setUnavailable(true);
      }
    }
  }, [address, d]);
  useEffect(() => {
    generation.current++;
    setStatus(undefined);
    setNotice("");
    setBusy(false);
    setUnavailable(false);
    setPending(undefined);
    try {
      const hash = pendingKey ? localStorage.getItem(pendingKey) : null;
      if (hash && /^0x[0-9a-fA-F]{64}$/.test(hash)) setPending(hash as Hex);
    } catch {
      /* Browser persistence is optional. */
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    return () => {
      generation.current++;
      clearInterval(timer);
    };
  }, [refresh, pendingKey]);
  useEffect(() => {
    if (!pending || !d?.faucet || !address) return;
    let cancelled = false,
      reading = false;
    const check = async () => {
      if (reading) return;
      reading = true;
      const current = generation.current;
      try {
        const receipt = await clientFor(d).getTransactionReceipt({
          hash: pending,
        });
        if (cancelled) return;
        if (confirmsDemoFunding(receipt, d.faucet!, address)) {
          setNotice(
            "Test funds received: 101 MON, 1,000 USDC and 1,000 AUSD. These assets have no monetary value.",
          );
        } else if (receipt.status === "reverted") {
          setNotice(
            "Funding transaction reverted. Check availability before trying again.",
          );
        } else {
          setNotice(
            "Funding receipt did not confirm this wallet’s claim. Check the transaction before retrying.",
          );
          return;
        }
        try {
          if (pendingKey) localStorage.removeItem(pendingKey);
        } catch {
          /* Optional persistence. */
        }
        setPending(undefined);
        await refresh();
        if (current === generation.current) await fundedCallback.current();
      } catch {
        /* Keep the hash and check again; never resubmit an uncertain claim. */
      } finally {
        reading = false;
      }
    };
    void check();
    const timer = setInterval(() => void check(), 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pending, d, address, pendingKey, refresh]);
  if (!address || !d?.faucet || d.mode !== "demo") return null;
  async function claim() {
    const current = generation.current;
    setBusy(true);
    setNotice("");
    try {
      const r = await fetch("/api/demo/fund/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const result = await r.json();
      if (generation.current !== current) return;
      if (!result.funded && /^0x[0-9a-fA-F]{64}$/.test(result.hash ?? "")) {
        setPending(result.hash);
        try {
          if (pendingKey) localStorage.setItem(pendingKey, result.hash);
        } catch {
          /* Optional persistence. */
        }
      }
      setNotice(
        result.message ??
          result.error ??
          "Check your wallet balance for test funds.",
      );
      await refresh();
      if (generation.current === current) await onFunded();
    } catch {
      if (generation.current === current) {
        setNotice(
          "Funding confirmation is unavailable. Check your balance before retrying.",
        );
        await refresh();
        await onFunded();
      }
    } finally {
      if (generation.current === current) setBusy(false);
    }
  }
  return (
    <div className="s-demo-funding">
      <strong>Try with test funds</strong>
      <p className="s-footnote">
        Get 101 MON for Earn, Spot and gas, plus 1,000 USDC and 1,000 AUSD for
        trading. Test assets have no monetary value. One claim per wallet per
        demo day.
      </p>
      <button
        className="s-btn is-small"
        disabled={disabled || busy || !!pending || !status?.eligible}
        onClick={() => void claim()}
      >
        {busy
          ? "Sending test funds…"
          : pending
            ? "Checking funding transaction…"
            : status && !status.eligible && status.available
              ? "Test funds already claimed"
              : "Get test funds"}
      </button>
      {!status && (
        <p className="s-footnote">
          {unavailable
            ? "Demo funding is temporarily unavailable. Availability refreshes automatically."
            : "Checking demo funding availability…"}
        </p>
      )}
      {status?.message && <p className="s-footnote">{status.message}</p>}
      {notice && <p role="status">{notice}</p>}
    </div>
  );
}
