"use client";

import { createPublicClient, http, parseAbi } from "viem";
import { type Chain, type Network, bkDef } from "./chains";

// What it costs to receive on a chain, and Circle's Forwarding Service, which mints for the user
// (paid from the USDC) so they need no gas on the destination at all.

/** Gas for MessageTransmitterV2.receiveMessage into a first-time USDC holder (174k measured on Ethereum). */
export const MINT_GAS = 180_000n;
/** Forwarding Service hook data, version 0: "cctp-forward" magic, version 0, length 0. */
export const FORWARD_HOOK = "0x636374702d666f72776172640000000000000000000000000000000000000000" as const;

const iris = (n: Network) => (n === "mainnet" ? "https://iris-api.circle.com" : "https://iris-api-sandbox.circle.com");

// ── gas token and prices ──────────────────────────────────────────────────

// L2s whose gas is ETH even if a chain definition says otherwise.
const ETH_GAS = new Set(["unichain"]);
const NON_EVM: Record<string, { symbol: string; decimals: number }> = {
  solana: { symbol: "SOL", decimals: 9 },
  sui: { symbol: "SUI", decimals: 9 },
  aptos: { symbol: "APT", decimals: 8 },
};

export function gasToken(c: Chain) {
  if (c.ecosystem !== "evm") return NON_EVM[c.ecosystem] ?? { symbol: "gas", decimals: 9 };
  if (ETH_GAS.has(c.family)) return { symbol: "ETH", decimals: 18 };
  const n = bkDef(c.id)?.nativeCurrency;
  return { symbol: n?.symbol ?? "ETH", decimals: n?.decimals ?? 18 };
}

const PRICE_ID: Record<string, string> = {
  ETH: "ethereum", MON: "monad", AVAX: "avalanche-2", POL: "polygon-ecosystem-token", SEI: "sei-network",
  S: "sonic-3", HYPE: "hyperliquid", XDC: "xdce-crowd-sale", USDC: "usd-coin", PLUME: "plume", SOL: "solana",
  SUI: "sui", APT: "aptos", CRO: "crypto-com-chain", INJ: "injective-protocol", XPL: "plasma", OKB: "okb",
};
let prices: { at: number; map: Record<string, number> } | null = null;

/** USD price per gas token symbol (DefiLlama), cached five minutes. Missing symbols are absent. */
export async function gasPrices(): Promise<Record<string, number>> {
  if (prices && Date.now() - prices.at < 300_000) return prices.map;
  try {
    const ids = Object.values(PRICE_ID).map((i) => `coingecko:${i}`).join(",");
    const j: { coins: Record<string, { price: number }> } = await (await fetch(`https://coins.llama.fi/prices/current/${ids}`)).json();
    const map: Record<string, number> = {};
    for (const [sym, id] of Object.entries(PRICE_ID)) {
      const p = j.coins[`coingecko:${id}`]?.price;
      if (p) map[sym] = p;
    }
    prices = { at: Date.now(), map };
    return map;
  } catch {
    return prices?.map ?? {};
  }
}

// ── claim cost and the claiming wallet's gas ──────────────────────────────

const evmClient = (c: Chain) => createPublicClient({ transport: http(c.rpc) });

// Approximate cost of a mint on non-EVM chains, in base units (Solana includes creating the token account).
const FLAT_COST: Record<string, bigint> = { solana: 2_500_000n, sui: 10_000_000n, aptos: 200_000n };

export type ClaimCost = { native: bigint; symbol: string; decimals: number; usd: number | null; gwei?: number };

/** What claiming on `c` costs right now, in its gas token and USD. Null if the chain can't be read. */
export async function claimCost(c: Chain): Promise<ClaimCost | null> {
  const t = gasToken(c);
  try {
    let native: bigint;
    let gwei: number | undefined;
    if (c.ecosystem === "evm") {
      if (!c.rpc) return null;
      const price = await evmClient(c).getGasPrice();
      native = price * MINT_GAS;
      gwei = Number(price) / 1e9;
    } else {
      native = FLAT_COST[c.ecosystem] ?? 0n;
    }
    const p = (await gasPrices())[t.symbol];
    return { native, ...t, usd: p ? (Number(native) / 10 ** t.decimals) * p : null, gwei };
  } catch {
    return null;
  }
}

/** The wallet's gas-token balance on `c`, in base units. Null if it can't be read. */
export async function gasBalance(c: Chain, owner: string): Promise<bigint | null> {
  try {
    if (c.ecosystem === "evm") return c.rpc ? await evmClient(c).getBalance({ address: owner as `0x${string}` }) : null;
    if (c.ecosystem === "solana" && c.rpc) {
      const r = await fetch(c.rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [owner] }),
      });
      const v = (await r.json()).result?.value;
      return v != null ? BigInt(v) : null;
    }
    if (c.ecosystem === "sui") {
      const r = await fetch(`https://graphql.${c.network}.sui.io/graphql`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: "query($a: SuiAddress!) { address(address: $a) { balance(coinType: \"0x2::sui::SUI\") { totalBalance } } }",
          variables: { a: owner },
        }),
      });
      const v = (await r.json()).data?.address?.balance?.totalBalance;
      return v != null ? BigInt(v) : 0n;
    }
    if (c.ecosystem === "aptos") {
      const r = await fetch(`https://api.${c.network}.aptoslabs.com/v1/accounts/${owner}/balance/0x1::aptos_coin::AptosCoin`);
      return r.ok ? BigInt(await r.text()) : 0n;
    }
  } catch {}
  return null;
}

