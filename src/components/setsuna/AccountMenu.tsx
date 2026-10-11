"use client";
import { useEffect, useRef, useState } from "react";
import { useWallet } from "./WalletProvider";
import { shortAddress } from "@/lib/setsuna/format";

/** Header account button: connects when signed out, opens a menu when signed in. */
export default function AccountMenu() {
  const wallet = useWallet();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (
        e instanceof KeyboardEvent
          ? e.key === "Escape"
          : !root.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  useEffect(() => {
    if (!wallet.address) setOpen(false);
  }, [wallet.address]);
  if (!wallet.address)
    return (
      <button className="s-btn is-small" onClick={wallet.openConnect}>
        Connect
      </button>
    );
  const address = wallet.address;
  const explorer = wallet.deployment?.explorer ?? "https://monadscan.com";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="s-account" ref={root}>
      <button
        className="s-btn is-small s-account-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <i aria-hidden="true" />
        {shortAddress(address)}
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="s-account-menu" role="menu">
          <p className="s-account-address" title={address}>
            <span>{wallet.kind === "mera" ? "Passkey account" : "Wallet"}</span>
            <code>{shortAddress(address)}</code>
          </p>
          <button role="menuitem" onClick={() => void copy()}>
            {copied ? "Copied" : "Copy address"}
          </button>
          <a
            role="menuitem"
            href={`${explorer}/address/${address}`}
            target="_blank"
            rel="noreferrer"
            onClick={() => setOpen(false)}
          >
            View on explorer ↗
          </a>
          <button
            role="menuitem"
            className="is-danger"
            onClick={() => {
              setOpen(false);
              wallet.disconnect();
            }}
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
