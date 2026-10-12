"use client";
import { useEffect, useMemo, useState } from "react";
import { parseUnits } from "viem";
import {
  auroraKey,
  chainName,
  evmChains,
  finished,
  monadAsset,
  quote,
  sourceTokens,
  transferFor,
  type IntentQuote,
  type IntentStatus,
  type IntentToken,
} from "@/lib/setsuna/aurora-intents";

type Active = {
  origin: IntentToken;
  quote: IntentQuote & { depositAddress: string };
};

const statusText: Record<IntentStatus, string> = {
  PENDING_DEPOSIT: "Waiting for your deposit…",
  KNOWN_DEPOSIT_TX: "Deposit seen on the source chain…",
  PROCESSING: "Bridging to Monad…",
  SUCCESS: "Arrived in your Monad wallet.",
  INCOMPLETE_DEPOSIT:
    "Less than the quoted amount arrived. Send the remainder or wait for a refund.",
  REFUNDED: "Refunded to your source address.",
  FAILED:
    "The transfer failed. Any deposit is refunded to your source address.",
};

const label = (t: IntentToken) =>
  `${t.symbol} · ${chainName[t.blockchain] ?? t.blockchain}`;

/**
 * Bring funds from another chain into the connected Monad wallet through
 * Aurora Intents, then hand the arrived amount to the Earn deposit form.
 */
