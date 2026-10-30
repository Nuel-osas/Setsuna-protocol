"use client";

import { BridgeKit } from "@circle-fin/bridge-kit";
import { createPublicClient, http } from "viem";
import { type Chain, type Network, findChain } from "./chains";
import { FORWARD_HOOK, cheapFees, forwardQuote, irisMessage, messageUsed } from "./claim";
import { AlreadyMinted, burn, mint, waitForAttestation } from "./legs";
import type { Connected } from "./wallets";

// Bridge Kit drives approve → burn → attestation → mint for every EVM and Solana route.
// We turn its events into a resumable record for the tracker and history.

export type StepKey = "approve" | "burn" | "attest" | "mint";
export type StepState = "idle" | "live" | "done" | "skip" | "error";

export type Transfer = {
  id: string;
  network: Network;
  from: string; // chain family
  to: string;
  amount: string; // decimal USDC
  speed: "FAST" | "SLOW";
  sender: string;
  recipient: string;
  steps: Record<StepKey, { state: StepState; tx?: string; url?: string }>;
  /** Circle's Forwarding Service mints on the destination; its fee comes out of the USDC. */
  gasInUsdc?: boolean;
  /** How a self-claim on an expensive chain is paid: at today's price, or capped to wait for a dip. */
  claimMode?: "now" | "cheap";
  note?: string;
  // claim: attested, waiting for the user to choose how to claim. waiting: claim sent, queued for cheaper gas.
  state: "live" | "claim" | "waiting" | "done" | "error";
  error?: string;
  result?: unknown; // Bridge Kit's BridgeResult, kept for kit.retry
  createdAt: number;
  doneAt?: number;
};

const KEY = "setsuna-bridge:v2:transfers";

export function loadTransfers(): Transfer[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; }
}

export function saveTransfer(t: Transfer) {
  try {
    const all = loadTransfers().filter((x) => x.id !== t.id);
    localStorage.setItem(KEY, JSON.stringify([t, ...all].slice(0, 50), (_, v) => (typeof v === "bigint" ? v.toString() : v)));
  } catch {}
}

const kit = new BridgeKit();

// Bridge Kit's adapter factories pull in chain SDKs, so load them only when a transfer starts.
async function adapterFor(w: Connected) {
  if (w.ecosystem === "evm" && w.evm) {
    const { createViemAdapterFromProvider } = await import("@circle-fin/adapter-viem-v2");
    return createViemAdapterFromProvider({ provider: w.evm as never });
  }
  if (w.ecosystem === "solana" && w.solana) {
    const { createSolanaAdapterFromProvider } = await import("@circle-fin/adapter-solana");
    return createSolanaAdapterFromProvider({ provider: w.solana as never });
  }
  throw new Error(`Bridging from ${w.ecosystem} isn't wired up yet`);
}

const METHOD: Record<string, StepKey> = { approve: "approve", burn: "burn", fetchAttestation: "attest", mint: "mint" };
const ORDER: StepKey[] = ["approve", "burn", "attest", "mint"];

type Emit = (t: Transfer) => void;

function patch(t: Transfer, p: Partial<Transfer>, emit: Emit) {
  Object.assign(t, p);
  saveTransfer(t);
  emit(structuredClone({ ...t, result: undefined, }) as Transfer);
}

function markLive(t: Transfer, k: StepKey) {
  const i = ORDER.indexOf(k);
  ORDER.forEach((s, j) => {
    if (j < i && t.steps[s].state === "idle") t.steps[s].state = "skip";
  });
  if (t.steps[k].state === "idle") t.steps[k].state = "live";
}

function absorbResult(t: Transfer, result: { state: string; steps?: { name: string; state: string; txHash?: string; explorerUrl?: string; error?: unknown }[] }) {
  for (const s of result.steps ?? []) {
    const n = s.name.toLowerCase();
    const k: StepKey | undefined = n.includes("approv") ? "approve" : n.includes("burn") ? "burn" : n.includes("attest") ? "attest" : n.includes("mint") ? "mint" : undefined;
    if (!k) continue;
    t.steps[k] = {
      state: s.state === "success" ? "done" : s.state === "noop" ? "skip" : s.state === "error" ? "error" : t.steps[k].state,
      tx: s.txHash ?? t.steps[k].tx,
      url: s.explorerUrl ?? t.steps[k].url,
    };
  }
}

