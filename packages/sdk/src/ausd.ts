import { encodeFunctionData, getAddress, isAddress, parseUnits, toHex, type Address, type Hex, type PublicClient } from "viem";
import { ausdWrapperAbi, curveStablePoolAbi, erc20Abi } from "./abis.js";
import { APP_URL, AUSD_SAVINGS, DEFAULT_SLIPPAGE_BPS } from "./constants.js";
import { amount, type Amount } from "./format.js";
import type { Transaction } from "./client.js";

const W = AUSD_SAVINGS.address as Address;
const AUSD = AUSD_SAVINGS.asset as Address;
const POOL = AUSD_SAVINGS.pool as Address;
const A = AUSD_SAVINGS.assetDecimals;
const S = AUSD_SAVINGS.shareDecimals;
const PEG_FLOOR_BPS = 9_980n;

export type AUSDWithdrawAmount = { amount: string } | { shares: string } | { all: true };

export interface AUSDSavingsState {
  id: "setsAUSD";
  address: Address;
  asset: Address;
  /** Net APR of setsUSDC, where the savings are held. Before the two stable swaps. */
  netAprPct: number;
  totalAssets: Amount;
  /** How much more AUSD can come in before setsUSDC's cap. */
  capRemaining: Amount;
  /** What swapping 1,000 AUSD in and straight back out would cost today, in percent. */
  roundTripCostPct: number;
  /** Swaps revert if they would return less than this share of one-for-one, in percent. */
  pegFloorPct: number;
  /** True when a swap at today's pool price would clear the peg floor. */
  pegOk: boolean;
}

export interface AUSDPosition {
  owner: Address;
  shares: Amount;
  /** What redeeming every share would return now, in AUSD, after the swap. */
  value: Amount;
  /** Shares that setsUSDC can pay out right now. */
  redeemableShares: Amount;
  walletAUSD: Amount;
}

export interface AUSDQuote {
  ok: boolean;
  problems: string[];
  assets: Amount;
  shares: Amount;
}

export interface AUSDPrepared {
  vault: "setsAUSD";
  action: "deposit" | "withdraw";
  owner: Address;
  transactions: Transaction[];
  expected: { shares: Amount; assets: Amount };
  minimum: Amount;
  notes: string[];
}

/** EIP-712 typed data, ready for viem's signTypedData or a wallet's eth_signTypedData_v4. */
export interface TypedData<M> {
  domain: { name: string; version: string; chainId: number; verifyingContract: Address };
  types: Record<string, { name: string; type: string }[]>;
  primaryType: string;
  message: M;
}

const who = (owner: string): Address => {
  if (!isAddress(owner)) throw new Error(`"${owner}" is not an address.`);
  return getAddress(owner);
};
const minus = (v: bigint, bps: number) => (v * (10_000n - BigInt(bps))) / 10_000n;
const NOTE_RISK = "Setsuna contracts are unaudited and the vaults are capped. Save only what you can afford to lose.";

