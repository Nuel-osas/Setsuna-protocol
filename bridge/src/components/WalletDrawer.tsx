"use client";

import { useState } from "react";
import { type Ecosystem, ECOSYSTEM_LABEL } from "@/lib/chains";
import { short, useWallets } from "@/lib/wallets";

const ECOS: { e: Ecosystem; icon: string; hint: string }[] = [
  { e: "evm", icon: "/icons/ethereum.svg", hint: "MetaMask, Rabby, Coinbase, OKX…" },
  { e: "solana", icon: "/icons/solana.svg", hint: "Phantom, Solflare, Backpack" },
  { e: "sui", icon: "/icons/sui.svg", hint: "Slush, Suiet, Nightly…" },
  { e: "aptos", icon: "/icons/aptos.svg", hint: "Petra, Nightly, Pontem…" },
];

export function WalletChips({ onOpen }: { onOpen: () => void }) {
  const { connected } = useWallets();
  const list = Object.values(connected);
  return (
    <button className="btn wallet-btn" onClick={onOpen}>
      {list.length === 0 ? "Connect wallets" : (
        <>
          <span className="stack">
            {list.map((c) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={c.ecosystem} src={ECOS.find((x) => x.e === c.ecosystem)!.icon} alt="" width={18} height={18} />
            ))}
          </span>
          {list.length === 1 ? short(list[0].address) : `${list.length} wallets`}
        </>
      )}
    </button>
  );
}

export function WalletDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { options, connected, connect, disconnect } = useWallets();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const go = async (id: string) => {
    const o = options.find((x) => x.id === id)!;
    setBusy(id);
    setErr(null);
    try { await connect(o); } catch (e) { setErr((e as Error).message?.split("\n")[0] ?? "Connection rejected"); }
    setBusy(null);
  };

  return (
    <>
      <div className={`scrim ${open ? "on" : ""}`} onClick={onClose} />
      <aside className={`drawer ${open ? "on" : ""}`} aria-hidden={!open}>
        <div className="drawer-head">
          <span className="eyebrow">Wallets</span>
          <button className="x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className="drawer-lede">Connect one wallet per ecosystem. Source and destination can use different wallets, e.g. Phantom → MetaMask.</p>
        {ECOS.map(({ e, icon, hint }) => {
          const c = connected[e];
          const opts = options.filter((o) => o.ecosystem === e);
          return (
            <section key={e} className={`eco ${c ? "is-on" : ""}`}>
              <div className="eco-head">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={icon} alt="" width={22} height={22} />
                <b>{ECOSYSTEM_LABEL[e]}</b>
                {c && <span className="pill ok">Connected</span>}
              </div>
              {c ? (
                <div className="eco-acct">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {c.icon && <img src={c.icon} alt="" width={20} height={20} />}
                  <span className="mono">{short(c.address)}</span>
                  <span className="muted">{c.name}</span>
                  <button className="link" onClick={() => disconnect(e)}>Disconnect</button>
                </div>
              ) : opts.length ? (
                <div className="eco-opts">
                  {opts.map((o) => (
                    <button key={o.id} className="opt" disabled={!!busy} onClick={() => go(o.id)}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {o.icon ? <img src={o.icon} alt="" width={20} height={20} /> : <span className="opt-dot" />}
                      {o.name}
                      <span className="muted">{busy === o.id ? "…" : "→"}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="eco-none">No {ECOSYSTEM_LABEL[e]} wallet detected. Try {hint}</div>
              )}
            </section>
          );
        })}
        {err && <div className="err">{err}</div>}
      </aside>
    </>
  );
}
