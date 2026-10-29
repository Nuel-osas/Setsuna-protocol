"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { usdcBalance } from "@/lib/balance";
import { type Transfer, emptySteps, loadTransfers, quoteBps, runTransfer, type StepKey } from "@/lib/bridge";
import { type Chain, type Network, ECOSYSTEM_LABEL, chainsFor, findChain } from "@/lib/chains";
import { short, useWallets } from "@/lib/wallets";
import { ChainIcon, ChainPicker } from "./ChainPicker";
import { RouteViz } from "./RouteViz";
import { WalletChips, WalletDrawer } from "./WalletDrawer";

const STEPS: { key: StepKey; label: string; hint: (t: Transfer, f: Chain, d: Chain) => string }[] = [
  { key: "approve", label: "Approve USDC", hint: () => "Let the TokenMessenger burn it" },
  { key: "burn", label: "Burn", hint: (_, f) => `depositForBurn on ${f.name}` },
  { key: "attest", label: "Circle attestation", hint: (t) => (t.speed === "FAST" ? "Fast: soft finality, seconds" : "Standard: waits for hard finality") },
  { key: "mint", label: "Mint", hint: (_, __, d) => `receiveMessage on ${d.name}` },
];

const fmt = (base: bigint, dp = 2) =>
  Number(formatUnits(base, 6)).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });

function eta(speed: "FAST" | "SLOW", src: Chain) {
  if (!src.fast) return "~10–30s";
  if (speed === "FAST") return src.family === "solana" ? "~10s" : "~8–20s";
  return src.family === "ethereum" ? "~13–19 min" : src.ecosystem === "solana" ? "~25s" : "~15–20 min";
}

function Mark() {
  return (
    <svg width="26" height="26" viewBox="0 0 64 64" aria-hidden="true">
      <g transform="translate(0 3)" fill="var(--blue-l)">
        <path d="M32 8 A24 24 0 0 0 32 56 C24 44 40 20 32 8 Z" transform="translate(-1.7 0)" />
        <path d="M32 8 C40 20 24 44 32 56 A24 24 0 0 0 32 8 Z" transform="translate(1.7 -6)" />
      </g>
    </svg>
  );
}

