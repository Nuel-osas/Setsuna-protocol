import {
  createPublicClient,
  encodeFunctionData,
  getAddress,
  http,
  isAddress,
  parseUnits,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { adapterAbi, erc20Abi, monGatewayAbi, multiVaultAbi, vaultAbi } from "./abis.js";
import {
  APP_URL,
  DEFAULT_DEADLINE_SECONDS,
  DEFAULT_RPC,
  DEFAULT_SLIPPAGE_BPS,
  VAULTS,
  monad,
  type VaultConfig,
  type VaultId,
  type Venue,
} from "./constants.js";
import { amount, bpsToPercent, iso, percentFrom1e18, percentOf, type Amount } from "./format.js";

export interface SetsunaOptions {
  /** A viem public client for Monad (chain 143). Takes precedence over `rpcUrl`. */
  client?: PublicClient;
  /** Monad RPC. Defaults to https://rpc2.monad.xyz. */
  rpcUrl?: string;
}

export interface Allocation {
  venue: Venue;
  market: string;
  adapter: Address;
  assets: Amount;
  /** Share of the vault's net assets held in this market, in percent. */
  sharePct: number;
  /** The market's current base supply APR, in percent. */
  aprPct: number;
  disabled: boolean;
}

export interface VaultState {
  id: VaultId;
  address: Address;
  assetSymbol: "USDC" | "MON";
  block: { number: string; time: string | null };
  netAssets: Amount;
  /** False when a market's value could not be read; the vault then refuses deposits and redemptions. */
  healthy: boolean;
  totalShares: Amount;
  /** Assets one whole share redeems for today. */
  sharePrice: Amount;
  /** Income of the current allocation over net assets, before the performance fee, in percent. */
  baseAprPct: number;
  /** baseAprPct after the performance fee on yield. */
  netAprPct: number;
  performanceFeePct: number;
  idle: { assets: Amount; sharePct: number };
  allocations: Allocation[];
  cap: Amount;
  /** How much more the vault accepts before its cap. Zero while deposits are paused. */
  capRemaining: Amount;
  depositsPaused: boolean;
  lastRebalanceAt: string | null;
  appUrl: string;
}

export interface Market {
  vault: VaultId;
  venue: Venue;
  market: string;
  adapter: Address;
  aprPct: number;
  marketSupply: Amount;
  availableLiquidity: Amount;
  /** Markets smaller than the vault's minimum size get no new money. */
  eligible: boolean;
  disabled: boolean;
}

export interface VaultPosition {
  vault: VaultId;
  shares: Amount;
  assets: Amount;
  /** What could be redeemed right now, limited by the markets' available cash. */
  withdrawableNow: Amount;
}

export interface Position {
  owner: Address;
  block: string;
  vaults: VaultPosition[];
  wallet: { USDC: Amount; MON: Amount };
}

export interface Transaction {
  /** What this step does, in plain words. */
  label: string;
  to: Address;
  data: Hex;
  /** Native MON to send, in wei, as a string. */
  value: string;
  chainId: 143;
}

export interface Prepared {
  vault: VaultId;
  action: "deposit" | "withdraw";
  owner: Address;
  /** Send these in order from `owner`. Nothing is signed or sent by the SDK. */
  transactions: Transaction[];
  /** What the final step gives, at the current quote. */
  expected: { shares: Amount; assets: Amount };
  /** The least the final step accepts before it reverts. */
  minimum: Amount;
  /** After this time the final step reverts with DeadlineExpired; prepare again. */
  expiresAt: string;
  appUrl: string;
  notes: string[];
}

export type WithdrawAmount = { amount: string } | { shares: string } | { all: true };

const vaultOf = (id: VaultId | string): VaultConfig => {
  const v = VAULTS[id as VaultId];
  if (!v) throw new Error(`Unknown vault "${id}". Use "setsUSDC" or "setsMON".`);
  return v;
};
const ownerOf = (owner: string): Address => {
  if (!isAddress(owner)) throw new Error(`"${owner}" is not an address.`);
  return getAddress(owner);
};
const appUrlOf = (v: VaultConfig) => `${APP_URL}/earn/${v.assetSymbol === "USDC" ? "usdc" : "mon"}/`;

/** Read Setsuna's Earn vaults on Monad and prepare deposits and withdrawals. Read-only: it never holds a key. */
export function createSetsuna(options: SetsunaOptions = {}) {
  const client: PublicClient =
    options.client ?? (createPublicClient({ chain: monad, transport: http(options.rpcUrl ?? DEFAULT_RPC, { retryCount: 3, timeout: 20_000 }) }) as PublicClient);

  async function head() {
    const block = await client.getBlock();
    if ((await client.getChainId()) !== 143) throw new Error("The client is not on Monad mainnet (chain 143).");
    return block;
  }

  async function getVault(id: VaultId): Promise<VaultState> {
    const v = vaultOf(id);
    const block = await head();
    const at = { blockNumber: block.number } as const;
    const read = <T>(functionName: string, args: unknown[] = []) =>
      client.readContract({ address: v.address, abi: vaultAbi, functionName: functionName as never, args: args as never, ...at }) as Promise<T>;
    const [accounting, supply, cap, paused, feeBps, lastRebalance, onePrice, room, idle] = await Promise.all([
      read<readonly [bigint, boolean]>("accounting"),
      read<bigint>("totalSupply"),
      read<bigint>("depositCap"),
      read<boolean>("depositsPaused"),
      read<bigint>("performanceFeeBps"),
      read<bigint>("lastRebalanceAt"),
      read<bigint>("convertToAssets", [10n ** BigInt(v.shareDecimals)]),
      read<bigint>("maxDeposit", ["0x0000000000000000000000000000000000000001"]),
      client.readContract({ address: v.asset, abi: erc20Abi, functionName: "balanceOf", args: [v.address], ...at }),
    ]);
    const [nav, healthy] = accounting;
    const venues = await Promise.all(
      v.venues.map(async (x, i) => {
        const [assets, apr, disabled] = await Promise.all([
          client.readContract({ address: x.adapter, abi: adapterAbi, functionName: "totalAssets", ...at }),
          client.readContract({ address: x.adapter, abi: adapterAbi, functionName: "supplyApr", args: [0n], ...at }).catch(() => 0n),
          read<boolean>("disabled", [BigInt(i)]),
        ]);
        return { ...x, assets, apr, disabled };
      }),
    );
    const income = venues.reduce((s, x) => s + (x.assets * x.apr) / 10n ** 18n, 0n);
    const baseApr = nav === 0n ? 0n : (income * 10n ** 18n) / nav;
    const fee = bpsToPercent(feeBps);
    return {
      id: v.id,
      address: v.address,
      assetSymbol: v.assetSymbol,
      block: { number: block.number.toString(), time: iso(block.timestamp) },
      netAssets: amount(nav, v.assetDecimals),
      healthy,
      totalShares: amount(supply, v.shareDecimals),
      sharePrice: amount(onePrice, v.assetDecimals),
      baseAprPct: percentFrom1e18(baseApr),
      netAprPct: Math.round(percentFrom1e18(baseApr) * (1 - fee / 100) * 10_000) / 10_000,
      performanceFeePct: fee,
      idle: { assets: amount(idle, v.assetDecimals), sharePct: percentOf(idle, nav) },
      allocations: venues.map((x) => ({
        venue: x.venue,
        market: x.market,
        adapter: x.adapter,
        assets: amount(x.assets, v.assetDecimals),
        sharePct: percentOf(x.assets, nav),
        aprPct: percentFrom1e18(x.apr),
        disabled: x.disabled,
      })),
      cap: amount(cap, v.assetDecimals),
      capRemaining: amount(paused ? 0n : room, v.assetDecimals),
      depositsPaused: paused,
      lastRebalanceAt: iso(lastRebalance),
      appUrl: appUrlOf(v),
    };
  }

  async function getVaults(): Promise<VaultState[]> {
    return Promise.all((Object.keys(VAULTS) as VaultId[]).map(getVault));
  }

  async function getMarkets(): Promise<Market[]> {
    const block = await head();
    const at = { blockNumber: block.number } as const;
    const rows = await Promise.all(
      Object.values(VAULTS).map(async (v) => {
        const min = await client.readContract({ address: v.address, abi: vaultAbi, functionName: "minimumMarketSupply", ...at });
        return Promise.all(
          v.venues.map(async (x, i) => {
            const [apr, supply, liquidity, disabled] = await Promise.all([
              client.readContract({ address: x.adapter, abi: adapterAbi, functionName: "supplyApr", args: [0n], ...at }).catch(() => 0n),
              client.readContract({ address: x.adapter, abi: adapterAbi, functionName: "marketSupply", ...at }).catch(() => 0n),
              client.readContract({ address: x.adapter, abi: adapterAbi, functionName: "availableLiquidity", ...at }).catch(() => 0n),
              client.readContract({ address: v.address, abi: vaultAbi, functionName: "disabled", args: [BigInt(i)], ...at }),
            ]);
            return {
              vault: v.id,
              venue: x.venue,
              market: x.market,
              adapter: x.adapter,
              aprPct: percentFrom1e18(apr),
              marketSupply: amount(supply, v.assetDecimals),
              availableLiquidity: amount(liquidity, v.assetDecimals),
              eligible: !disabled && supply >= min && apr > 0n,
              disabled,
            } satisfies Market;
          }),
        );
      }),
    );
    return rows.flat();
  }

  async function getPosition(owner: string): Promise<Position> {
    const who = ownerOf(owner);
    const block = await head();
    const at = { blockNumber: block.number } as const;
    const vaults = await Promise.all(
      Object.values(VAULTS).map(async (v) => {
        const read = <T>(functionName: string, args: unknown[]) =>
          client.readContract({ address: v.address, abi: vaultAbi, functionName: functionName as never, args: args as never, ...at }) as Promise<T>;
        const shares = await read<bigint>("balanceOf", [who]);
        const [assets, now] = shares === 0n ? [0n, 0n] : await Promise.all([read<bigint>("convertToAssets", [shares]), read<bigint>("maxWithdraw", [who])]);
        return { vault: v.id, shares: amount(shares, v.shareDecimals), assets: amount(assets, v.assetDecimals), withdrawableNow: amount(now, v.assetDecimals) };
      }),
    );
    const [usdc, mon] = await Promise.all([
      client.readContract({ address: VAULTS.setsUSDC.asset, abi: erc20Abi, functionName: "balanceOf", args: [who], ...at }),
      client.getBalance({ address: who, ...at }),
    ]);
    return { owner: who, block: block.number.toString(), vaults, wallet: { USDC: amount(usdc, 6), MON: amount(mon, 18) } };
  }

  /** Shares for a deposit at the current price, and whether the cap, pause or wallet would stop it. */
  async function quoteDeposit(id: VaultId, assets: string, owner?: string) {
    const v = vaultOf(id);
    const value = parseUnits(assets, v.assetDecimals);
    if (value <= 0n) throw new Error("Deposit a positive amount.");
    const who = owner ? ownerOf(owner) : undefined;
    const block = await head();
    const at = { blockNumber: block.number } as const;
    const [shares, room, paused] = await Promise.all([
      client.readContract({ address: v.address, abi: vaultAbi, functionName: "previewDeposit", args: [value], ...at }),
      client.readContract({ address: v.address, abi: vaultAbi, functionName: "maxDeposit", args: [who ?? "0x0000000000000000000000000000000000000001"], ...at }),
      client.readContract({ address: v.address, abi: vaultAbi, functionName: "depositsPaused", ...at }),
    ]);
    const problems: string[] = [];
    if (paused) problems.push("Deposits are paused on this vault. Withdrawals still work.");
    else if (value > room) problems.push(`The vault accepts at most ${amount(room, v.assetDecimals).formatted} ${v.assetSymbol} more before its cap.`);
    let walletBalance: Amount | undefined;
    if (who) {
      const bal = v.assetSymbol === "MON"
        ? await client.getBalance({ address: who, ...at })
        : await client.readContract({ address: v.asset, abi: erc20Abi, functionName: "balanceOf", args: [who], ...at });
      walletBalance = amount(bal, v.assetDecimals);
      if (bal < value) problems.push(`The wallet holds ${walletBalance.formatted} ${v.assetSymbol}, less than ${assets}.`);
      if (v.assetSymbol === "MON" && bal === value) problems.push("This would leave no MON for gas. Deposit a little less.");
    }
    return {
      vault: v.id,
      assets: amount(value, v.assetDecimals),
      shares: amount(shares, v.shareDecimals),
      capRemaining: amount(paused ? 0n : room, v.assetDecimals),
      walletBalance,
      ok: problems.length === 0,
      problems,
      block: block.number.toString(),
    };
  }

  async function sharesFor(v: VaultConfig, who: Address, request: WithdrawAmount, blockNumber: bigint) {
    const at = { blockNumber } as const;
    const balance = await client.readContract({ address: v.address, abi: vaultAbi, functionName: "balanceOf", args: [who], ...at });
    if ("all" in request) return { shares: balance, balance };
    if ("shares" in request) return { shares: parseUnits(request.shares, v.shareDecimals), balance };
    const assets = parseUnits(request.amount, v.assetDecimals);
    const shares = await client.readContract({ address: v.address, abi: vaultAbi, functionName: "previewWithdraw", args: [assets], ...at });
    return { shares, balance };
  }

  /** Assets a withdrawal returns at the current price, and whether the markets have the cash for it now. */
  async function quoteWithdraw(id: VaultId, owner: string, request: WithdrawAmount) {
    const v = vaultOf(id);
    const who = ownerOf(owner);
    const block = await head();
    const at = { blockNumber: block.number } as const;
    const { shares, balance } = await sharesFor(v, who, request, block.number);
    const [assets, redeemable] = await Promise.all([
      shares === 0n ? 0n : client.readContract({ address: v.address, abi: vaultAbi, functionName: "previewRedeem", args: [shares], ...at }),
      client.readContract({ address: v.address, abi: vaultAbi, functionName: "maxRedeem", args: [who], ...at }),
    ]);
    const problems: string[] = [];
    if (balance === 0n) problems.push(`This wallet holds no ${v.id}.`);
    else if (shares > balance) problems.push(`That is more than the ${amount(balance, v.shareDecimals).formatted} ${v.id} this wallet holds.`);
    else if (shares > redeemable)
      problems.push(`The markets can return ${amount(redeemable, v.shareDecimals).formatted} ${v.id} worth right now. Withdraw less, or try again later.`);
    if (shares === 0n && balance > 0n) problems.push("Choose a larger amount.");
    return {
      vault: v.id,
      shares: amount(shares, v.shareDecimals),
      assets: amount(assets, v.assetDecimals),
      sharesHeld: amount(balance, v.shareDecimals),
      redeemableNow: amount(redeemable, v.shareDecimals),
      ok: problems.length === 0,
      problems,
      block: block.number.toString(),
    };
  }

  const minus = (x: bigint, bps: number) => x - (x * BigInt(bps)) / 10_000n;

  /** Unsigned transactions for a deposit, in order. The caller's wallet signs and sends them. */
  async function prepareDeposit(
    id: VaultId,
    assets: string,
    owner: string,
    opts: { slippageBps?: number; deadlineSeconds?: number } = {},
  ): Promise<Prepared> {
    const v = vaultOf(id);
    const who = ownerOf(owner);
    const quote = await quoteDeposit(id, assets, who);
    if (!quote.ok) throw new Error(quote.problems.join(" "));
    const value = BigInt(quote.assets.raw);
    const shares = BigInt(quote.shares.raw);
    const minShares = minus(shares, opts.slippageBps ?? DEFAULT_SLIPPAGE_BPS);
    const block = await client.getBlock();
    const deadline = block.timestamp + BigInt(opts.deadlineSeconds ?? DEFAULT_DEADLINE_SECONDS);
    const transactions: Transaction[] = [];
    if (v.assetSymbol === "MON") {
      transactions.push({
        label: `Deposit ${quote.assets.formatted} MON into setsMON through the MON gateway`,
        to: v.gateway!,
        data: encodeFunctionData({ abi: monGatewayAbi, functionName: "depositMON", args: [who, minShares, deadline] }),
        value: value.toString(),
        chainId: 143,
      });
    } else {
      const allowance = await client.readContract({ address: v.asset, abi: erc20Abi, functionName: "allowance", args: [who, v.address] });
      if (allowance < value)
        transactions.push({
          label: `Allow setsUSDC to take exactly ${quote.assets.formatted} USDC`,
          to: v.asset,
          data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [v.address, value] }),
          value: "0",
          chainId: 143,
        });
      transactions.push({
        label: `Deposit ${quote.assets.formatted} USDC into setsUSDC`,
        to: v.address,
        data: encodeFunctionData({ abi: vaultAbi, functionName: "depositWithMinShares", args: [value, who, minShares, deadline] }),
        value: "0",
        chainId: 143,
      });
    }
    return {
      vault: v.id,
      action: "deposit",
      owner: who,
      transactions,
      expected: { shares: quote.shares, assets: quote.assets },
      minimum: amount(minShares, v.shareDecimals),
      expiresAt: iso(deadline)!,
      appUrl: appUrlOf(v),
      notes: [
        "Setsuna contracts are unaudited and the vaults are capped. Deposit only what you can afford to lose.",
        `The deposit reverts if it would mint fewer than ${amount(minShares, v.shareDecimals).formatted} ${v.id}.`,
      ],
    };
  }

  /** Unsigned transactions for a withdrawal back to `owner`, in order. setsMON returns native MON. */
  async function prepareWithdraw(
    id: VaultId,
    owner: string,
    request: WithdrawAmount,
    opts: { slippageBps?: number; deadlineSeconds?: number } = {},
  ): Promise<Prepared> {
    const v = vaultOf(id);
    const who = ownerOf(owner);
    const quote = await quoteWithdraw(id, who, request);
    if (!quote.ok) throw new Error(quote.problems.join(" "));
    const shares = BigInt(quote.shares.raw);
    const minAssets = minus(BigInt(quote.assets.raw), opts.slippageBps ?? DEFAULT_SLIPPAGE_BPS);
    const block = await client.getBlock();
    const deadline = block.timestamp + BigInt(opts.deadlineSeconds ?? DEFAULT_DEADLINE_SECONDS);
    const transactions: Transaction[] = [];
    if (v.assetSymbol === "MON") {
      const allowance = await client.readContract({ address: v.address, abi: vaultAbi, functionName: "allowance", args: [who, v.gateway!] });
      if (allowance < shares)
        transactions.push({
          label: `Allow the MON gateway to redeem exactly ${quote.shares.formatted} setsMON`,
          to: v.address,
          data: encodeFunctionData({ abi: vaultAbi, functionName: "approve", args: [v.gateway!, shares] }),
          value: "0",
          chainId: 143,
        });
      transactions.push({
        label: `Withdraw ${quote.assets.formatted} MON (native) from setsMON`,
        to: v.gateway!,
        data: encodeFunctionData({ abi: monGatewayAbi, functionName: "redeemMON", args: [shares, who, minAssets, deadline] }),
        value: "0",
        chainId: 143,
      });
    } else {
      transactions.push({
        label: `Withdraw ${quote.assets.formatted} USDC from setsUSDC`,
        to: v.address,
        data: encodeFunctionData({ abi: vaultAbi, functionName: "redeemWithMinAssets", args: [shares, who, who, minAssets, deadline] }),
        value: "0",
        chainId: 143,
      });
    }
    return {
      vault: v.id,
      action: "withdraw",
      owner: who,
      transactions,
      expected: { shares: quote.shares, assets: quote.assets },
      minimum: amount(minAssets, v.assetDecimals),
      expiresAt: iso(deadline)!,
      appUrl: appUrlOf(v),
      notes: [`The withdrawal reverts if it would return less than ${amount(minAssets, v.assetDecimals).formatted} ${v.assetSymbol}.`],
    };
  }

  /** The vault's fixed rules, read from the contract, with a plain sentence for each. */
  async function getRules(id: VaultId) {
    const v = vaultOf(id);
    const read = (functionName: string) => client.readContract({ address: v.address, abi: vaultAbi, functionName: functionName as never }) as Promise<bigint>;
    const [buffer, cap, move, cooldown, interval, maxAge, rateBand, fee, minSupply, guardian] = await Promise.all([
      read("BUFFER_BPS"), read("DESTINATION_CAP_BPS"), read("MOVE_BPS"), read("COOLDOWN"), read("OBSERVATION_INTERVAL"),
      read("MAX_OBSERVATION_AGE"), read("MAX_RATE_CHANGE_BPS"), read("performanceFeeBps"), read("minimumMarketSupply"),
      client.readContract({ address: v.address, abi: vaultAbi, functionName: "guardian" }),
    ]);
    const cashCap = v.id === "setsUSDC" ? await client.readContract({ address: v.address, abi: multiVaultAbi, functionName: "MARKET_CASH_CAP_BPS" }) : undefined;
    const rules = [
      `About ${bpsToPercent(buffer)}% of the vault stays as cash for withdrawals.`,
      `No single market holds more than ${bpsToPercent(cap)}% of the vault.`,
      ...(cashCap !== undefined ? [`The vault never supplies more than ${bpsToPercent(cashCap)}% of a market's available cash.`] : []),
      `A market with less than ${amount(minSupply, v.assetDecimals).formatted} ${v.assetSymbol} supplied gets no new money.`,
      `Money is split between eligible markets in proportion to their rates. A market whose rate moved more than ${bpsToPercent(rateBand)}% between readings is left out, and each market is scored at its lowest reading.`,
      `One rebalance moves at most ${bpsToPercent(move)}% of the vault, then waits at least ${Number(cooldown) / 60} minutes.`,
      `Rates are recorded at most every ${Number(interval) / 60} minutes and must be under ${Number(maxAge) / 60} minutes old to rebalance. Anyone can record them or rebalance; nobody can choose the weights.`,
      `A ${bpsToPercent(fee)}% fee applies to yield only, never to deposits.`,
      `The guardian (${guardian}) can only pause new deposits or disable a market. It cannot move funds, change fees or upgrade the contract, and there is no admin.`,
    ];
    return {
      vault: v.id,
      address: v.address,
      parameters: {
        cashBufferPct: bpsToPercent(buffer),
        marketCapPct: bpsToPercent(cap),
        marketCashCapPct: cashCap !== undefined ? bpsToPercent(cashCap) : null,
        moveLimitPct: bpsToPercent(move),
        cooldownMinutes: Number(cooldown) / 60,
        observationIntervalMinutes: Number(interval) / 60,
        maxObservationAgeMinutes: Number(maxAge) / 60,
        rateChangeBandPct: bpsToPercent(rateBand),
        performanceFeePct: bpsToPercent(fee),
        minimumMarketSupply: amount(minSupply, v.assetDecimals),
        guardian,
      },
      rules,
      source: `https://repo.sourcify.dev/143/${v.address}`,
    };
  }

  return { getVault, getVaults, getMarkets, getPosition, quoteDeposit, quoteWithdraw, prepareDeposit, prepareWithdraw, getRules };
}

export type Setsuna = ReturnType<typeof createSetsuna>;
