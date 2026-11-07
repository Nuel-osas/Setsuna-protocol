"use client";

// Transfers follow the wallet, not the browser. CCTP needs only the source chain and the burn
// transaction to finish a transfer, and the USDC can only go to the recipient fixed in the burn, so a
// transfer can be picked up on any device: from the wallet that sent or receives it (looked up in
// Setsuna's record), or from its transaction hash (looked up at Circle).
import { ALL_CHAINS, type Chain } from "./chains";
import { aptosToBytes32 } from "./aptos";
import { suiToBytes32 } from "./sui";
import { type Transfer, checkTransfer, emptySteps } from "./bridge";
import { FORWARD_HOOK, irisMessage, messageUsed } from "./claim";
import type { Connected } from "./wallets";
import { createPublicClient, http } from "viem";

const STATS = "https://stats.setsuna.finance/api/bridge-transfers";
const IRIS = "https://iris-api.circle.com";

/** A transfer as Setsuna's record (or Circle's) knows it. Amount in USDC base units. */
type FoundRecord = {
  sourceDomain: number;
  burnTx: string;
  destDomain: number;
  amount: string;
  sender: string;
  recipient: string;
  circleDelivers: boolean;
  mintTx: string | null;
  burnedAt: string;
};

const byDomain = (domain: number) => ALL_CHAINS.find((c) => c.network === "mainnet" && c.domain === domain && c.bridgeable);
const txUrl = (c: Chain, hash: string) => c.explorer?.replace("{hash}", hash);
const hexOf = (bytes: Uint8Array) => `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;

/** The forms Setsuna's record stores each connected wallet under, as sender or recipient. */
export async function walletKeys(connected: Partial<Record<string, Connected>>): Promise<string[]> {
  const keys: string[] = [];
  for (const w of Object.values(connected)) {
    if (!w) continue;
    try {
      if (w.ecosystem === "evm") keys.push(w.address.toLowerCase());
      else if (w.ecosystem === "sui") keys.push(suiToBytes32(w.address).toLowerCase());
      else if (w.ecosystem === "aptos") keys.push(aptosToBytes32(w.address).toLowerCase());
      else if (w.ecosystem === "solana") {
        // As sender: the wallet. As recipient: its USDC token account, where Circle mints.
        const { PublicKey } = await import("@solana/web3.js");
        const { getAssociatedTokenAddressSync } = await import("@solana/spl-token");
        const owner = new PublicKey(w.address);
        const usdc = ALL_CHAINS.find((c) => c.network === "mainnet" && c.family === "solana")?.usdc;
        keys.push(hexOf(owner.toBytes()));
        if (usdc) keys.push(hexOf(getAssociatedTokenAddressSync(new PublicKey(usdc), owner, true).toBytes()));
      }
    } catch {
      // A wallet whose address can't be read in this form is simply not looked up.
    }
  }
  return [...new Set(keys)].slice(0, 8);
}

/** The bridge's own record of a transfer, rebuilt from Setsuna's or Circle's record of the burn. */
export function fromRecord(r: FoundRecord, note: string): Transfer | null {
  const from = byDomain(r.sourceDomain);
  const to = byDomain(r.destDomain);
  if (!from || !to) return null;
  const steps = emptySteps();
  steps.approve = { state: "skip" };
  steps.burn = { state: "done", tx: r.burnTx, url: txUrl(from, r.burnTx) };
  if (r.mintTx) {
    steps.attest = { state: "done" };
    steps.mint = { state: "done", tx: r.mintTx, url: txUrl(to, r.mintTx) };
  }
  const at = Date.parse(r.burnedAt) || Date.now();
  return {
    id: `${r.sourceDomain}:${r.burnTx}`,
    network: "mainnet",
    from: from.family,
    to: to.family,
    amount: (Number(r.amount) / 1e6).toString(),
    speed: "SLOW",
    sender: r.sender,
    recipient: r.recipient,
    steps,
    gasInUsdc: r.circleDelivers,
    note,
    state: r.mintTx ? "done" : "live",
    createdAt: at,
    ...(r.mintTx ? { doneAt: at } : {}),
  };
}

/** Transfers Setsuna has recorded from or to these wallets, mainnet only. Empty if the lookup fails. */
export async function walletTransfers(keys: string[]): Promise<Transfer[]> {
  if (!keys.length) return [];
  try {
    const res = await fetch(`${STATS}?keys=${keys.join(",")}`);
    if (!res.ok) return [];
    const { transfers } = (await res.json()) as { transfers: FoundRecord[] };
    return transfers.map((r) => fromRecord(r, "Found from your wallet")).filter((t): t is Transfer => !!t);
  } catch {
    return [];
  }
}

/**
 * Where a found transfer stands now: delivered, already minted, ready for its recipient to claim, or
 * still with Circle. Null when nothing has changed.
 */
export async function refresh(t: Transfer): Promise<Transfer | null> {
  const updated = await checkTransfer(t);
  if (updated) return updated;
  if (t.state === "done" || t.state === "claim" || !t.steps.burn.tx) return null;
  const from = ALL_CHAINS.find((c) => c.network === t.network && c.family === t.from);
  const to = ALL_CHAINS.find((c) => c.network === t.network && c.family === t.to);
  if (!from || !to) return null;
  const m = await irisMessage(t.network, from.domain, t.steps.burn.tx);
  // Attested, not delivered by Circle, not minted by anyone: the recipient can claim it now.
  if (m?.ready && !t.gasInUsdc && !(await messageUsed(to, m.message))) {
    return { ...t, state: "claim", steps: { ...t.steps, attest: { state: "done" } } };
  }
  return null;
}

/** When the burn happened, from the sending chain itself; null if it can't be read. */
async function burnTime(chain: Chain, hash: string): Promise<string | null> {
  const rpc = (url: string, method: string, params: unknown[]) =>
    fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }).then((r) => r.json());
  try {
    if (chain.ecosystem === "evm" && chain.rpc) {
      const c = createPublicClient({ transport: http(chain.rpc) });
      const rc = await c.getTransactionReceipt({ hash: hash as `0x${string}` });
      const block = await c.getBlock({ blockNumber: rc.blockNumber });
      return new Date(Number(block.timestamp) * 1000).toISOString();
    }
    if (chain.ecosystem === "sui") {
      // Sui retired public JSON-RPC; its GraphQL endpoint answers browsers.
      const j = await fetch("https://graphql.mainnet.sui.io/graphql", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: `{ transaction(digest: "${hash.replace(/[^1-9A-HJ-NP-Za-km-z]/g, "")}") { effects { timestamp } } }` }),
      }).then((r) => r.json());
      const ts = j.data?.transaction?.effects?.timestamp;
      return ts ? new Date(ts).toISOString() : null;
    }
    if (chain.ecosystem === "solana") {
      const j = await rpc("https://api.mainnet-beta.solana.com", "getTransaction", [hash, { maxSupportedTransactionVersion: 0 }]);
      return j.result?.blockTime ? new Date(j.result.blockTime * 1000).toISOString() : null;
    }
    if (chain.ecosystem === "aptos") {
      const j = await fetch(`https://fullnode.mainnet.aptoslabs.com/v1/transactions/by_hash/${hash}`).then((r) => r.json());
      return j.timestamp ? new Date(Number(j.timestamp) / 1000).toISOString() : null;
    }
  } catch {}
  return null;
}