// Bridge Kit runs Solana-sourced routes to EVM and Solana. Everything else uses our own legs, which
// let the bridge pause before an expensive claim, cap its gas, and notice a mint someone else sent.
const viaKit = (from: Chain, to: Chain) => from.ecosystem === "solana" && (to.ecosystem === "evm" || to.ecosystem === "solana");

// Only Ethereum mainnet claims cost enough to be worth offering a cheaper, slower claim.
const askHowToClaim = (c: Chain) => c.ecosystem === "evm" && c.family === "ethereum";

export async function runTransfer(
  t: Transfer,
  from: { chain: Chain; wallet: Connected },
  to: { chain: Chain; wallet?: Connected },
  emit: Emit,
) {
  return viaKit(from.chain, to.chain) ? runKit(t, from, to, emit) : runCustom(t, from, to, emit);
}

function landed(t: Transfer, to: Chain, emit: Emit, tx?: string, note?: string) {
  ORDER.forEach((k) => { if (t.steps[k].state === "live" || t.steps[k].state === "idle") t.steps[k].state = k === "approve" ? "skip" : "done"; });
  t.steps.mint = { state: "done", tx: tx ?? t.steps.mint.tx, url: tx ? txUrlFor(to, tx) : t.steps.mint.url };
  patch(t, { state: "done", doneAt: t.doneAt ?? Date.now(), note, error: undefined }, emit);
}

// Our own legs: burn, attestation from Iris, then either Circle's forwarded mint or the user's claim.
// Resumable per step.
async function runCustom(
  t: Transfer,
  from: { chain: Chain; wallet: Connected },
  to: { chain: Chain; wallet?: Connected },
  emit: Emit,
) {
  const amount = BigInt(Math.round(Number(t.amount) * 1e6));
  try {
    patch(t, { state: "live", error: undefined }, emit);
    if (!t.steps.burn.tx) {
      let fast = t.speed === "FAST" && from.chain.fast;
      markLive(t, from.chain.ecosystem === "evm" ? "approve" : "burn");
      patch(t, {}, emit);
      let maxFee = 0n;
      let hookData: `0x${string}` | undefined;
      if (t.gasInUsdc) {
        // Fees come out of the amount: the recipient gets amount - (Circle's delivery fee + protocol fee).
        const q = await forwardQuote(t.network, from.chain.domain, to.chain.domain);
        if (!q) throw new Error(`Circle can't deliver to ${to.chain.name} right now. Turn off "Pay gas in USDC" to claim it yourself.`);
        if (fast && q.fastBps === null) fast = false;
        const bps = fast ? q.fastBps! : q.slowBps;
        maxFee = q.fee + (amount * BigInt(Math.ceil(bps * 125)) + 999_999n) / 1_000_000n;
        if (maxFee >= amount) throw new Error("The amount is too small to cover Circle's delivery fee.");
        hookData = FORWARD_HOOK;
      } else if (fast) {
        const q = await quoteBps(t.network, from.chain.domain, to.chain.domain);
        maxFee = q?.fast ? (amount * BigInt(Math.ceil(q.fast * 125)) + 999_999n) / 1_000_000n : 0n;
      }
      const tx = await burn({
        network: t.network, chain: from.chain, wallet: from.wallet, amount, dest: to.chain, recipient: t.recipient,
        maxFee, finality: fast ? 1000 : 2000, hookData,
        onApproved: (approveTx) => {
          t.steps.approve = approveTx ? { state: "done", tx: approveTx, url: txUrlFor(from.chain, approveTx) } : { state: "skip" };
          markLive(t, "burn");
          patch(t, {}, emit);
        },
      });
      t.steps.burn = { state: "done", tx, url: txUrlFor(from.chain, tx) };
      markLive(t, "attest");
      patch(t, {}, emit);
    }
    const fastAtt = t.speed === "FAST" && from.chain.fast;

    // A claim sent earlier and queued for cheaper gas: just wait for it.
    if (t.steps.mint.tx && t.state !== "error" && to.chain.ecosystem === "evm") {
      if (await waitReceipt(to.chain, t.steps.mint.tx)) return landed(t, to.chain, emit);
    }

    const att = await waitForAttestation(t.network, from.chain.domain, t.steps.burn.tx!, fastAtt);
    t.steps.attest = { state: "done" };
    markLive(t, "mint");
    patch(t, { result: att }, emit);

    if (t.gasInUsdc && !t.claimMode) {
      // Circle mints; follow it until the forward transaction shows up (or someone else claims).
      for (let i = 0; i < 360; i++) {
        const m = await irisMessage(t.network, from.chain.domain, t.steps.burn.tx!);
        if (m?.forwardTx) return landed(t, to.chain, emit, m.forwardTx, "Delivered by Circle");
        if (await messageUsed(to.chain, att.message)) return landed(t, to.chain, emit, undefined, "Delivered");
        await new Promise((r) => setTimeout(r, 5000));
      }
      t.steps.mint.state = "idle";
      return patch(t, { state: "claim", note: "Circle hasn't delivered yet. It may still arrive, or you can claim it yourself." }, emit);
    }

    if (await messageUsed(to.chain, att.message)) return landed(t, to.chain, emit, undefined, "Already minted");
    if (askHowToClaim(to.chain) && !t.claimMode) {
      t.steps.mint.state = "idle";
      return patch(t, { state: "claim" }, emit);
    }
    if (!to.wallet) throw new Error(`Connect a wallet on ${to.chain.name} to claim.`);
    const fees = t.claimMode === "cheap" && to.chain.ecosystem === "evm" ? await cheapFees(to.chain) : undefined;
    const mintTx = await mint({
      network: t.network, chain: to.chain, wallet: to.wallet, source: from.chain, ...att, fees,
      onSent: (hash) => {
        t.steps.mint = { state: "live", tx: hash, url: txUrlFor(to.chain, hash) };
        patch(t, { state: fees ? "waiting" : "live" }, emit);
      },
    });
    landed(t, to.chain, emit, mintTx);
  } catch (e) {
    if (e instanceof AlreadyMinted) return landed(t, to.chain, emit, undefined, "Already minted");
    const err = e as { shortMessage?: string; message?: string };
    (["approve", "burn", "attest", "mint"] as StepKey[]).forEach((k) => { if (t.steps[k].state === "live") t.steps[k].state = "error"; });
    patch(t, { state: "error", error: (err.shortMessage ?? err.message ?? "Something went wrong").split("\n")[0] }, emit);
  }
}

