import { encodeAbiParameters, getAddress, isAddress, keccak256, pad, parseUnits, toHex, type Address, type Hex, type PublicClient } from "viem";
import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha2";
import { base58 } from "@scure/base";
import { curveStablePoolAbi, erc20Abi } from "./abis.js";
import { AUSD_SAVINGS, RELAYER_URL } from "./constants.js";
import { amount, type Amount } from "./format.js";
import type { TypedData } from "./ausd.js";

/**
 * Sponsored bridging out of Monad through Circle CCTP V2. The user signs one message; Setsuna's
 * relayer submits it through SetsunaBridgeSponsor and pays the MON. AUSD is swapped to USDC on the
 * Curve pool setsAUSD uses (never below 99.8%). With forwarding, Circle mints on the destination and
 * takes its fee from the USDC, so the recipient needs no gas there either.
 */
export const BRIDGE = {
  /** SetsunaBridgeSponsor on Monad mainnet (deployed 6 November 2026, Sourcify exact match). */
  sponsor: "0xeabF1Aa629a686C9E5862b316F954bF2C0b68DBe",
  usdc: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
  ausd: AUSD_SAVINGS.asset,
  /** Monad's CCTP domain. */
  domain: 15,
  minAmount: "1",
  /** Circle charges the whole fee ceiling, and its fee drifts a little between quote and send. */
  feeMarginBps: 500,
  iris: "https://iris-api.circle.com",
} as const;

export type BridgeToken = "USDC" | "AUSD";
export type Ecosystem = "evm" | "solana" | "sui" | "aptos";

export interface BridgeChain {
  /** Circle's CCTP domain: what `destinationDomain` takes. */
  domain: number;
  name: string;
  ecosystem: Ecosystem;
  /** EVM chain ID, where there is one. */
  chainId: number | null;
  /** Square logo, or null where none is published (show a placeholder). */
  icon: string | null;
  /**
   * True when Circle delivers on this chain and takes its gas from the USDC, so the recipient needs
   * nothing there. False: the USDC is burned on Monad and the recipient claims it on this chain
   * with their own gas.
   */
  gasInUSDC: boolean;
}

const ICONS = "https://bridge.setsuna.finance/icons";
const chain = (domain: number, name: string, chainId: number | null, icon: string | null, gasInUSDC: boolean, ecosystem: Ecosystem = "evm"): BridgeChain => ({
  domain,
  name,
  ecosystem,
  chainId,
  icon: icon ? `${ICONS}/${icon}.svg` : null,
  gasInUSDC,
});

/**
 * Where USDC can go from Monad, from Circle's CCTP V2 chain list (Bridge Kit) on 6 November 2026.
 * `gasInUSDC` is true only where Circle lists the chain for forwarding AND its fee API quotes it from
 * Monad. Cronos, Plasma and X Layer get a quote but aren't listed, so they stay false until proven.
 */
export const BRIDGE_CHAINS: readonly BridgeChain[] = [
  chain(0, "Ethereum", 1, "ethereum", true),
  chain(6, "Base", 8453, "base", true),
  chain(3, "Arbitrum", 42161, "arbitrum", true),
  chain(5, "Solana", null, "solana", true, "solana"),
  chain(2, "OP Mainnet", 10, "optimism", true),
  chain(7, "Polygon PoS", 137, "polygon", true),
  chain(1, "Avalanche", 43114, "avalanche", true),
  chain(10, "Unichain", 130, "unichain", true),
  chain(11, "Linea", 59144, "linea", true),
  chain(19, "HyperEVM", 999, "hyperevm", true),
  chain(14, "World Chain", 480, "world_chain", true),
  chain(13, "Sonic", 146, "sonic", true),
  chain(16, "Sei", 1329, "sei", true),
  chain(21, "Ink", 57073, "ink", true),
  chain(26, "Arc", 5042, "arc", true),
  chain(12, "Codex", 81224, "codex", true),
  chain(22, "Plume", 98866, "plume", true),
  chain(18, "XDC", 50, "xdc", true),
  chain(28, "Edge", 3343, null, true),
  chain(8, "Sui", null, "sui", false, "sui"),
  chain(9, "Aptos", null, "aptos", false, "aptos"),
  chain(32, "Cronos", 25, "cronos", false),
  chain(33, "Plasma", 9745, "plasma", false),
  chain(37, "X Layer", 196, "x_layer", false),
  chain(29, "Injective", 1776, "injective", false),
  chain(30, "Morph", 2818, null, false),
  chain(31, "Pharos", 1672, null, false),
];