export const fmtUsd = (usd: number | null | undefined) =>
  usd == null ? null : usd < 0.01 ? "<$0.01" : `$${usd < 10 ? usd.toFixed(2) : usd.toFixed(0)}`;

export const fmtNative = (v: bigint, decimals: number) => {
  const n = Number(v) / 10 ** decimals;
  return n === 0 ? "0" : n < 0.0001 ? "<0.0001" : n.toLocaleString(undefined, { maximumSignificantDigits: 3 });
};

// ── Circle Forwarding Service ─────────────────────────────────────────────

/** Whether Circle can mint on `c` for the user. Aptos sources can't attach the hook (compiled script). */
export const canForward = (from: Chain, to: Chain) =>
  from.ecosystem !== "aptos" && !!bkDef(to.id)?.cctp && !!(bkDef(to.id)!.cctp as { forwarderSupported?: { destination?: boolean } }).forwarderSupported?.destination;

export type ForwardQuote = { fastBps: number | null; slowBps: number; fee: bigint };

/** Circle's forwarding fee (USDC base units, "med") and protocol fees for a route. Null if not offered. */
export async function forwardQuote(network: Network, src: number, dst: number): Promise<ForwardQuote | null> {
  try {
    const r = await fetch(`${iris(network)}/v2/burn/USDC/fees/${src}/${dst}?forward=true`);
    if (!r.ok) return null;
    const j: { finalityThreshold: number; minimumFee: number; forwardFee?: { med: number } }[] = await r.json();
    const slow = j.find((x) => x.finalityThreshold === 2000);
    const fast = j.find((x) => x.finalityThreshold === 1000);
    const med = slow?.forwardFee?.med ?? fast?.forwardFee?.med;
    if (med == null) return null;
    return { fastBps: fast?.minimumFee ?? null, slowBps: slow?.minimumFee ?? 0, fee: BigInt(Math.ceil(med)) };
  } catch {
    return null;
  }
}

/** The Iris record for a burn: the message, its attestation and, when Circle forwarded it, the mint tx. */
export async function irisMessage(network: Network, srcDomain: number, burnTx: string) {
  try {
    const r = await fetch(`${iris(network)}/v2/messages/${srcDomain}?transactionHash=${burnTx}`);
    if (!r.ok) return null;
    const m = (await r.json()).messages?.[0];
    if (!m) return null;
    return {
      ready: m.status === "complete" && !!m.attestation && m.attestation !== "PENDING" && !!m.message && m.message !== "0x",
      message: m.message as string,
      attestation: m.attestation as string,
      eventNonce: String(m.eventNonce ?? ""),
      forwardTx: (m.forwardTxHash as string | undefined) || undefined,
    };
  } catch {
    return null;
  }
}

// ── already claimed? ──────────────────────────────────────────────────────

const transmitterAbi = parseAbi(["function usedNonces(bytes32) view returns (uint256)"]);

/** True if this CCTP v2 message was already received on EVM chain `c` (by anyone). Null if unknown. */
export async function messageUsed(c: Chain, message: string): Promise<boolean | null> {
  if (c.ecosystem !== "evm" || !c.rpc || message.length < 2 + 88) return null;
  const mt = bkDef(c.id)?.cctp?.contracts?.v2?.messageTransmitter as `0x${string}` | undefined;
  if (!mt) return null;
  try {
    // v2 header: version (4) · source domain (4) · destination domain (4) · nonce (32) ...
    const nonce = `0x${message.slice(2 + 24, 2 + 88)}` as `0x${string}`;
    return (await evmClient(c).readContract({ address: mt, abi: transmitterAbi, functionName: "usedNonces", args: [nonce] })) > 0n;
  } catch {
    return null;
  }
}

// ── cheaper claims ────────────────────────────────────────────────────────

/**
 * A fee cap at the low end of the last ~hour of base fees, so a claim waits in the queue and lands on
 * the next dip instead of paying a spike. Never above what the network charges now.
 */
export async function cheapFees(c: Chain) {
  const client = evmClient(c);
  const [hist, now] = await Promise.all([client.getFeeHistory({ blockCount: 300, rewardPercentiles: [] }), client.getGasPrice()]);
  const fees = [...hist.baseFeePerGas].sort((a, b) => (a < b ? -1 : 1));
  const low = fees[Math.floor(fees.length * 0.2)] ?? now;
  const tip = 100_000_000n; // 0.1 gwei
  let cap = (low * 11n) / 10n + tip;
  if (cap > now) cap = now;
  return { maxFeePerGas: cap, maxPriorityFeePerGas: tip < cap ? tip : cap };
}
