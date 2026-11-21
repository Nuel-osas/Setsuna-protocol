"use client";

// LI.FI carries the last hop to chains Circle's CCTP doesn't reach. Robinhood Chain has no USDC, so the
// USDC is swapped into the chain's dollar (Paxos's USDG) or ETH on the way. Quotes and status come from
// LI.FI's public API; the transaction is signed by the user's EVM wallet on the sending chain.

import { encodeFunctionData, parseAbi } from "viem";
import type { Chain } from "./chains";
import { evmOn, tightGas } from "./legs";
import type { Connected } from "./wallets";

const API = "https://li.quest/v1";
const INTEGRATOR = "setsuna";

export type HopToken = "USDG" | "ETH";

// What can land on Robinhood Chain (4663).
// - USDG 0x5fc5…d168: name() "Global Dollar", symbol() "USDG", decimals() 6, totalSupply 610.6M on
//   21 Nov 2026 (read from rpc.mainnet.chain.robinhood.com). The other token LI.FI lists as "Paxos
//   USDG" (0x0A3B…954F) has 1,100 in supply and no routes. Robinhood's docs name Paxos (USDG) as the
//   chain's stablecoin provider.
// - ETH: the chain's gas token.
export const HOP_TOKENS: Record<HopToken, { address: `0x${string}`; decimals: number; name: string }> = {
  USDG: { address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", decimals: 6, name: "Global Dollar (Paxos)" },
  ETH: { address: "0x0000000000000000000000000000000000000000", decimals: 18, name: "Ether, for gas" },
};

// LI.FI's contract (its "diamond") on each chain the bridge sends from: the only address an approval or a
// transaction may go to. From li.quest/v1/chains `diamondAddress`, and equal to `transactionRequest.to`
// and `estimate.approvalAddress` in a 100 USDC → Robinhood USDG quote from each chain (21 Nov 2026).
// A chain listed here routes directly; any other source crosses to Base on CCTP first.
const LIFI_DEFAULT = "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE";
export const DIAMOND: Record<number, `0x${string}`> = {
  1: LIFI_DEFAULT, 8453: LIFI_DEFAULT, 42161: LIFI_DEFAULT, 10: LIFI_DEFAULT, 137: LIFI_DEFAULT, 43114: LIFI_DEFAULT,
  480: LIFI_DEFAULT, 146: LIFI_DEFAULT, 25: LIFI_DEFAULT, 196: LIFI_DEFAULT,
  143: "0x026F252016A7C47CDEf1F05a3Fc9E20C92a49C37", // Monad
  9745: "0x026F252016A7C47CDEf1F05a3Fc9E20C92a49C37", // Plasma
  130: "0x864b314D4C5a0399368609581d3E8933a63b9232", // Unichain
  57073: "0x864b314D4C5a0399368609581d3E8933a63b9232", // Ink
  59144: "0xde1e598b81620773454588b85d6b5d4eec32573e", // Linea
  999: "0x0a0758d937d1059c356D4714e57F5df0239bce1A", // HyperEVM
  5042: "0xA4072583658Fae592A3506A42431cb6316a8d40b", // Arc
  1776: "0xeCeC3970Ca674278DA8D9B1c484ACaF6B20181F5", // Injective
  2818: "0xF7aB42D00D2399f8A4Fba2F15466Be40709fe307", // Morph
  1672: "0xFf70F4A1d11995621854F3692acF286d8aCd04b2", // Pharos
};

/** Sources that reach a LI.FI chain in one transaction: EVM chains with a pinned diamond. */
export const lifiDirect = (c: Chain) => c.ecosystem === "evm" && !!c.chainId && !!DIAMOND[c.chainId] && !!c.usdc;

/** Where USDC from any other source crosses on CCTP before LI.FI takes it. */
export const VIA = "base";

export type LifiQuote = {
  from: `0x${string}`;
  fromChainId: number;
  fromAmount: bigint;
  toAmount: bigint;
  toAmountMin: bigint;
  token: HopToken;
  tool: string;
  feeUsd: number;
  gasUsd: number;
  seconds: number;
  tx: { to: `0x${string}`; data: `0x${string}`; value: bigint; gasLimit?: bigint };
};

const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/**
 * A LI.FI quote for USDC on `fromChain` to `token` on `toChain`. Every field that decides where funds go
 * is checked against what was asked; anything else is refused rather than signed.
 */
export async function lifiQuote(p: {
  fromChain: Chain; fromAmount: bigint; from: string; toChain: Chain; to: string; token: HopToken;
}): Promise<LifiQuote> {
  const diamond = p.fromChain.chainId ? DIAMOND[p.fromChain.chainId] : undefined;
  if (!diamond || !p.fromChain.usdc || !p.toChain.chainId) throw new Error(`LI.FI doesn't route from ${p.fromChain.name} here.`);
  const want = HOP_TOKENS[p.token];
  const q = new URLSearchParams({
    fromChain: String(p.fromChain.chainId), toChain: String(p.toChain.chainId), fromToken: p.fromChain.usdc, toToken: want.address,
    fromAmount: p.fromAmount.toString(), fromAddress: p.from, toAddress: p.to, slippage: "0.005", integrator: INTEGRATOR,
  });
  let r: Response;
  try {
    r = await fetch(`${API}/quote?${q}`);
  } catch {
    throw new Error("LI.FI can't be reached right now. Try again in a moment.");
  }
  const j = await r.json().catch(() => null);
  if (r.status === 429) throw new Error("LI.FI is rate-limiting quotes. Try again in a minute.");
  if (!r.ok || !j) throw new Error(`LI.FI has no route to ${p.toChain.name} for this amount right now.`);
  const a = j.action ?? {};
  const e = j.estimate ?? {};
  const t = j.transactionRequest ?? {};
  const ok =
    Number(a.fromChainId) === p.fromChain.chainId && Number(a.toChainId) === p.toChain.chainId &&
    same(a.fromToken?.address, p.fromChain.usdc) && same(a.toToken?.address, want.address) &&
    String(a.fromAmount) === p.fromAmount.toString() && same(a.fromAddress, p.from) && same(a.toAddress, p.to) &&
    same(t.to, diamond) && same(e.approvalAddress, diamond) && Number(t.chainId) === p.fromChain.chainId &&
    typeof t.data === "string" && /^0x[0-9a-fA-F]*$/.test(t.data) && /^\d+$/.test(String(e.toAmountMin ?? ""));
  if (!ok) throw new Error("LI.FI's quote didn't match this transfer, so it wasn't used. Nothing was sent.");
  const toAmountMin = BigInt(e.toAmountMin);
  if (toAmountMin <= 0n) throw new Error("The amount is too small for LI.FI's fees.");
  const usd = (xs: { amountUSD?: string }[] | undefined) => (xs ?? []).reduce((s, x) => s + (Number(x.amountUSD) || 0), 0);
  return {
    from: p.from as `0x${string}`,
    fromChainId: p.fromChain.chainId!,
    fromAmount: p.fromAmount,
    toAmount: BigInt(e.toAmount ?? e.toAmountMin),
    toAmountMin,
    token: p.token,
    tool: j.toolDetails?.name ?? j.tool ?? "LI.FI",
    feeUsd: usd(e.feeCosts),
    gasUsd: usd(e.gasCosts),
    seconds: Number(e.executionDuration) || 0,
    tx: { to: t.to, data: t.data, value: BigInt(t.value ?? 0), gasLimit: t.gasLimit ? BigInt(t.gasLimit) : undefined },
  };
}

const erc20 = parseAbi([
  "function allowance(address, address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
]);

/** Approve LI.FI's diamond for `amount` USDC on `chain` if the allowance is short. Returns the approval hash, if one was sent. */
export async function lifiApprove(chain: Chain, wallet: Connected, amount: bigint): Promise<string | undefined> {
  const diamond = DIAMOND[chain.chainId!];
  const { chain: vc, account, pub, wal } = await evmOn(wallet, chain);
  const usdc = chain.usdc as `0x${string}`;
  if ((await pub.readContract({ address: usdc, abi: erc20, functionName: "allowance", args: [account, diamond] })) >= amount) return undefined;
  const data = encodeFunctionData({ abi: erc20, functionName: "approve", args: [diamond, amount] });
  const g = await tightGas(pub, account, { to: usdc, data }, 60_000n);
  const hash = await wal.sendTransaction({ to: usdc, data, account, chain: vc, gas: g.gas, maxFeePerGas: g.maxFeePerGas, maxPriorityFeePerGas: g.maxPriorityFeePerGas });
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error("The approval reverted. Nothing was sent.");
  return hash;
}

/** Send a checked quote's transaction from the wallet it was quoted for. The hash is reported before it confirms. */
export async function lifiSend(chain: Chain, wallet: Connected, q: LifiQuote, onSent: (hash: string) => void): Promise<string> {
  const { chain: vc, account, pub, wal } = await evmOn(wallet, chain);
  if (!same(account, q.from)) throw new Error("The connected wallet isn't the one this transfer was quoted for.");
  const tx = { to: q.tx.to, data: q.tx.data, value: q.tx.value };
  const g = await tightGas(pub, account, tx, q.tx.gasLimit ?? 600_000n);
  const hash = await wal.sendTransaction({ ...tx, account, chain: vc, gas: g.gas, maxFeePerGas: g.maxFeePerGas, maxPriorityFeePerGas: g.maxPriorityFeePerGas });
  onSent(hash);
  const rc = await pub.waitForTransactionReceipt({ hash, timeout: 900_000 });
  if (rc.status !== "success") throw new Error("The LI.FI transaction reverted, so nothing left your wallet. Retry to send it.");
  return hash;
}

export type HopStatus = {
  /** pending covers LI.FI not having seen it yet: an unclear status is never treated as failed. */
  state: "pending" | "done" | "partial" | "refunded" | "failed";
  receivingTx?: string;
  received?: bigint;
  symbol?: string;
  decimals?: number;
  explorer?: string;
  message?: string;
};

/** Where a LI.FI transfer stands, from its sending transaction. */
export async function lifiStatus(txHash: string, fromChainId: number, toChainId: number): Promise<HopStatus> {
  try {
    const r = await fetch(`${API}/status?${new URLSearchParams({ txHash, fromChain: String(fromChainId), toChain: String(toChainId), integrator: INTEGRATOR })}`);
    if (!r.ok) return { state: "pending" };
    const j = await r.json();
    const rec = j.receiving ?? {};
    const base = {
      receivingTx: rec.txHash || undefined,
      received: /^\d+$/.test(String(rec.amount ?? "")) ? BigInt(rec.amount) : undefined,
      symbol: rec.token?.symbol,
      decimals: rec.token?.decimals,
      explorer: j.lifiExplorerLink,
      message: j.substatusMessage,
    };
    if (j.status === "DONE") {
      if (j.substatus === "REFUNDED") return { ...base, state: "refunded" };
      if (j.substatus === "PARTIAL") return { ...base, state: "partial" };
      return { ...base, state: "done" };
    }
    if (j.status === "FAILED") return { ...base, state: "failed" };
    return { ...base, state: "pending" };
  } catch {
    return { state: "pending" };
  }
}

/**
 * The USDC that reached `holder` from an attested CCTP V2 message: amount minus the fee Circle executed.
 * Measured from the message the attestation signs, not from what was asked for.
 */
export function crossedAmount(message: string, holder: string): bigint {
  const hex = message.replace(/^0x/, "");
  // Header 148 bytes; body: version 4, burnToken 32, mintRecipient 32, amount 32, sender 32, maxFee 32, feeExecuted 32.
  if (hex.length < 688 || !/^[0-9a-fA-F]+$/.test(hex)) throw new Error("The attested message is malformed.");
  const recipient = `0x${hex.slice(368 + 24, 432)}`;
  if (!same(recipient, holder)) throw new Error("The USDC crossed to a different wallet than the one sending it on.");
  const amount = BigInt(`0x${hex.slice(432, 496)}`);
  const fee = BigInt(`0x${hex.slice(624, 688)}`);
  if (fee > amount) throw new Error("The attested message is malformed.");
  return amount - fee;
}