export default function AnyChainDeposit({
  asset,
  recipient,
  onArrived,
}: {
  asset: "USDC" | "MON";
  recipient?: string;
  onArrived: (amount: string) => void;
}) {
  const storeKey = `setsuna:intent:${asset}:${recipient?.toLowerCase()}`;
  const [open, setOpen] = useState(false);
  const [tokens, setTokens] = useState<IntentToken[]>();
  const [originId, setOriginId] = useState("");
  const [amount, setAmount] = useState("");
  const [refund, setRefund] = useState("");
  const [preview, setPreview] = useState<IntentQuote>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<Active>();
  const [status, setStatus] = useState<IntentStatus>();
  const [received, setReceived] = useState("");
  const [copied, setCopied] = useState(false);

  const origin = tokens?.find((t) => t.assetId === originId);
  const evm = !!origin && evmChains.has(origin.blockchain);
  const refundTo = evm && !refund ? (recipient ?? "") : refund.trim();
  const units = useMemo(() => {
    try {
      return origin && amount ? parseUnits(amount, origin.decimals) : BigInt(0);
    } catch {
      return BigInt(0);
    }
  }, [origin, amount]);

  // Resume a deposit address across reloads; it stays valid until its deadline.
  useEffect(() => {
    if (!recipient) return;
    try {
      const saved = localStorage.getItem(storeKey);
      if (saved) {
        const parsed = JSON.parse(saved) as Active;
        if (new Date(parsed.quote.deadline ?? 0).getTime() > Date.now()) {
          setActive(parsed);
          setOpen(true);
        } else localStorage.removeItem(storeKey);
      }
    } catch {}
  }, [recipient, storeKey]);

  useEffect(() => {
    if (!open || tokens) return;
    sourceTokens()
      .then((list) => {
        setTokens(list);
        setOriginId((id) => id || list[0]?.assetId || "");
      })
      .catch((e: Error) => setError(e.message));
  }, [open, tokens]);

  // Live preview of what arrives, debounced while typing.
  useEffect(() => {
    setPreview(undefined);
    if (!origin || units === BigInt(0) || !recipient || !refundTo || active)
      return;
    const timer = setTimeout(() => {
      quote({
        origin,
        destination: monadAsset[asset],
        amount: units,
        recipient,
        refundTo,
        dry: true,
      })
        .then((q) => {
          setPreview(q);
          setError("");
        })
        .catch((e: Error) => setError(e.message));
    }, 600);
    return () => clearTimeout(timer);
  }, [origin, units, recipient, refundTo, asset, active]);

  // Follow the transfer until it settles.
  useEffect(() => {
    if (!active || !recipient || finished(status)) return;
    let stop = false;
    const poll = async () => {
      try {
        const t = await transferFor(recipient, active.quote.depositAddress);
        if (stop || !t) return;
        setStatus(t.status);
        if (t.status === "SUCCESS")
          setReceived(t.amountOutFormatted ?? active.quote.amountOutFormatted);
      } catch {}
    };
    void poll();
    const id = setInterval(poll, 6000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [active, recipient, status]);

  if (!auroraKey) return null;

  async function start() {
    if (!origin || !recipient) return;
    setBusy(true);
    setError("");
    try {
      const q = await quote({
        origin,
        destination: monadAsset[asset],
        amount: units,
        recipient,
        refundTo,
        dry: false,
      });
      if (!q.depositAddress) throw new Error("No deposit address returned.");
      const next = {
        origin,
        quote: { ...q, depositAddress: q.depositAddress },
      };
      setActive(next);
      setStatus("PENDING_DEPOSIT");
      try {
        localStorage.setItem(storeKey, JSON.stringify(next));
      } catch {}
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setActive(undefined);
    setStatus(undefined);
    setReceived("");
    setAmount("");
    try {
      localStorage.removeItem(storeKey);
    } catch {}
  }

  return (
    <details
      className="s-card s-anychain"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary>
        <span>
          Deposit from another chain
          <small>Any chain to Monad · via Aurora Intents</small>
        </span>
      </summary>

      {!recipient ? (
        <p className="s-anychain-note">
          Connect your Monad wallet first. Funds arrive at that address.
        </p>
      ) : !active ? (
        <div className="s-anychain-body">
          <label>
            Send
            <select
              value={originId}
              onChange={(e) => setOriginId(e.target.value)}
              disabled={!tokens}
            >
              {!tokens && <option>Loading routes…</option>}
              {tokens?.map((t) => (
                <option key={t.assetId} value={t.assetId}>
                  {label(t)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Amount
            <input
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) =>
                setAmount(e.target.value.replace(/[^0-9.]/g, ""))
              }
            />
          </label>
          {origin && !evm && (
            <label>
              Refund address on{" "}
              {chainName[origin.blockchain] ?? origin.blockchain}
              <input
                placeholder="Where to return funds if the transfer fails"
                value={refund}
                onChange={(e) => setRefund(e.target.value)}
              />
            </label>
          )}
          <p className="s-anychain-quote">
            {preview
              ? `You receive ≈ ${Number(preview.amountOutFormatted).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${asset} on Monad${preview.timeEstimate ? ` · about ${preview.timeEstimate}s` : ""}`
              : `Arrives as ${asset} in ${recipient.slice(0, 6)}…${recipient.slice(-4)} on Monad.`}
          </p>
          <button
            className="s-btn is-primary"
            disabled={!preview || busy}
            onClick={() => void start()}
          >
            {busy ? "Creating address…" : "Get deposit address"}
          </button>
        </div>
      ) : (
        <div className="s-anychain-body">
          <p className="s-anychain-step">
            Send exactly{" "}
            <strong>
              {active.quote.amountInFormatted} {label(active.origin)}
            </strong>{" "}
            to:
          </p>
          <button
            className="s-anychain-address"
            onClick={() => {
              void navigator.clipboard?.writeText(active.quote.depositAddress);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            <code>{active.quote.depositAddress}</code>
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>
          <p className="s-anychain-note">
            Only send on{" "}
            {chainName[active.origin.blockchain] ?? active.origin.blockchain}.
            Valid until{" "}
            {new Date(active.quote.deadline ?? 0).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
            . You receive ≈ {active.quote.amountOutFormatted} {asset} on Monad.
          </p>
          <p className="s-anychain-status" role="status">
            {status ? statusText[status] : "Checking…"}
          </p>
          {status === "SUCCESS" ? (
            <button
              className="s-btn is-primary"
              onClick={() => {
                onArrived(received);
                reset();
              }}
            >
              Deposit {received} {asset} into sets{asset}
            </button>
          ) : (
            <button className="s-btn is-small" onClick={reset}>
              {finished(status) ? "Start again" : "Cancel"}
            </button>
          )}
        </div>
      )}
      {error && (
        <p className="s-error" role="alert">
          {error}
        </p>
      )}
    </details>
  );
}
