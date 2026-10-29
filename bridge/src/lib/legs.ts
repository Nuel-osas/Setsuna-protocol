"use client";

import { createPublicClient, createWalletClient, custom, defineChain, http, numberToHex, pad, parseAbi } from "viem";
import { type BKChain, type Chain, type Network, bkDef } from "./chains";
import { aptosBurn, aptosMint, aptosToBytes32 } from "./aptos";
import { suiBurn, suiMint, suiToBytes32 } from "./sui";
import type { Connected } from "./wallets";

// Per-ecosystem burn and mint, for routes Bridge Kit can't run end to end (anything touching Sui or Aptos).
// EVM talks to TokenMessengerV2 / MessageTransmitterV2 directly; Solana goes through Bridge Kit's
// action layer; Sui uses our PTB builders and Aptos runs Circle's compiled scripts.

const tokenMessengerAbi = parseAbi([
  "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold)",
]);
const transmitterAbi = parseAbi(["function receiveMessage(bytes message, bytes attestation) returns (bool)"]);
const erc20 = parseAbi([
  "function allowance(address, address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
]);
const ZERO32 = `0x${"0".repeat(64)}` as const;

export type BurnArgs = { network: Network; chain: Chain; wallet: Connected; amount: bigint; dest: Chain; recipient: string; maxFee: bigint; finality: number; onApproved?: (tx?: string) => void };
export type MintArgs = { network: Network; chain: Chain; wallet: Connected; source: Chain; message: string; attestation: string; eventNonce: string };

// bytes32 recipient for any destination ecosystem
export async function recipient32(dest: Chain, addr: string): Promise<`0x${string}`> {
  if (dest.ecosystem === "evm") return pad(addr as `0x${string}`, { size: 32 });
  if (dest.ecosystem === "sui") return suiToBytes32(addr);
  if (dest.ecosystem === "aptos") return aptosToBytes32(addr);
  if (dest.ecosystem === "solana") {
    // Circle mints to the recipient's USDC token account (ATA), not the wallet itself.
    const { PublicKey } = await import("@solana/web3.js");
    const { getAssociatedTokenAddressSync } = await import("@solana/spl-token");
    const ata = getAssociatedTokenAddressSync(new PublicKey(dest.usdc!), new PublicKey(addr), true);
    return `0x${Buffer.from(ata.toBytes()).toString("hex")}`;
  }
  throw new Error(`${dest.name} recipients aren't supported yet`);
}

// ── EVM ───────────────────────────────────────────────────────────────────

function viemChain(def: BKChain) {
  return defineChain({
    id: def.chainId!,
    name: def.name,
    nativeCurrency: def.nativeCurrency ?? { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: def.rpcEndpoints ?? [] } },
  });
}

async function evmSwitch(w: Connected, def: BKChain) {
  const p = w.evm!;
  const want = numberToHex(def.chainId!);
  if ((await p.request({ method: "eth_chainId" })) === want) return;
  try {
    await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: want }] });
  } catch (e) {
    if ((e as { code?: number }).code !== 4902) throw e;
    await p.request({
      method: "wallet_addEthereumChain",
      params: [{ chainId: want, chainName: def.name, nativeCurrency: def.nativeCurrency, rpcUrls: def.rpcEndpoints }],
    });
  }
}

async function evmBurn(a: BurnArgs) {
  const def = bkDef(a.chain.id)!;
  const v2 = def.cctp!.contracts!.v2!;
  const chain = viemChain(def);
  await evmSwitch(a.wallet, def);
  const account = a.wallet.address as `0x${string}`;
  const pub = createPublicClient({ chain, transport: http(def.rpcEndpoints?.[0]) });
  const wal = createWalletClient({ chain, account, transport: custom(a.wallet.evm!) });
  const usdc = def.usdcAddress as `0x${string}`;
  const messenger = v2.tokenMessenger as `0x${string}`;
  const allowance = await pub.readContract({ address: usdc, abi: erc20, functionName: "allowance", args: [account, messenger] });
  let approveTx: string | undefined;
  if (allowance < a.amount) {
    approveTx = await wal.writeContract({ address: usdc, abi: erc20, functionName: "approve", args: [messenger, a.amount] });
    await pub.waitForTransactionReceipt({ hash: approveTx as `0x${string}` });
  }
  a.onApproved?.(approveTx);
  const hash = await wal.writeContract({
    address: messenger,
    abi: tokenMessengerAbi,
    functionName: "depositForBurn",
    args: [a.amount, a.dest.domain, await recipient32(a.dest, a.recipient), usdc, ZERO32, a.maxFee, a.finality],
  });
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error("Burn reverted");
  return hash as string;
}