export interface BridgeQuote {
  ok: boolean;
  problems: string[];
  token: BridgeToken;
  destination: BridgeChain;
  /** What leaves the wallet, in `token`. */
  amount: Amount;
  /** USDC burned on Monad: the amount itself, or what the AUSD swap returns today. */
  burned: Amount;
  /** AUSD only: the swap reverts below this. Zero for USDC. */
  minUsdcOut: Amount;
  forward: boolean;
  /** Most Circle may keep, which it does keep in full: its delivery fee plus a small margin. */
  maxFee: Amount;
  /** What the recipient should get on the destination, in USDC. */
  receive: Amount;
  /** Setsuna's relayer pays the Monad gas. */
  sponsored: true;
}

export interface BridgeTransfer {
  owner: Address;
  value: string;
  validAfter: string;
  validBefore: string;
  salt: Hex;
  destinationDomain: number;
  mintRecipient: Hex;
  maxFee: string;
  minFinalityThreshold: number;
  forward: boolean;
  minUsdcOut: string;
}

export type ReceiveAuthorization = { from: Address; to: Address; value: bigint; validAfter: bigint; validBefore: bigint; nonce: Hex };

export interface SponsoredBridgeRequest {
  token: BridgeToken;
  transfer: BridgeTransfer;
  /** Sign this (viem `signTypedData`, or a wallet's eth_signTypedData_v4) and pass the signature on. */
  typedData: TypedData<ReceiveAuthorization>;
  quote: BridgeQuote;
}

export interface BridgeSubmitted {
  /** The burn transaction on Monad. Pass it to `getStatus` or `waitForDelivery`. */
  burnTx: Hex;
  block: string;
  burned: Amount | null;
  destinationDomain: number;
  /** What Setsuna's relayer paid in MON. */
  gasPaidMON: string;
}

export interface BridgeStatus {
  /**
   * pending: Circle hasn't attested the burn yet (or hasn't indexed it). attested: Circle signed it;
   * with forwarding it is being delivered, without it the recipient can now claim. delivered: minted
   * on the destination.
   */
  state: "pending" | "attested" | "delivered";
  burnTx: Hex;
  destinationDomain: number | null;
  amount: Amount | null;
  /** What Circle kept, once delivered. */
  feeCharged: Amount | null;
  destinationTx: string | null;
  /** Circle's message and attestation, for claiming on the destination without forwarding. */
  message: Hex | null;
  attestation: Hex | null;
}

const USDC_DECIMALS = 6;
const SOLANA_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SPL_TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ASSOCIATED_TOKEN = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

const BRIDGE_TYPEHASH = keccak256(
  toHex(
    "SetsunaBridge(address sponsor,uint256 chainId,address token,uint32 destinationDomain,bytes32 mintRecipient,uint256 maxFee,uint32 minFinalityThreshold,bool forward,uint256 minUsdcOut,bytes32 salt)",
  ),
);
const TOKEN_DOMAIN: Record<BridgeToken, { name: string; version: string; address: Address }> = {
  // Each checked against the token's DOMAIN_SEPARATOR on Monad (AUSD's name() is "AUSD"; its EIP-712 name is not).
  USDC: { name: "USDC", version: "2", address: BRIDGE.usdc },
  AUSD: { name: AUSD_SAVINGS.assetName, version: "1", address: BRIDGE.ausd as Address },
};

const fail = (message: string): never => {
  throw new Error(message);
};

export function bridgeChain(domain: number): BridgeChain {
  return BRIDGE_CHAINS.find((c) => c.domain === domain) ?? fail(`CCTP domain ${domain} isn't a destination Setsuna can bridge to from Monad.`);
}

