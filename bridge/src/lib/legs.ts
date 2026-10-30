"use client";

import { createPublicClient, createWalletClient, custom, defineChain, encodeFunctionData, http, numberToHex, pad, parseAbi } from "viem";
import { type BKChain, type Chain, type Network, bkDef } from "./chains";
import { gasPrices, gasToken, messageUsed } from "./claim";
import { aptosBurn, aptosMint, aptosToBytes32 } from "./aptos";
import { suiBurn, suiMint, suiToBytes32 } from "./sui";
import type { Connected } from "./wallets";

// Per-ecosystem burn and mint, for routes Bridge Kit can't run end to end (anything touching Sui or Aptos).
// EVM talks to TokenMessengerV2 / MessageTransmitterV2 directly; Solana goes through Bridge Kit's
// action layer; Sui uses our PTB builders and Aptos runs Circle's compiled scripts.

const tokenMessengerAbi = parseAbi([
  "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold)",
  "function depositForBurnWithHook(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold, bytes hookData)",
]);
const transmitterAbi = parseAbi(["function receiveMessage(bytes message, bytes attestation) returns (bool)"]);
const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address, address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
]);
const ZERO32 = `0x${"0".repeat(64)}` as const;

// hookData set to the Forwarding Service hook asks Circle to mint on the destination, paid from maxFee.
// onAdjusted: the wallet paid gas in USDC, so less than `amount` is left; the burn sends this instead.
export type BurnArgs = {
  network: Network; chain: Chain; wallet: Connected; amount: bigint; dest: Chain; recipient: string; maxFee: bigint; finality: number;
  hookData?: `0x${string}`; onApproved?: (tx?: string) => void; onAdjusted?: (amount: bigint, held: bigint) => void;
};
// fees caps the claim's gas price (it then waits for a dip); onSent reports the hash as soon as it's signed.
export type MintArgs = {
  network: Network; chain: Chain; wallet: Connected; source: Chain; message: string; attestation: string; eventNonce: string;
  fees?: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }; onSent?: (tx: string) => void;
};

/** The message was already received on the destination (by Circle, another wallet or an earlier claim). */
export class AlreadyMinted extends Error {
  constructor() { super("Already minted"); }
}

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

const BURN_GAS = 160_000n;
const APPROVE_GAS = 60_000n;

type Pub = ReturnType<typeof createPublicClient>;
type Tx = { to: `0x${string}`; data: `0x${string}` };

/**
 * Gas settings the bridge sets itself: the estimate plus 25%, and a fee cap of 1.5x today's base fee.
 * Wallets otherwise pad the cap so far (7x seen on Ethereum) that a wallet holding enough ETH for the
 * real fee is treated as short and pays in USDC at a markup instead.
 */
async function tightGas(pub: Pub, account: `0x${string}`, tx: Tx | null, fallbackGas: bigint) {
  const [block, tip] = await Promise.all([pub.getBlock(), pub.estimateMaxPriorityFeePerGas().catch(() => 100_000_000n)]);
  let gas = fallbackGas;
  if (tx) gas = await pub.estimateGas({ account, ...tx }).catch(() => fallbackGas);
  gas = (gas * 125n) / 100n;
  const base = block.baseFeePerGas;
  // Chains without EIP-1559 fees keep the wallet's own pricing; only the gas limit is set.
  if (base == null) {
    const price = await pub.getGasPrice();
    return { gas, maxFeePerGas: undefined, maxPriorityFeePerGas: undefined, maxCost: gas * price * 2n };
  }
  const maxPriorityFeePerGas = tip;
  const maxFeePerGas = (base * 3n) / 2n + tip;
  return { gas, maxFeePerGas, maxPriorityFeePerGas, maxCost: gas * maxFeePerGas };
}

/**
 * USDC to hold back for gas when the wallet can't cover the transaction's maximum fee in the chain's
 * gas token: wallets like MetaMask then take the gas from the USDC itself. Zero if the gas is covered.
 */
async function usdcGasMargin(pub: Pub, chain: Chain, account: `0x${string}`, maxCost: bigint) {
  const native = await pub.getBalance({ address: account });
  if (native >= maxCost) return 0n;
  const t = gasToken(chain);
  const usd = (await gasPrices())[t.symbol];
  if (!usd) return 0n;
  return BigInt(Math.ceil((Number(maxCost) / 10 ** t.decimals) * usd * 1.2 * 1e6));
}