async function evmMint(a: MintArgs) {
  const def = bkDef(a.chain.id)!;
  const chain = viemChain(def);
  await evmSwitch(a.wallet, def);
  const account = a.wallet.address as `0x${string}`;
  const pub = createPublicClient({ chain, transport: http(def.rpcEndpoints?.[0]) });
  const wal = createWalletClient({ chain, account, transport: custom(a.wallet.evm!) });
  const hash = await wal.writeContract({
    address: def.cctp!.contracts!.v2!.messageTransmitter as `0x${string}`,
    abi: transmitterAbi,
    functionName: "receiveMessage",
    args: [a.message as `0x${string}`, a.attestation as `0x${string}`],
  });
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error("Mint reverted (already claimed?)");
  return hash as string;
}

// ── Solana (Bridge Kit action layer) ─────────────────────────────────────

// Bridge Kit only knows Sui's V1 contracts; its Solana handlers just need the domain,
// so give them a V2-shaped definition for the non-Bridge-Kit side.
function v2Def(c: Chain) {
  const d = bkDef(c.id);
  if (d?.cctp?.contracts?.v2) return d;
  return { ...(d ?? { chain: c.id, name: c.name, type: c.ecosystem }), cctp: { domain: c.domain, contracts: { v2: { type: "split", tokenMessenger: "0x0", messageTransmitter: "0x0", confirmations: 1, fastConfirmations: 1 } } } };
}

async function solanaAdapter(w: Connected) {
  const { createSolanaAdapterFromProvider } = await import("@circle-fin/adapter-solana");
  return createSolanaAdapterFromProvider({ provider: w.solana as never });
}

type Prepared = { execute: () => Promise<string> };
type ActionAdapter = { prepareAction: (name: string, params: unknown, ctx: unknown) => Promise<Prepared> };

async function solanaBurn(a: BurnArgs) {
  const adapter = (await solanaAdapter(a.wallet)) as unknown as ActionAdapter;
  a.onApproved?.();
  const p = await adapter.prepareAction("cctp.v2.depositForBurn", {
    amount: a.amount, mintRecipient: await recipient32(a.dest, a.recipient), destinationCaller: ZERO32,
    maxFee: a.maxFee, minFinalityThreshold: a.finality, fromChain: bkDef(a.chain.id), toChain: v2Def(a.dest),
  }, { chain: a.chain.id, address: a.wallet.address });
  return p.execute();
}

async function solanaMint(a: MintArgs) {
  const adapter = (await solanaAdapter(a.wallet)) as unknown as ActionAdapter;
  const p = await adapter.prepareAction("cctp.v2.receiveMessage", {
    eventNonce: a.eventNonce, attestation: a.attestation, message: a.message,
    fromChain: v2Def(a.source), toChain: bkDef(a.chain.id), destinationAddress: a.wallet.address,
  }, { chain: a.chain.id, address: a.wallet.address });
  return p.execute();
}

// ── dispatch ──────────────────────────────────────────────────────────────

export async function burn(a: BurnArgs): Promise<string> {
  switch (a.chain.ecosystem) {
    case "evm": return evmBurn(a);
    case "solana": return solanaBurn(a);
    case "sui":
      a.onApproved?.();
      return suiBurn({ network: a.network, wallet: a.wallet.standard!, owner: a.wallet.address, amount: a.amount, destDomain: a.dest.domain, mintRecipient32: await recipient32(a.dest, a.recipient) });
    case "aptos":
      a.onApproved?.();
      return aptosBurn({ network: a.network, wallet: a.wallet.standard!, owner: a.wallet.address, amount: a.amount, destDomain: a.dest.domain, mintRecipient32: await recipient32(a.dest, a.recipient) });
    default: throw new Error(`Burning on ${a.chain.name} isn't supported yet`);
  }
}

export async function mint(a: MintArgs): Promise<string> {
  switch (a.chain.ecosystem) {
    case "evm": return evmMint(a);
    case "solana": return solanaMint(a);
    case "sui": return suiMint({ network: a.network, wallet: a.wallet.standard!, owner: a.wallet.address, message: a.message, attestation: a.attestation });
    case "aptos": return aptosMint({ network: a.network, wallet: a.wallet.standard!, owner: a.wallet.address, message: a.message, attestation: a.attestation });
    default: throw new Error(`Minting on ${a.chain.name} isn't supported yet`);
  }
}

// Iris: poll for the attested message of a burn. Sui/Solana tx ids are base58, used as-is.
export async function waitForAttestation(network: Network, srcDomain: number, txHash: string, fast: boolean) {
  const base = network === "mainnet" ? "https://iris-api.circle.com" : "https://iris-api-sandbox.circle.com";
  for (;;) {
    try {
      const r = await fetch(`${base}/v2/messages/${srcDomain}?transactionHash=${txHash}`);
      if (r.ok) {
        const m = (await r.json()).messages?.[0];
        if (m && m.status === "complete" && m.attestation && m.attestation !== "PENDING" && m.message && m.message !== "0x") {
          return { message: m.message as string, attestation: m.attestation as string, eventNonce: String(m.eventNonce ?? "") };
        }
      }
    } catch {}
    await new Promise((res) => setTimeout(res, fast ? 2000 : 5000));
  }
}
