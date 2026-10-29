"use client";

import { useEffect, useState } from "react";
import { encodeFunctionData, erc20Abi, formatUnits, getAddress, isAddress, parseUnits, type Address, type Hex } from "viem";
import { clientFor, useWallet } from "./WalletProvider";
import { message } from "@/lib/setsuna/format";
import { useNoticeToast } from "./Toaster";
import { smartAccountHint, useMonReserve } from "./useMonReserve";

export type SendAsset = "MON" | "USDC" | "AUSD";

const DECIMALS: Record<SendAsset, number> = { MON: 18, USDC: 6, AUSD: 6 };

/**
 * Send MON, USDC or AUSD from the connected wallet to any address. Email, Google and passkey
 * accounts have no other wallet app, so this is how their funds leave Setsuna.
 */
export default function SendFunds({
  asset,
  token,
  balance,
  monBalance,
  onClose,
  onSent,
}: {
  asset: SendAsset;
  /** The token contract; undefined for native MON. */
  token?: Address;
  balance?: bigint;
  monBalance?: bigint;
  onClose: () => void;
  onSent: () => void;
}) {
  const wallet = useWallet();
  const { deployment: d, address } = wallet;
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [isContract, setIsContract] = useState(false);
  const [gasReserve, setGasReserve] = useState(BigInt("20000000000000000")); // 0.02 MON until priced
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState<Hex>();
  const [notice, setNotice] = useState("");
  useNoticeToast(notice);
  const decimals = DECIMALS[asset];
  const { delegated, reserve } = useMonReserve();

  // Keep enough MON for this send's own fee, priced live with a wide margin.
  useEffect(() => {
    if (!d) return;
    clientFor(d)
      .getGasPrice()
      .then((price) => setGasReserve(price * BigInt(asset === "MON" ? 21_000 * 3 : 0)))
      .catch(() => undefined);
  }, [d, asset]);

  const valid = isAddress(to.trim());
  const recipient = valid ? getAddress(to.trim()) : undefined;
  useEffect(() => {
    setIsContract(false);
    if (!d || !recipient) return;
    clientFor(d)
      .getCode({ address: recipient })
      // EIP-7702 wallets (e.g. MetaMask smart accounts) carry a 0xef0100… delegation marker as
      // code; they are ordinary wallets, so only real contract code earns the warning.
      .then((code) =>
        setIsContract(!!code && code !== "0x" && !code.toLowerCase().startsWith("0xef0100")),
      )
      .catch(() => undefined);
  }, [d, recipient]);

  let units = BigInt(0);
  if (new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`).test(amount)) {
    try {
      units = parseUnits(amount, decimals);
    } catch {
      units = BigInt(0);
    }
  }
  const spendable =
    asset === "MON"
      ? (balance ?? BigInt(0)) > gasReserve + reserve
        ? (balance ?? BigInt(0)) - gasReserve - reserve
        : BigInt(0)
      : (balance ?? BigInt(0));
  const reason = !to
    ? "Enter the address to send to."
    : !recipient
      ? "That isn't a valid Monad address."
      : address && recipient.toLowerCase() === address.toLowerCase()
        ? "That's your own address."
        : !amount
          ? "Enter an amount."
          : units === BigInt(0)
            ? "Enter a valid amount greater than zero."
            : units > spendable
              ? asset === "MON"
                ? delegated
                  ? `You can send up to ${Number(formatUnits(spendable, 18)).toLocaleString("en-US", { maximumFractionDigits: 6 })} MON. ${smartAccountHint}`
                  : "Not enough MON once the network fee is set aside."
                : `Not enough ${asset}.`
              : asset !== "MON" && (monBalance ?? BigInt(0)) === BigInt(0)
                ? `Sending ${asset} needs a little MON for the network fee.`
                : "";

  async function send() {
    if (!d || !recipient || reason) return;
    setBusy("Confirm in your wallet…");
    setError("");
    try {
      const hash =
        asset === "MON"
          ? await wallet.send(recipient, "0x", undefined, units)
          : await wallet.send(token!, encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [recipient, units] }));
      setSent(hash);
      setNotice(`Sent ${amount} ${asset}.`);
      onSent();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy("");
      setReviewing(false);
    }
  }

  return (
    <section className="s-card p-send" aria-label={`Send ${asset}`}>
      <div className="p-send-head">
        <h3>Send {asset}</h3>
        <button type="button" className="p-send-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      {sent ? (
        <div className="p-send-done">
          <p>
            Sent {amount} {asset} to <code>{recipient}</code>.
          </p>
          {d?.explorer && (
            <a href={`${d.explorer}/tx/${sent}`} target="_blank" rel="noreferrer">
              View on explorer ↗
            </a>
          )}
          <button type="button" className="s-btn is-small" onClick={onClose}>
            Done
          </button>
        </div>
      ) : (
        <>
          <label className="p-send-field">
            <span>To</span>
            <input
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setReviewing(false);
              }}
              placeholder="0x…"
              autoComplete="off"
              spellCheck={false}
              disabled={!!busy}
            />
          </label>
          <label className="p-send-field">
            <span>
              Amount{" "}
              <button
                type="button"
                className="p-send-max"
                disabled={!!busy || spendable === BigInt(0)}
                onClick={() => {
                  setAmount(formatUnits(spendable, decimals));
                  setReviewing(false);
                }}
              >
                Max {Number(formatUnits(spendable, decimals)).toLocaleString("en-US", { maximumFractionDigits: 6 })}
              </button>
            </span>
            <input
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setReviewing(false);
              }}
              placeholder="0.00"
              inputMode="decimal"
              autoComplete="off"
              disabled={!!busy}
            />
          </label>
          {recipient && isContract && (
            <p className="p-inline-warning">
              This address is a contract. Only send if you&apos;re sure it can receive {asset}; tokens sent to the wrong contract can be lost.
            </p>
          )}
          {reviewing && !reason && (
            <div className="p-send-review" role="status">
              You&apos;re sending <strong>{amount} {asset}</strong> to
              <code>{recipient}</code>
              Transfers on Monad can&apos;t be reversed. Check the address.
            </div>
          )}
          {(reason || error) && (to || amount || error) && (
            <p className={error ? "s-error" : "s-earn-form-hint"} role={error ? "alert" : "status"}>
              {error || reason}
            </p>
          )}
          <button
            type="button"
            className="s-btn is-primary is-wide"
            disabled={!!reason || !!busy}
            onClick={() => (reviewing ? void send() : setReviewing(true))}
          >
            {busy || (reviewing ? `Confirm send` : "Review")}
          </button>
        </>
      )}
    </section>
  );
}