export function Bridge() {
  const { connected } = useWallets();
  const [drawer, setDrawer] = useState(false);
  const [net, setNet] = useState<Network>("testnet");
  const chains = useMemo(() => chainsFor(net), [net]);
  const [fromF, setFromF] = useState("base");
  const [toF, setToF] = useState("solana");
  const from = findChain(net, fromF);
  const to = findChain(net, toF);
  const [amount, setAmount] = useState("");
  const [speed, setSpeed] = useState<"FAST" | "SLOW">("FAST");
  const [recipient, setRecipient] = useState("");
  const [bps, setBps] = useState<{ fast: number | null; slow: number } | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [active, setActive] = useState<Transfer | null>(null);
  const [history, setHistory] = useState<Transfer[]>([]);
  const [now, setNow] = useState(0);

  const srcWallet = connected[from.ecosystem];
  const dstWallet = connected[to.ecosystem];

  useEffect(() => setHistory(loadTransfers()), []);
  useEffect(() => { setBps(null); quoteBps(net, from.domain, to.domain).then(setBps); }, [net, from.domain, to.domain]);

  const refreshBalance = useCallback(() => {
    setBalance(null);
    if (srcWallet) usdcBalance(from, srcWallet.address).then(setBalance);
  }, [from, srcWallet]);
  useEffect(refreshBalance, [refreshBalance]);

  const live = active?.state === "live";
  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [live]);

  const fastOk = from.fast && !(bps && bps.fast === null);
  const effSpeed = fastOk ? speed : "SLOW";
  const feeBps = effSpeed === "FAST" ? bps?.fast ?? 0 : bps?.slow ?? 0;
  const base = useMemo(() => { try { return amount ? parseUnits(amount, 6) : 0n; } catch { return 0n; } }, [amount]);
  const fee = (base * BigInt(Math.ceil(feeBps * 100))) / 1_000_000n;
  const dest = recipient || dstWallet?.address || "";

  const an = (e: string) => (/^[AEIOU]/.test(ECOSYSTEM_LABEL[e as keyof typeof ECOSYSTEM_LABEL]) ? "an" : "a");
  const needs: string | null =
    !from.bridgeable || !to.bridgeable ? `${!from.bridgeable ? from.name : to.name} routes are coming soon`
    : !srcWallet ? `Connect ${an(from.ecosystem)} ${ECOSYSTEM_LABEL[from.ecosystem]} wallet`
    : !dstWallet ? `Connect ${an(to.ecosystem)} ${ECOSYSTEM_LABEL[to.ecosystem]} wallet to mint`
    : base === 0n ? "Enter an amount"
    : balance !== null && base > balance ? "Not enough USDC"
    : null;
  const needsWallet = !!needs && needs.startsWith("Connect");

  const start = async (resume?: Transfer) => {
    if (!resume && needs) return;
    const t: Transfer = resume ? { ...resume, error: undefined } : {
      id: crypto.randomUUID(), network: net, from: from.family, to: to.family, amount, speed: effSpeed,
      sender: srcWallet!.address, recipient: dest, steps: emptySteps(), state: "live", createdAt: Date.now(),
    };
    const f = findChain(t.network, t.from);
    const d = findChain(t.network, t.to);
    const fw = connected[f.ecosystem];
    const dw = connected[d.ecosystem];
    if (!fw || !dw) { setDrawer(true); return; }
    setActive(t);
    await runTransfer(t, { chain: f, wallet: fw }, { chain: d, wallet: dw }, (x) => { setActive(x); setHistory(loadTransfers()); });
    refreshBalance();
  };

  const flip = () => { setFromF(toF); setToF(fromF); };
  const pick = (side: "from" | "to") => (c: Chain) => {
    if (side === "from") { if (c.family === toF) setToF(fromF); setFromF(c.family); }
    else { if (c.family === fromF) setFromF(toF); setToF(c.family); }
  };

  const elapsed = active ? ((active.doneAt ?? (now || active.createdAt)) - active.createdAt) / 1000 : 0;
  const af = active ? findChain(active.network, active.from) : from;
  const ad = active ? findChain(active.network, active.to) : to;

  return (
    <>
      <header className="hdr">
        <a className="brand" href="#"><Mark /><b>setsuna</b><span>/ bridge</span></a>
        <div className="hdr-right">
          <div className="seg" role="group" aria-label="Network">
            {(["testnet", "mainnet"] as const).map((n) => (
              <button key={n} aria-pressed={net === n} onClick={() => setNet(n)}>{n}</button>
            ))}
          </div>
          <WalletChips onOpen={() => setDrawer(true)} />
        </div>
      </header>
      <WalletDrawer open={drawer} onClose={() => setDrawer(false)} />

      <main className="shell">
        <section className="stage">
          <div className="stage-copy">
            <span className="eyebrow">Circle CCTP V2 · {chains.filter((c) => c.bridgeable).length} chains · native USDC</span>
            <h1>Move USDC <em>anywhere</em></h1>
          </div>

          <div className="panel swap">
            {!active ? (
              <>
                <div className="panel-head">
                  <span className="eyebrow">Bridge</span>
                  <span className={`net ${net}`}>{net === "testnet" ? "Sandbox" : "Mainnet · real funds"}</span>
                </div>
                <div className="panel-body">
                  <ChainPicker label="From" value={from} other={to} chains={chains} onChange={pick("from")}
                    balance={srcWallet ? (balance !== null ? `${fmt(balance)} USDC` : "…") : undefined} />

                  <div className="amount">
                    <div className="amount-row">
                      <input inputMode="decimal" placeholder="0.00" value={amount} aria-label="Amount"
                        onChange={(e) => /^\d*\.?\d{0,6}$/.test(e.target.value) && setAmount(e.target.value)} />
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <span className="token"><img src="/icons/usdc.svg" alt="" width={20} height={20} />USDC</span>
                    </div>
                    <div className="amount-foot">
                      <span>{srcWallet ? `${short(srcWallet.address)} on ${from.name}` : "Wallet not connected"}</span>
                      <span className="pcts">
                        {balance !== null && balance > 0n && [25, 50, 100].map((p) => (
                          <button key={p} onClick={() => setAmount(formatUnits((balance * BigInt(p)) / 100n, 6))}>{p === 100 ? "Max" : `${p}%`}</button>
                        ))}
                      </span>
                    </div>
                  </div>

                  <div className="flip-row"><button className="flip" onClick={flip} aria-label="Swap direction">⇅</button></div>

                  <ChainPicker label="To" value={to} other={from} chains={chains} onChange={pick("to")}
                    balance={dstWallet ? short(dstWallet.address) : undefined} />

                  <div className="receive">
                    <span>You receive</span>
                    <b className="pixel">{fmt(base > fee ? base - fee : 0n)}</b>
                    <span>USDC on {to.name}</span>
                  </div>

                  <div className="speeds">
                    <button className="speed" aria-pressed={effSpeed === "FAST"} disabled={!fastOk} onClick={() => setSpeed("FAST")}>
                      <div className="k">Fast</div>
                      <div className="t">{fastOk ? eta("FAST", from) : "—"}</div>
                      <div className="f">{!from.fast ? `${from.name} is already fast` : !fastOk ? "No fast route here" : bps?.fast != null ? `${bps.fast} bps` : "…"}</div>
                    </button>
                    <button className="speed" aria-pressed={effSpeed === "SLOW"} onClick={() => setSpeed("SLOW")}>
                      <div className="k">Standard</div>
                      <div className="t">{eta("SLOW", from)}</div>
                      <div className="f">{bps?.slow ? `${bps.slow} bps` : "Free"}</div>
                    </button>
                  </div>

                  <details className="recip">
                    <summary>Send to another address</summary>
                    <input placeholder={dstWallet?.address ?? `${ECOSYSTEM_LABEL[to.ecosystem]} address`} value={recipient} onChange={(e) => setRecipient(e.target.value.trim())} />
                  </details>

                  <div className="lines">
                    <div><span>Fee</span><b>{fmt(fee, 4)} USDC</b></div>
                    <div><span>Recipient</span><b>{dest ? short(dest) : "—"}</b></div>
                    <div><span>Signatures</span><b>{from.ecosystem === "evm" ? "approve · burn" : "burn"} · mint</b></div>
                  </div>

                  {needsWallet
                    ? <button className="btn big" onClick={() => setDrawer(true)}>{needs} <span className="arrow">→</span></button>
                    : <button className="btn big" disabled={!!needs} onClick={() => start()}>{needs ?? `Bridge to ${to.name}`} {!needs && <span className="arrow">→</span>}</button>}
                </div>
              </>
            ) : (
              <>
                <div className="panel-head">
                  <span className="eyebrow">{active.state === "done" ? "Landed" : active.state === "error" ? "Paused" : "In flight"}</span>
                  <span className="pill live">{active.speed === "FAST" ? "fast" : "standard"}</span>
                </div>
                <div className="panel-body">
                  <div className="flight">
                    <div>
                      <div className="flight-amt pixel">{Number(active.amount).toLocaleString()} <small>USDC</small></div>
                      <div className="flight-route"><ChainIcon c={af} size={22} /> {af.name} <span>→</span> <ChainIcon c={ad} size={22} /> {ad.name}</div>
                    </div>
                    <div className="timer">{elapsed.toFixed(1)}<small>s</small></div>
                  </div>
                  <div className="steps">
                    {STEPS.map((s) => {
                      const st = active.steps[s.key];
                      return (
                        <div key={s.key} className={`stp is-${st.state}`}>
                          <span className="dot" />
                          <div>{s.label}<small>{st.state === "skip" ? "Not needed" : s.hint(active, af, ad)}</small></div>
                          {st.url ? <a href={st.url} target="_blank" rel="noreferrer">tx ↗</a> : <span />}
                        </div>
                      );
                    })}
                  </div>
                  {active.state === "error" && (
                    <>
                      <div className="err">{active.error}</div>
                      <div className="row-btns">
                        <button className="btn" onClick={() => start(active)}>Retry</button>
                        <button className="btn ghost" onClick={() => setActive(null)}>Close</button>
                      </div>
                    </>
                  )}
                  {active.state === "done" && (
                    <>
                      <div className="done-banner">{Number(active.amount).toLocaleString()} USDC landed on {ad.name} in {elapsed.toFixed(1)}s.</div>
                      <button className="btn ghost big" onClick={() => { setActive(null); setAmount(""); }}>New transfer</button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="stage-side">
            <RouteViz from={af.short} to={ad.short} fromHue={af.hue} toHue={ad.hue} live={live} />
            <dl className="stats">
              <div><dt>Live chains</dt><dd>{chains.filter((c) => c.bridgeable).length}<small>/ {chains.length}</small></dd></div>
              <div><dt>Fast fee</dt><dd>{bps?.fast ?? "—"}<small>bps</small></dd></div>
              <div><dt>Ecosystems</dt><dd>6</dd></div>
            </dl>
          </div>
        </section>

        <div className="ticker" aria-hidden="true">
          <div className="ticker-track">
            {[...chains, ...chains].map((c, i) => (
              <span key={i} className={c.bridgeable ? "" : "is-soon"}><ChainIcon c={c} size={20} />{c.name}</span>
            ))}
          </div>
        </div>

        <section className="section">
          <span className="eyebrow">Your transfers</span>
          <h2>History</h2>
          <div className="table">
            {history.length === 0 ? (
              <div className="empty">No transfers yet. They&apos;re kept in this browser, so you can resume one that stopped.</div>
            ) : (
              <table>
                <thead><tr><th>Route</th><th>Amount</th><th>Speed</th><th>Status</th><th>When</th><th /></tr></thead>
                <tbody>
                  {history.map((t) => {
                    const f = findChain(t.network, t.from);
                    const d = findChain(t.network, t.to);
                    return (
                      <tr key={t.id}>
                        <td><span className="hroute"><ChainIcon c={f} size={20} />→<ChainIcon c={d} size={20} /></span></td>
                        <td className="mono">{Number(t.amount).toLocaleString()}</td>
                        <td className="mono small">{t.speed === "FAST" ? "fast" : "standard"}{t.network === "testnet" ? " · test" : ""}</td>
                        <td>{t.state === "done" ? <span className="pill ok">Landed</span> : t.state === "error" ? <span className="pill bad">Paused</span> : <span className="pill live">Live</span>}</td>
                        <td className="mono small muted">{new Date(t.createdAt).toLocaleString()}</td>
                        <td>{t.state === "error" && t.result != null && <button className="btn ghost tiny" onClick={() => start(t)}>Resume</button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <footer className="foot">
          <span>Circle CCTP V2 via Bridge Kit · TokenMessengerV2 · MessageTransmitterV2</span>
          <span>{net === "testnet" ? "Test USDC: faucet.circle.com" : "Mainnet: real funds"}</span>
        </footer>
      </main>
    </>
  );
}