async function waitReceipt(c: Chain, hash: string, timeout = 86_400_000) {
  if (!c.rpc) return false;
  try {
    const rc = await createPublicClient({ transport: http(c.rpc) }).waitForTransactionReceipt({ hash: hash as `0x${string}`, timeout, pollingInterval: 15_000 });
    return rc.status === "success";
  } catch {
    return false;
  }
}

async function receiptNow(c: Chain, hash: string) {
  if (!c.rpc) return false;
  try {
    const rc = await createPublicClient({ transport: http(c.rpc) }).getTransactionReceipt({ hash: hash as `0x${string}` });
    return rc.status === "success";
  } catch {
    return false;
  }
}

/**
 * Re-check a stored transfer that isn't marked done: Circle may have delivered it, a queued claim may
 * have landed, or someone else may have claimed it. Returns the updated transfer, or null if unchanged.
 */
export async function checkTransfer(t: Transfer): Promise<Transfer | null> {
  if (t.state === "done" || !t.steps.burn.tx) return null;
  const f = findChain(t.network, t.from);
  const d = findChain(t.network, t.to);
  const u = structuredClone({ ...t, result: undefined }) as Transfer;
  u.result = t.result;
  const quiet: Emit = () => {};
  if (u.steps.mint.tx && d.ecosystem === "evm" && (await receiptNow(d, u.steps.mint.tx))) {
    landed(u, d, quiet);
    return u;
  }
  const m = await irisMessage(t.network, f.domain, t.steps.burn.tx);
  if (!m?.ready) return null;
  if (m.forwardTx) {
    landed(u, d, quiet, m.forwardTx, "Delivered by Circle");
    return u;
  }
  if (await messageUsed(d, m.message)) {
    landed(u, d, quiet, undefined, "Already minted");
    return u;
  }
  return null;
}