export function createAUSDSavings(client: PublicClient, setsUSDCNetApr: () => Promise<number>) {
  const read = <T>(functionName: string, args: unknown[] = [], blockNumber?: bigint) =>
    client.readContract({ address: W, abi: ausdWrapperAbi, functionName: functionName as never, args: args as never, blockNumber }) as Promise<T>;
  const dy = (i: number, j: number, dx: bigint) =>
    dx === 0n ? Promise.resolve(0n) : (client.readContract({ address: POOL, abi: curveStablePoolAbi, functionName: "get_dy", args: [BigInt(i), BigInt(j), dx] }) as Promise<bigint>);
  const parse = (value: string) => {
    if (!/^\d+(\.\d+)?$/.test(value)) throw new Error(`"${value}" is not a decimal amount.`);
    const raw = parseUnits(value, A);
    if (raw === 0n) throw new Error("The amount must be more than zero.");
    return raw;
  };

  /** setsAUSD today: rate, size, room under the cap, swap cost and whether the peg is healthy. */
  async function getSavings(): Promise<AUSDSavingsState> {
    const k = 1_000n * 10n ** BigInt(A);
    const [total, room, toUsdc, apr] = await Promise.all([read<bigint>("totalAssets"), read<bigint>("maxDeposit", [W]), dy(0, 1, k), setsUSDCNetApr()]);
    const back = await dy(1, 0, toUsdc);
    return {
      id: "setsAUSD",
      address: W,
      asset: AUSD,
      netAprPct: apr,
      totalAssets: amount(total, A),
      capRemaining: amount(room, A),
      roundTripCostPct: Number(((k - back) * 1_000_000n) / k) / 10_000,
      pegFloorPct: 99.8,
      pegOk: toUsdc * 10_000n >= k * PEG_FLOOR_BPS && back * 10_000n >= toUsdc * PEG_FLOOR_BPS,
    };
  }

  async function getPosition(owner: string): Promise<AUSDPosition> {
    const o = who(owner);
    const [shares, redeemable, wallet] = await Promise.all([
      read<bigint>("balanceOf", [o]),
      read<bigint>("maxRedeem", [o]),
      client.readContract({ address: AUSD, abi: erc20Abi, functionName: "balanceOf", args: [o] }) as Promise<bigint>,
    ]);
    const value = shares === 0n ? 0n : await read<bigint>("previewRedeem", [shares]);
    return { owner: o, shares: amount(shares, S), value: amount(value, A), redeemableShares: amount(redeemable, S), walletAUSD: amount(wallet, A) };
  }

  async function quoteDeposit(assets: string, owner?: string): Promise<AUSDQuote> {
    const raw = parse(assets);
    const problems: string[] = [];
    const [room, toUsdc] = await Promise.all([read<bigint>("maxDeposit", [W]), dy(0, 1, raw)]);
    if (toUsdc * 10_000n < raw * PEG_FLOOR_BPS) problems.push("AUSD and USDC are more than 0.2% apart in the pool right now, so savings are paused until the peg returns.");
    if (raw > room) problems.push(`setsUSDC can take about ${amount(room, A).formatted} more before its cap.`);
    if (owner) {
      const bal = (await client.readContract({ address: AUSD, abi: erc20Abi, functionName: "balanceOf", args: [who(owner)] })) as bigint;
      if (bal < raw) problems.push(`The wallet holds ${amount(bal, A).formatted} AUSD, less than ${assets}.`);
    }
    const shares = problems.length ? 0n : await read<bigint>("previewDeposit", [raw]);
    return { ok: problems.length === 0, problems, assets: amount(raw, A), shares: amount(shares, S) };
  }

  async function sharesFor(o: Address, request: AUSDWithdrawAmount) {
    const balance = await read<bigint>("balanceOf", [o]);
    if ("all" in request) return balance;
    if ("shares" in request) return parseUnits(request.shares, S);
    // An AUSD amount: the shares worth it at setsUSDC's price, before the swap back.
    return read<bigint>("convertToShares", [parse(request.amount)]);
  }

  async function quoteWithdraw(owner: string, request: AUSDWithdrawAmount): Promise<AUSDQuote> {
    const o = who(owner);
    const shares = await sharesFor(o, request);
    const problems: string[] = [];
    const [balance, redeemable] = await Promise.all([read<bigint>("balanceOf", [o]), read<bigint>("maxRedeem", [o])]);
    if (shares === 0n) problems.push("There is nothing to withdraw.");
    else if (shares > balance) problems.push(`The wallet holds ${amount(balance, S).formatted} setsAUSD, less than requested.`);
    else if (shares > redeemable) problems.push(`Only ${amount(redeemable, S).formatted} setsAUSD can be redeemed right now, while the markets hold the rest.`);
    let assets = 0n;
    if (!problems.length) {
      const [out, usdcValue] = await Promise.all([read<bigint>("previewRedeem", [shares]), read<bigint>("convertToAssets", [shares])]);
      if (out * 10_000n < usdcValue * PEG_FLOOR_BPS) problems.push("AUSD and USDC are more than 0.2% apart in the pool right now, so withdrawals in AUSD are paused. unwrap still returns plain setsUSDC.");
      else assets = out;
    }
    return { ok: problems.length === 0, problems, assets: amount(assets, A), shares: amount(shares, S) };
  }

  /** Unsigned transactions for a saver who pays their own gas: an exact AUSD approval when needed, then the deposit. */
  async function prepareDeposit(assets: string, owner: string, opts: { slippageBps?: number } = {}): Promise<AUSDPrepared> {
    const o = who(owner);
    const quote = await quoteDeposit(assets, o);
    if (!quote.ok) throw new Error(quote.problems.join(" "));
    const raw = BigInt(quote.assets.raw);
    const minShares = minus(BigInt(quote.shares.raw), opts.slippageBps ?? DEFAULT_SLIPPAGE_BPS);
    const allowance = (await client.readContract({ address: AUSD, abi: erc20Abi, functionName: "allowance", args: [o, W] })) as bigint;
    const transactions: Transaction[] = [];
    if (allowance < raw)
      transactions.push({ label: `Allow setsAUSD to take exactly ${quote.assets.formatted} AUSD`, to: AUSD, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [W, raw] }), value: "0", chainId: 143 });
    transactions.push({
      label: `Save ${quote.assets.formatted} AUSD in setsAUSD`,
      to: W,
      data: encodeFunctionData({ abi: ausdWrapperAbi, functionName: "depositWithMinShares", args: [raw, o, minShares] }),
      value: "0",
      chainId: 143,
    });
    return {
      vault: "setsAUSD",
      action: "deposit",
      owner: o,
      transactions,
      expected: { shares: quote.shares, assets: quote.assets },
      minimum: amount(minShares, S),
      notes: [NOTE_RISK, `The deposit reverts if it would mint fewer than ${amount(minShares, S).formatted} setsAUSD.`, `Or use the app: ${APP_URL}`],
    };
  }

  /** Unsigned transaction for a saver who pays their own gas: redeem back to the owner in AUSD. */
  async function prepareWithdraw(owner: string, request: AUSDWithdrawAmount, opts: { slippageBps?: number } = {}): Promise<AUSDPrepared> {
    const o = who(owner);
    const quote = await quoteWithdraw(o, request);
    if (!quote.ok) throw new Error(quote.problems.join(" "));
    const shares = BigInt(quote.shares.raw);
    const minAssets = minus(BigInt(quote.assets.raw), opts.slippageBps ?? DEFAULT_SLIPPAGE_BPS);
    return {
      vault: "setsAUSD",
      action: "withdraw",
      owner: o,
      transactions: [
        {
          label: `Withdraw ${quote.assets.formatted} AUSD from setsAUSD`,
          to: W,
          data: encodeFunctionData({ abi: ausdWrapperAbi, functionName: "redeemWithMinAssets", args: [shares, o, o, minAssets] }),
          value: "0",
          chainId: 143,
        },
      ],
      expected: { shares: quote.shares, assets: quote.assets },
      minimum: amount(minAssets, A),
      notes: [`The withdrawal reverts if it would return less than ${amount(minAssets, A).formatted} AUSD.`],
    };
  }

  /**
   * For apps whose relayer pays the gas: what the saver signs to move AUSD to the app's saving
   * contract (`to`) with EIP-3009 receiveWithAuthorization. Only `to` can carry it out, so `to`
   * must be the contract that then calls setsAUSD `deposit(value, owner)` in the saver's name.
   */
  function buildGaslessDeposit(params: { owner: string; to: string; amount: string; validForSeconds?: number; nonce?: Hex; now?: number }) {
    const owner = who(params.owner);
    const to = who(params.to);
    const value = parse(params.amount);
    const now = params.now ?? Math.floor(Date.now() / 1000);
    const nonce = params.nonce ?? (toHex(crypto.getRandomValues(new Uint8Array(32))) as Hex);
    const typedData: TypedData<{ from: Address; to: Address; value: bigint; validAfter: bigint; validBefore: bigint; nonce: Hex }> = {
      domain: { name: AUSD_SAVINGS.assetName, version: "1", chainId: 143, verifyingContract: AUSD },
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
      message: { from: owner, to, value, validAfter: 0n, validBefore: BigInt(now + (params.validForSeconds ?? 600)), nonce },
    };
    return { typedData, notes: ["The saver signs this; the app's relayer submits it and pays the gas.", NOTE_RISK] };
  }

  /**
   * For apps whose relayer pays the gas: the EIP-2612 permit the saver signs on their setsAUSD so
   * `spender` (the app's contract) can call `redeem(shares, owner, owner)`. The AUSD only goes to the owner.
   */
  async function buildGaslessWithdraw(params: { owner: string; spender: string; request: AUSDWithdrawAmount; validForSeconds?: number; now?: number }) {
    const owner = who(params.owner);
    const spender = who(params.spender);
    const quote = await quoteWithdraw(owner, params.request);
    if (!quote.ok) throw new Error(quote.problems.join(" "));
    const now = params.now ?? Math.floor(Date.now() / 1000);
    const nonce = await read<bigint>("nonces", [owner]);
    const typedData: TypedData<{ owner: Address; spender: Address; value: bigint; nonce: bigint; deadline: bigint }> = {
      domain: { name: AUSD_SAVINGS.name, version: "1", chainId: 143, verifyingContract: W },
      types: {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "Permit",
      message: { owner, spender, value: BigInt(quote.shares.raw), nonce, deadline: BigInt(now + (params.validForSeconds ?? 600)) },
    };
    return { typedData, expected: { shares: quote.shares, assets: quote.assets }, notes: ["The saver signs this; the app's relayer submits it and pays the gas."] };
  }

  return { getSavings, getPosition, quoteDeposit, quoteWithdraw, prepareDeposit, prepareWithdraw, buildGaslessDeposit, buildGaslessWithdraw };
}