/** A Solana wallet's USDC token account (ATA): where Circle mints, not the wallet itself. */
export function solanaUsdcAccount(wallet: string): Hex {
  const owner = base58.decode(wallet);
  if (owner.length !== 32) fail(`"${wallet}" is not a Solana address.`);
  const seeds = [owner, base58.decode(SPL_TOKEN), base58.decode(SOLANA_USDC)];
  const program = base58.decode(ASSOCIATED_TOKEN);
  const marker = new TextEncoder().encode("ProgramDerivedAddress");
  for (let bump = 255; bump >= 0; bump--) {
    const hash = sha256(new Uint8Array([...seeds.flatMap((s) => [...s]), bump, ...program, ...marker]));
    try {
      ed25519.ExtendedPoint.fromHex(hash); // on the curve: not a program address, try the next bump
    } catch {
      return toHex(hash);
    }
  }
  return fail("No token account address found.");
}

/** The 32-byte mint recipient CCTP needs for `recipient` on `destination`. */
export function mintRecipient(destination: BridgeChain, recipient: string): Hex {
  if (destination.ecosystem === "evm") {
    if (!isAddress(recipient)) fail(`"${recipient}" is not an address on ${destination.name}.`);
    return pad(getAddress(recipient).toLowerCase() as Hex);
  }
  if (destination.ecosystem === "solana") return solanaUsdcAccount(recipient);
  // Sui and Aptos: a 32-byte hex address.
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(recipient)) fail(`"${recipient}" is not a ${destination.name} address.`);
  return pad(recipient.toLowerCase() as Hex, { size: 32 });
}

/** The EIP-3009 nonce SetsunaBridgeSponsor recomputes: it commits the signature to every bridge detail. */
export function authorizationNonce(token: BridgeToken, t: Pick<BridgeTransfer, "destinationDomain" | "mintRecipient" | "maxFee" | "minFinalityThreshold" | "forward" | "minUsdcOut" | "salt">): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" }, { type: "address" }, { type: "uint256" }, { type: "address" }, { type: "uint32" }, { type: "bytes32" },
        { type: "uint256" }, { type: "uint32" }, { type: "bool" }, { type: "uint256" }, { type: "bytes32" },
      ],
      [
        BRIDGE_TYPEHASH, BRIDGE.sponsor, 143n, TOKEN_DOMAIN[token].address, t.destinationDomain, t.mintRecipient,
        BigInt(t.maxFee), t.minFinalityThreshold, t.forward, BigInt(t.minUsdcOut), t.salt,
      ],
    ),
  );
}