/** Which source domains a transaction hash could belong to. */
function candidates(hash: string): number[] {
  const mainnet = ALL_CHAINS.filter((c) => c.network === "mainnet" && c.bridgeable);
  if (/^0x[0-9a-fA-F]{64}$/.test(hash)) return mainnet.filter((c) => c.ecosystem === "evm" || c.ecosystem === "aptos").map((c) => c.domain);
  if (/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(hash)) return mainnet.filter((c) => c.ecosystem === "solana").map((c) => c.domain);
  if (/^[1-9A-HJ-NP-Za-km-z]{40,46}$/.test(hash)) return mainnet.filter((c) => c.ecosystem === "sui").map((c) => c.domain);
  return [];
}

/** A transfer from its burn transaction hash, found at Circle on whichever chain sent it. */
export async function findByHash(raw: string): Promise<Transfer | null> {
  const hash = raw.trim();
  const domains = candidates(hash);
  if (!domains.length) return null;
  const found = await Promise.all(
    domains.map(async (domain) => {
      try {
        const res = await fetch(`${IRIS}/v2/messages/${domain}?transactionHash=${encodeURIComponent(hash)}`);
        if (!res.ok) return null;
        const m = (await res.json()).messages?.[0];
        const d = m?.decodedMessage;
        const body = d?.decodedMessageBody;
        if (!d || !body?.amount) return null;
        const r: FoundRecord = {
          sourceDomain: Number(d.sourceDomain),
          burnTx: hash,
          destDomain: Number(d.destinationDomain),
          amount: String(body.amount),
          sender: String(body.messageSender ?? "").toLowerCase(),
          recipient: String(body.mintRecipient ?? "").toLowerCase(),
          circleDelivers: String(body.hookData ?? "").startsWith(FORWARD_HOOK.slice(0, 26)),
          mintTx: m.forwardTxHash || m.destinationMintTxHash || null,
          burnedAt: new Date().toISOString(),
        };
        return r;
      } catch {
        return null;
      }
    }),
  );
  const r = found.find((x): x is FoundRecord => !!x);
  if (!r) return null;
  const source = byDomain(r.sourceDomain);
  const at = source ? await burnTime(source, r.burnTx) : null;
  return fromRecord(at ? { ...r, burnedAt: at } : r, "Found by transaction hash");
}