const txUrlFor = (c: Chain, hash: string) => c.explorer?.replace("{hash}", hash);

async function runKit(
  t: Transfer,
  from: { chain: Chain; wallet: Connected },
  to: { chain: Chain; wallet?: Connected },
  emit: Emit,
) {
  const off = (handler: (e: { method: string; values?: { txHash?: string; explorerUrl?: string } }) => void) => {
    kit.on("*", handler as never);
    return () => (kit as unknown as { off?: (n: string, h: unknown) => void }).off?.("*", handler);
  };

  // Each event marks its step done and the next one live.
  const unsubscribe = off((e) => {
    const k = METHOD[e.method];
    if (!k) return;
    t.steps[k] = { state: "done", tx: e.values?.txHash ?? t.steps[k].tx, url: e.values?.explorerUrl ?? t.steps[k].url };
    const next = ORDER[ORDER.indexOf(k) + 1];
    if (next) markLive(t, next);
    patch(t, {}, emit);
  });

  try {
    if (!t.gasInUsdc && !to.wallet) throw new Error(`Connect a wallet on ${to.chain.name} to claim.`);
    const [fromAdapter, toAdapter] = await Promise.all([adapterFor(from.wallet), t.gasInUsdc ? undefined : adapterFor(to.wallet!)]);
    if (t.steps.approve.state === "idle" && t.steps.burn.state === "idle") markLive(t, "approve");
    patch(t, { state: "live", error: undefined }, emit);

    const result = t.result
      ? await kit.retry(t.result as never, { from: fromAdapter, to: toAdapter } as never)
      : await kit.bridge({
          from: { adapter: fromAdapter, chain: from.chain.id },
          to: t.gasInUsdc
            ? { chain: to.chain.id, recipientAddress: t.recipient, useForwarder: true }
            : t.recipient && t.recipient !== to.wallet!.address
              ? { adapter: toAdapter, chain: to.chain.id, recipientAddress: t.recipient }
              : { adapter: toAdapter, chain: to.chain.id },
          amount: t.amount,
          config: { transferSpeed: t.speed },
        } as never);

    absorbResult(t, result as never);
    if ((result as { state: string }).state === "success") {
      ORDER.forEach((k) => { if (t.steps[k].state === "live" || t.steps[k].state === "idle") t.steps[k].state = "done"; });
      patch(t, { state: "done", doneAt: Date.now(), result }, emit);
    } else {
      const failed = (result as { steps?: { state: string; error?: { message?: string } }[] }).steps?.find((s) => s.state === "error");
      patch(t, { state: "error", error: failed?.error?.message ?? "Transfer stopped. You can retry from the failed step.", result }, emit);
    }
  } catch (e) {
    const err = e as { shortMessage?: string; message?: string };
    ORDER.forEach((k) => { if (t.steps[k].state === "live") t.steps[k].state = "error"; });
    patch(t, { state: "error", error: (err.shortMessage ?? err.message ?? "Something went wrong").split("\n")[0] }, emit);
  } finally {
    unsubscribe();
  }
}

export const emptySteps = (): Transfer["steps"] => ({
  approve: { state: "idle" }, burn: { state: "idle" }, attest: { state: "idle" }, mint: { state: "idle" },
});

// Iris fee quote (bps), public — works before any wallet is connected.
export async function quoteBps(network: Network, src: number, dst: number) {
  const base = network === "mainnet" ? "https://iris-api.circle.com" : "https://iris-api-sandbox.circle.com";
  try {
    const r = await fetch(`${base}/v2/burn/USDC/fees/${src}/${dst}`);
    // Iris has no quote for some routes (e.g. sandbox ↔ Sui): no Fast option, Standard is free.
    if (!r.ok) return { fast: null, slow: 0 };
    const j: { finalityThreshold: number; minimumFee: number }[] = await r.json();
    return { fast: j.find((x) => x.finalityThreshold === 1000)?.minimumFee ?? null, slow: j.find((x) => x.finalityThreshold === 2000)?.minimumFee ?? 0 };
  } catch {
    return null;
  }
}