/** Approve + burn as one atomic batch (EIP-5792) when the wallet supports it. Null if it can't batch. */
async function batchBurn(wal: ReturnType<typeof createWalletClient>, account: `0x${string}`, chainId: number, calls: { to: `0x${string}`; data: `0x${string}` }[]) {
  try {
    const caps = (await wal.getCapabilities({ account })) as Record<number, { atomic?: { status?: string } }>;
    const status = caps?.[chainId]?.atomic?.status;
    if (status !== "supported" && status !== "ready") return null;
  } catch {
    return null;
  }
  const { id } = await wal.sendCalls({ account, chain: wal.chain, calls, forceAtomic: true });
  const st = await wal.waitForCallsStatus({ id, timeout: 900_000 });
  const hash = st.receipts?.at(-1)?.transactionHash;
  if (st.status !== "success" || !hash) throw new Error("Burn reverted");
  return hash as string;
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
  const recipient = await recipient32(a.dest, a.recipient);
  const burnData = (amount: bigint) =>
    a.hookData
      ? encodeFunctionData({ abi: tokenMessengerAbi, functionName: "depositForBurnWithHook", args: [amount, a.dest.domain, recipient, usdc, ZERO32, a.maxFee, a.finality, a.hookData] })
      : encodeFunctionData({ abi: tokenMessengerAbi, functionName: "depositForBurn", args: [amount, a.dest.domain, recipient, usdc, ZERO32, a.maxFee, a.finality] });

  // Send what the wallet can actually cover: if gas will come out of the USDC, hold that back.
  const fit = async (maxCost: bigint) => {
    const held = await pub.readContract({ address: usdc, abi: erc20, functionName: "balanceOf", args: [account] });
    const room = held - (await usdcGasMargin(pub, a.chain, account, maxCost));
    const amount = room < a.amount ? room : a.amount;
    if (amount <= a.maxFee) {
      const f = (v: bigint) => (Number(v) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 6 });
      throw new Error(`Your wallet holds ${f(held)} USDC on ${a.chain.name} and no ${gasToken(a.chain).symbol} for gas, which leaves too little to send after fees. Nothing was burned.`);
    }
    if (amount < a.amount) a.onAdjusted?.(amount, held);
    return amount;
  };

  const allowance = await pub.readContract({ address: usdc, abi: erc20, functionName: "allowance", args: [account, messenger] });
  let approveTx: string | undefined;
  if (allowance < a.amount) {
    // One atomic batch where the wallet allows it: never an approval paid for without its burn. A batch
    // can't carry our gas settings and wallets pad its fee cap (up to ~10x), so batch only when the
    // wallet's gas token covers that padding; otherwise two transactions with tight gas, paid in gas token.
    const pair = await tightGas(pub, account, null, APPROVE_GAS + BURN_GAS);
    const native = await pub.getBalance({ address: account });
    let batched: string | null = null;
    if (native >= pair.maxCost * 15n) {
      const amount = await fit(pair.maxCost);
      batched = await batchBurn(wal, account, chain.id, [
        { to: usdc, data: encodeFunctionData({ abi: erc20, functionName: "approve", args: [messenger, amount] }) },
        { to: messenger, data: burnData(amount) },
      ]);
    }
    if (batched) {
      a.onApproved?.(batched);
      return batched;
    }
    const approveData = encodeFunctionData({ abi: erc20, functionName: "approve", args: [messenger, a.amount] });
    const g = await tightGas(pub, account, { to: usdc, data: approveData }, APPROVE_GAS);
    approveTx = await wal.sendTransaction({ to: usdc, data: approveData, account, chain, gas: g.gas, maxFeePerGas: g.maxFeePerGas, maxPriorityFeePerGas: g.maxPriorityFeePerGas });
    await pub.waitForTransactionReceipt({ hash: approveTx as `0x${string}` });
  }
  a.onApproved?.(approveTx);
  // Re-read after the approval: its gas may have been paid in USDC. Bridge what's left rather than nothing.
  const g = await tightGas(pub, account, null, BURN_GAS);
  const amount = await fit(g.maxCost);
  const burnTx = { to: messenger, data: burnData(amount) };
  const fees = await tightGas(pub, account, burnTx, BURN_GAS);
  const hash = await wal.sendTransaction({ ...burnTx, account, chain, gas: fees.gas, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas });
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error("Burn reverted");
  return hash as string;
}

async function evmMint(a: MintArgs) {
  if (await messageUsed(a.chain, a.message)) throw new AlreadyMinted();
  const def = bkDef(a.chain.id)!;
  const chain = viemChain(def);
  await evmSwitch(a.wallet, def);
  const account = a.wallet.address as `0x${string}`;
  const pub = createPublicClient({ chain, transport: http(def.rpcEndpoints?.[0]) });
  const wal = createWalletClient({ chain, account, transport: custom(a.wallet.evm!) });
  const mintTx = {
    to: def.cctp!.contracts!.v2!.messageTransmitter as `0x${string}`,
    data: encodeFunctionData({ abi: transmitterAbi, functionName: "receiveMessage", args: [a.message as `0x${string}`, a.attestation as `0x${string}`] }),
  };
  const g = await tightGas(pub, account, mintTx, 200_000n);
  const hash = await wal.sendTransaction({
    ...mintTx, account, chain, gas: g.gas,
    maxFeePerGas: a.fees?.maxFeePerGas ?? g.maxFeePerGas,
    maxPriorityFeePerGas: a.fees?.maxPriorityFeePerGas ?? g.maxPriorityFeePerGas,
  });
  a.onSent?.(hash);
  // A capped claim can wait hours for a gas dip.
  const rc = await pub.waitForTransactionReceipt({ hash, timeout: a.fees ? 86_400_000 : 600_000, pollingInterval: a.fees ? 15_000 : 2_000 });
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
      return suiBurn({ network: a.network, wallet: a.wallet.standard!, owner: a.wallet.address, amount: a.amount, destDomain: a.dest.domain, mintRecipient32: await recipient32(a.dest, a.recipient), maxFee: a.maxFee, hookData: a.hookData });
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
