"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { usdcBalance } from "@/lib/balance";
import { type Transfer, checkTransfer, emptySteps, loadTransfers, quoteBps, runTransfer, saveTransfer, type StepKey } from "@/lib/bridge";
import { type ClaimCost, type ForwardQuote, SEND_GAS, canForward, claimCost, fmtNative, fmtUsd, forwardQuote, gasBalance } from "@/lib/claim";
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
  // Off until the user turns it on.
  const [gasInUsdc, setGasInUsdc] = useState(false);
  const [fq, setFq] = useState<ForwardQuote | null>(null);
  const [cost, setCost] = useState<ClaimCost | null>(null);
  const [dstGas, setDstGas] = useState<bigint | null>(null);
  const [srcCost, setSrcCost] = useState<ClaimCost | null>(null);
  const [srcGas, setSrcGas] = useState<bigint | null>(null);
  const [ack, setAck] = useState(false);
  const [costs, setCosts] = useState<Record<string, string>>({});

  const srcWallet = connected[from.ecosystem];
  const dstWallet = connected[to.ecosystem];

  // Stored transfers that aren't done may have been delivered, claimed or landed since: re-check once.
  useEffect(() => {
    const all = loadTransfers();
    setHistory(all);
    Promise.all(all.filter((t) => t.state !== "done").map(checkTransfer)).then((updated) => {
      const changed = updated.filter((u): u is Transfer => !!u);
      if (!changed.length) return;
      changed.forEach(saveTransfer);
      setHistory(loadTransfers());
    });
  }, []);
  useEffect(() => { setBps(null); quoteBps(net, from.domain, to.domain).then(setBps); }, [net, from.domain, to.domain]);
  const forwardable = canForward(from, to);
  useEffect(() => {
    setFq(null);
    if (forwardable) forwardQuote(net, from.domain, to.domain).then(setFq);
  }, [net, from.domain, to.domain, forwardable]);
  useEffect(() => { setCost(null); claimCost(to).then(setCost); }, [to]);
  useEffect(() => { setSrcCost(null); claimCost(from, SEND_GAS).then(setSrcCost); }, [from]);
  useEffect(() => {
    setSrcGas(null);
    setAck(false);
    if (srcWallet) gasBalance(from, srcWallet.address).then(setSrcGas);
  }, [from, srcWallet]);
  useEffect(() => {
    setDstGas(null);
    setAck(false);
    if (dstWallet) gasBalance(to, dstWallet.address).then(setDstGas);
  }, [to, dstWallet]);

  // Delivery cost per destination, for the To picker: Circle's fee where it delivers, else the claim gas.
  const loadCosts = useCallback(() => {
    setCosts({});
    for (const c of chains.filter((x) => x.bridgeable && x.family !== from.family)) {
      (canForward(from, c) ? forwardQuote(net, from.domain, c.domain) : Promise.resolve(null)).then(async (q) => {
        const label = q ? `delivery ${fmtUsd(Number(q.fee) / 1e6)}` : await claimCost(c).then((k) => (k ? `claim gas ~${fmtUsd(k.usd) ?? fmtNative(k.native, k.decimals) + " " + k.symbol}` : ""));
        if (label) setCosts((m) => ({ ...m, [c.family]: label }));
      });
    }
  }, [chains, from, net]);

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
  const deliver = forwardable && gasInUsdc;
  const feeBps = deliver ? (effSpeed === "FAST" ? fq?.fastBps ?? 0 : fq?.slowBps ?? 0) : effSpeed === "FAST" ? bps?.fast ?? 0 : bps?.slow ?? 0;
  const base = useMemo(() => { try { return amount ? parseUnits(amount, 6) : 0n; } catch { return 0n; } }, [amount]);
  const deliveryFee = deliver ? fq?.fee ?? 0n : 0n;
  const fee = (base * BigInt(Math.ceil(feeBps * 100))) / 1_000_000n + deliveryFee;
  const dest = recipient || dstWallet?.address || "";
  // Claiming yourself needs gas on the destination; flag it before anything is burned.
  const shortGas = !deliver && !!cost && dstGas !== null && dstGas < cost.native;
  // Sending needs gas on the source chain too; without it some wallets take the gas from the USDC.
  const srcShort = !!srcCost && srcGas !== null && srcGas < srcCost.native;

  const an = (e: string) => (/^[AEIOU]/.test(ECOSYSTEM_LABEL[e as keyof typeof ECOSYSTEM_LABEL]) ? "an" : "a");
  const needs: string | null =
    !from.bridgeable || !to.bridgeable ? `${!from.bridgeable ? from.name : to.name} routes are coming soon`
    : !srcWallet ? `Connect ${an(from.ecosystem)} ${ECOSYSTEM_LABEL[from.ecosystem]} wallet`
    : deliver && !dest ? `Add a recipient on ${to.name}`
    : !deliver && !dstWallet ? `Connect ${an(to.ecosystem)} ${ECOSYSTEM_LABEL[to.ecosystem]} wallet to mint`
    : base === 0n ? "Enter an amount"
    : balance !== null && base > balance ? "Not enough USDC"
    : deliver && !fq ? "Getting Circle's delivery fee…"
    : deliver && base <= fee ? "Amount is below the delivery fee"
    : srcShort && !ack ? `Not enough ${srcCost!.symbol} on ${from.name} to send`
    : shortGas && !ack ? `Not enough ${cost!.symbol} on ${to.name} to claim`
    : null;
  const needsWallet = !!needs && needs.startsWith("Connect");

  const start = async (resume?: Transfer) => {
    if (!resume && needs) return;
    const t: Transfer = resume ? { ...resume, error: undefined } : {
      id: crypto.randomUUID(), network: net, from: from.family, to: to.family, amount, speed: effSpeed,
      sender: srcWallet!.address, recipient: dest, steps: emptySteps(), state: "live", createdAt: Date.now(),
      gasInUsdc: deliver,
    };
    const f = findChain(t.network, t.from);
    const d = findChain(t.network, t.to);
    const fw = connected[f.ecosystem];
    const dw = connected[d.ecosystem];
    const claiming = !t.gasInUsdc || !!t.claimMode;
    if (!fw || (claiming && !dw)) { setDrawer(true); return; }
    setActive(t);
    await runTransfer(t, { chain: f, wallet: fw }, { chain: d, wallet: dw ?? undefined }, (x) => { setActive(x); setHistory(loadTransfers()); });
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
                    balance={dstWallet ? short(dstWallet.address) : undefined} costs={costs} onOpen={loadCosts} />

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

                  <button type="button" className="gas-toggle" role="switch" aria-checked={deliver} disabled={!forwardable}
                    onClick={() => setGasInUsdc(!gasInUsdc)}>
                    <span className="knob" />
                    <span className="gt-copy">
                      <b>Pay gas in USDC</b>
                      <small>
                        {!forwardable
                          ? `Circle can't deliver ${from.ecosystem === "aptos" ? "from Aptos" : `to ${to.name}`}. You claim with ${cost?.symbol ?? "gas"} on ${to.name}.`
                          : deliver
                            ? `Circle delivers to ${to.name} for ${fq ? fmtUsd(Number(fq.fee) / 1e6) : "…"} in USDC. No ${cost?.symbol ?? "gas"} needed.`
                            : `You claim on ${to.name} with your own ${cost?.symbol ?? "gas"}${cost ? `, about ${fmtUsd(cost.usd) ?? `${fmtNative(cost.native, cost.decimals)} ${cost.symbol}`} now` : ""}.`}
                      </small>
                    </span>
                  </button>

                  {srcShort && (
                    <div className="warn">
                      <p>
                        Sending from {from.name} costs about <b>{fmtNative(srcCost!.native, srcCost!.decimals)} {srcCost!.symbol}</b>
                        {fmtUsd(srcCost!.usd) ? ` (${fmtUsd(srcCost!.usd)})` : ""} in gas right now, and your wallet there has{" "}
                        <b>{fmtNative(srcGas!, srcCost!.decimals)} {srcCost!.symbol}</b>. Some wallets then pay the gas out of your USDC, which leaves less to send.
                      </p>
                      {!shortGas && <label><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> Continue anyway</label>}
                    </div>
                  )}

                  {shortGas && (
                    <div className="warn">
                      <p>
                        Claiming on {to.name} costs about <b>{fmtNative(cost!.native, cost!.decimals)} {cost!.symbol}</b>
                        {fmtUsd(cost!.usd) ? ` (${fmtUsd(cost!.usd)})` : ""} right now, and your wallet there has{" "}
                        <b>{fmtNative(dstGas!, cost!.decimals)} {cost!.symbol}</b>. The burn can&apos;t be undone, so the USDC would wait until you add {cost!.symbol}.
                        {forwardable ? <> Or turn on <b>Pay gas in USDC</b> above and Circle delivers it{fq ? ` for ${fmtUsd(Number(fq.fee) / 1e6)}` : ""}.</> : null}
                      </p>
                      <label><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I&apos;ll add {cost!.symbol} before claiming</label>
                    </div>
                  )}

                  <details className="recip">
                    <summary>Send to another address</summary>
                    <input placeholder={dstWallet?.address ?? `${ECOSYSTEM_LABEL[to.ecosystem]} address`} value={recipient} onChange={(e) => setRecipient(e.target.value.trim())} />
                  </details>

                  <div className="lines">
                    <div><span>{deliver ? "Fee incl. delivery" : "Fee"}</span><b>{fmt(fee, 4)} USDC</b></div>
                    <div><span>Recipient</span><b>{dest ? short(dest) : "—"}</b></div>
                    <div><span>Signatures</span><b>{from.ecosystem === "evm" ? "approve + burn" : "burn"}{deliver ? "" : " · mint"}</b></div>
                  </div>

                  {needsWallet
                    ? <button className="btn big" onClick={() => setDrawer(true)}>{needs} <span className="arrow">→</span></button>
                    : <button className="btn big" disabled={!!needs} onClick={() => start()}>{needs ?? `Bridge to ${to.name}`} {!needs && <span className="arrow">→</span>}</button>}
                </div>
              </>
            ) : (
              <>
                <div className="panel-head">
                  <span className="eyebrow">{active.state === "done" ? "Landed" : active.state === "error" ? "Paused" : active.state === "claim" ? "Ready to claim" : active.state === "waiting" ? "Queued" : "In flight"}</span>
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
                  {active.state === "claim" && (
                    <ClaimChoice t={active} to={ad} wallet={connected[ad.ecosystem]?.address} onClaim={(mode) => start({ ...active, claimMode: mode })} onConnect={() => setDrawer(true)} />
                  )}
                  {active.state === "waiting" && (
                    <div className="note-box">
                      Your claim is queued on {ad.name} with a low gas cap. It lands by itself when gas dips, usually within hours. You can close this page; it&apos;s tracked in History.
                    </div>
                  )}
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
                      <div className="done-banner">{active.note ? `${active.note}. ` : ""}USDC landed on {ad.name}{active.doneAt ? ` in ${elapsed.toFixed(1)}s` : ""}.</div>
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
                        <td>{t.state === "done" ? <span className="pill ok">Landed</span> : t.state === "error" ? <span className="pill bad">Paused</span> : t.state === "claim" ? <span className="pill live">Ready to claim</span> : t.state === "waiting" ? <span className="pill live">Queued</span> : <span className="pill live">Live</span>}</td>
                        <td className="mono small muted">{new Date(t.createdAt).toLocaleString()}</td>
                        <td>{t.state !== "done" && !!t.steps.burn.tx && <button className="btn ghost tiny" onClick={() => start(t)}>{t.state === "claim" ? "Claim" : "Resume"}</button>}</td>
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

// The claim step on an expensive chain: pay today's gas, or queue the claim with a low cap so it lands on a dip.
function ClaimChoice({ t, to, wallet, onClaim, onConnect }: {
  t: Transfer; to: Chain; wallet?: string; onClaim: (mode: "now" | "cheap") => void; onConnect: () => void;
}) {
  const [cost, setCost] = useState<ClaimCost | null>(null);
  const [gas, setGas] = useState<bigint | null>(null);
  useEffect(() => { claimCost(to).then(setCost); }, [to]);
  useEffect(() => { if (wallet) gasBalance(to, wallet).then(setGas); }, [to, wallet]);
  const price = cost ? fmtUsd(cost.usd) ?? `${fmtNative(cost.native, cost.decimals)} ${cost.symbol}` : "…";
  return (
    <div className="claim-box">
      <p>
        {t.note ? `${t.note} ` : ""}Your USDC is ready on {to.name}. Claiming sends one transaction there
        {cost?.gwei ? ` (gas is ${cost.gwei.toFixed(1)} gwei now)` : ""}. Nothing expires, so you can also come back later from History.
      </p>
      {wallet && cost && gas !== null && gas < cost.native && (
        <p className="warn-line">Your wallet on {to.name} has {fmtNative(gas, cost.decimals)} {cost.symbol}. Add {cost.symbol} first.</p>
      )}
      {!wallet ? (
        <button className="btn big" onClick={onConnect}>Connect a wallet on {to.name} <span className="arrow">→</span></button>
      ) : (
        <div className="row-btns">
          <button className="btn" onClick={() => onClaim("now")}>Claim now · ~{price}</button>
          <button className="btn ghost" onClick={() => onClaim("cheap")}>Claim cheaper · waits for a dip</button>
        </div>
      )}
    </div>
  );
}