export function createBridge(client: PublicClient, relayerUrl = RELAYER_URL) {
  const usd = (raw: bigint) => amount(raw, USDC_DECIMALS);

  /** Every chain Setsuna can bridge to from Monad, for a chain picker. */
  function chains(): BridgeChain[] {
    return BRIDGE_CHAINS.map((c) => ({ ...c }));
  }

  /** Circle's fee from Monad to `domain` at standard finality: protocol bps and, with forwarding, the delivery fee. */
  async function circleFees(domain: number, forward: boolean) {
    // Asking for forwarding to a chain Circle doesn't deliver on is an error, not an empty quote.
    const res = await fetch(`${BRIDGE.iris}/v2/burn/USDC/fees/${BRIDGE.domain}/${domain}${forward ? "?forward=true" : ""}`);
    if (!res.ok) return null;
    const quotes = (await res.json()) as { finalityThreshold: number; minimumFee: number; forwardFee?: { med: number } }[];
    if (!Array.isArray(quotes)) return null;
    const q = quotes.find((x) => x.finalityThreshold === 2000) ?? quotes[0];
    if (!q) return null;
    return { bps: q.minimumFee ?? 0, delivery: q.forwardFee?.med == null ? null : BigInt(Math.ceil(q.forwardFee.med)) };
  }

  /**
   * What a sponsored bridge would do today: the swap (for AUSD), Circle's fee and what arrives.
   * `forward` defaults to the destination's `gasInUSDC`.
   */
  async function quote(p: { token: BridgeToken; amount: string; destinationDomain: number; forward?: boolean; slippageBps?: number }): Promise<BridgeQuote> {
    if (p.token !== "USDC" && p.token !== "AUSD") fail('token must be "USDC" or "AUSD".');
    const destination = bridgeChain(p.destinationDomain);
    const forward = p.forward ?? destination.gasInUSDC;
    const problems: string[] = [];
    let value: bigint;
    try {
      value = parseUnits(p.amount, USDC_DECIMALS);
    } catch {
      return fail(`"${p.amount}" is not an amount.`);
    }
    if (value < parseUnits(BRIDGE.minAmount, USDC_DECIMALS)) problems.push(`Sponsored bridges start at ${BRIDGE.minAmount} ${p.token}.`);
    if (forward && !destination.gasInUSDC) problems.push(`Circle doesn't deliver on ${destination.name}; the recipient must claim it there with their own gas (forward: false).`);

    let burned = value;
    let minUsdcOut = 0n;
    if (p.token === "AUSD" && value > 0n) {
      burned = await client.readContract({ address: AUSD_SAVINGS.pool as Address, abi: curveStablePoolAbi, functionName: "get_dy", args: [0n, 1n, value] });
      const floor = (value * 9_980n) / 10_000n;
      const slip = BigInt(p.slippageBps ?? 10);
      minUsdcOut = (burned * (10_000n - slip)) / 10_000n;
      if (minUsdcOut < floor) minUsdcOut = floor;
      if (burned < floor) problems.push("AUSD is trading below 99.8% of USDC right now, so the swap would revert. Try again later.");
    }

    const fees = await circleFees(destination.domain, forward && destination.gasInUSDC);
    if (!fees) problems.push("Circle's fee service didn't answer. Try again shortly.");
    let maxFee = fees ? (burned * BigInt(Math.round(fees.bps * 100)) + 999_999n) / 1_000_000n : 0n;
    if (forward && fees) {
      if (fees.delivery === null) problems.push(`Circle isn't quoting delivery to ${destination.name} right now.`);
      else maxFee += (fees.delivery * BigInt(10_000 + BRIDGE.feeMarginBps) + 9_999n) / 10_000n;
    }
    const least = p.token === "AUSD" ? minUsdcOut : value;
    if (maxFee >= least && value > 0n) problems.push("The amount is too small to cover Circle's fee.");
    return {
      ok: problems.length === 0,
      problems,
      token: p.token,
      destination,
      amount: amount(value, USDC_DECIMALS),
      burned: usd(burned),
      minUsdcOut: usd(minUsdcOut),
      forward,
      maxFee: usd(maxFee),
      receive: usd(burned > maxFee ? burned - maxFee : 0n),
      sponsored: true,
    };
  }

  /**
   * What the user signs for a sponsored bridge. Quote first; sign `typedData`; then pass everything
   * to `submitSponsored`. Valid for 10 minutes by default.
   */
  function buildSponsored(p: { owner: string; recipient: string; quote: BridgeQuote; validForSeconds?: number; salt?: Hex; now?: number }): SponsoredBridgeRequest {
    const q = p.quote;
    if (!q.ok) fail(q.problems.join(" "));
    if (!isAddress(p.owner)) fail(`"${p.owner}" is not an address.`);
    const owner = getAddress(p.owner);
    const now = p.now ?? Math.floor(Date.now() / 1000);
    const transfer: BridgeTransfer = {
      owner,
      value: q.amount.raw,
      validAfter: "0",
      validBefore: String(now + (p.validForSeconds ?? 600)),
      salt: p.salt ?? toHex(crypto.getRandomValues(new Uint8Array(32))),
      destinationDomain: q.destination.domain,
      mintRecipient: mintRecipient(q.destination, p.recipient),
      maxFee: q.maxFee.raw,
      minFinalityThreshold: 2000,
      forward: q.forward,
      minUsdcOut: q.minUsdcOut.raw,
    };
    const d = TOKEN_DOMAIN[q.token];
    return {
      token: q.token,
      transfer,
      quote: q,
      typedData: {
        domain: { name: d.name, version: d.version, chainId: 143, verifyingContract: d.address },
        types: {
          ReceiveWithAuthorization: [
            { name: "from", type: "address" },
            { name: "to", type: "address" },
            { name: "value", type: "uint256" },
            { name: "validAfter", type: "uint256" },
            { name: "validBefore", type: "uint256" },
            { name: "nonce", type: "bytes32" },
          ],
        },
        primaryType: "ReceiveWithAuthorization",
        message: {
          from: owner,
          to: BRIDGE.sponsor,
          value: BigInt(transfer.value),
          validAfter: 0n,
          validBefore: BigInt(transfer.validBefore),
          nonce: authorizationNonce(q.token, transfer),
        },
      },
    };
  }

  /** Sends the signed bridge to Setsuna's relayer, which burns it on Monad and pays the gas. */
  async function submitSponsored(signed: Pick<SponsoredBridgeRequest, "token" | "transfer"> & { signature: Hex; app?: string }): Promise<BridgeSubmitted> {
    const res = await fetch(`${relayerUrl}/v1/bridge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: signed.token, transfer: signed.transfer, signature: signed.signature, app: signed.app }),
    });
    const out = (await res.json().catch(() => ({}))) as { error?: string; txHash: Hex; block: string; burned: string | null; destinationDomain: number; gasPaidMON: string };
    if (!res.ok) fail(out.error ?? `The relayer answered ${res.status}.`);
    return { burnTx: out.txHash, block: out.block, burned: out.burned === null ? null : usd(BigInt(out.burned)), destinationDomain: out.destinationDomain, gasPaidMON: out.gasPaidMON };
  }

  /** Where a bridge stands, from Circle's record of the burn. Unknown to Circle yet reads as pending. */
  async function getStatus(burnTx: Hex): Promise<BridgeStatus> {
    const empty: BridgeStatus = { state: "pending", burnTx, destinationDomain: null, amount: null, feeCharged: null, destinationTx: null, message: null, attestation: null };
    const res = await fetch(`${BRIDGE.iris}/v2/messages/${BRIDGE.domain}?transactionHash=${burnTx}`).catch(() => null);
    if (!res?.ok) return empty;
    const m = ((await res.json()) as { messages?: Record<string, any>[] }).messages?.[0];
    if (!m) return empty;
    const body = m.decodedMessage?.decodedMessageBody;
    const attested = m.status === "complete" && !!m.attestation && m.attestation !== "PENDING";
    const destinationTx = (m.forwardTxHash || m.destinationMintTxHash || null) as string | null;
    return {
      state: destinationTx ? "delivered" : attested ? "attested" : "pending",
      burnTx,
      destinationDomain: m.decodedMessage ? Number(m.decodedMessage.destinationDomain) : null,
      amount: body?.amount ? usd(BigInt(body.amount)) : null,
      feeCharged: destinationTx && body?.feeExecuted != null ? usd(BigInt(body.feeExecuted)) : null,
      destinationTx,
      message: attested ? (m.message as Hex) : null,
      attestation: attested ? (m.attestation as Hex) : null,
    };
  }

  /** Polls Circle until the USDC is delivered (forwarding) or attested (no forwarding), or time runs out. */
  async function waitForDelivery(burnTx: Hex, opts: { timeoutMs?: number; intervalMs?: number; forward?: boolean } = {}): Promise<BridgeStatus> {
    const until = Date.now() + (opts.timeoutMs ?? 15 * 60_000);
    for (;;) {
      const s = await getStatus(burnTx);
      if (s.state === "delivered" || (opts.forward === false && s.state === "attested")) return s;
      if (Date.now() >= until) return s;
      await new Promise((r) => setTimeout(r, opts.intervalMs ?? 5_000));
    }
  }

  /** The wallet's USDC and AUSD on Monad, for showing what can be bridged. */
  async function balances(owner: string): Promise<Record<BridgeToken, Amount>> {
    if (!isAddress(owner)) fail(`"${owner}" is not an address.`);
    const [usdc, ausd] = await Promise.all(
      [BRIDGE.usdc, BRIDGE.ausd].map((token) => client.readContract({ address: token as Address, abi: erc20Abi, functionName: "balanceOf", args: [getAddress(owner)] })),
    );
    return { USDC: usd(usdc), AUSD: amount(ausd, AUSD_SAVINGS.assetDecimals) };
  }

  return { chains, quote, buildSponsored, submitSponsored, getStatus, waitForDelivery, balances };
}
