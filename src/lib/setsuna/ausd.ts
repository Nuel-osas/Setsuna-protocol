import { erc20Abi, parseAbi, type Address, type PublicClient } from "viem";

/**
 * setsAUSD: AUSD saved in setsUSDC. Deposits swap AUSD to USDC on one Curve stable pool and supply
 * setsUSDC; withdrawals swap back. One setsAUSD share is one setsUSDC share, so the rate, fee and
 * 2,000 USDC cap are setsUSDC's. A swap returning under 99.8% of one-for-one reverts.
 */
export const AUSD_SAVINGS = {
  wrapper: "0x551903E3687820A733FBe406DD33Fee8D12bd2F3" as Address,
  ausd: "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a" as Address,
  pool: "0x942644106B073E30D72c2C5D7529D5C296ea91ab" as Address,
  assetDecimals: 6,
  shareDecimals: 12,
  pegFloorBps: BigInt(9980),
} as const;

export const ausdWrapperAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function maxDeposit(address) view returns (uint256)",
  "function maxRedeem(address owner) view returns (uint256)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
  "function previewDeposit(uint256 assets) view returns (uint256)",
  "function previewRedeem(uint256 shares) view returns (uint256)",
  "function depositWithMinShares(uint256 assets, address receiver, uint256 minShares) returns (uint256)",
  "function redeemWithMinAssets(uint256 shares, address receiver, address owner, uint256 minAssets) returns (uint256)",
  "function unwrap(uint256 shares, address receiver, address owner)",
]);

const poolAbi = parseAbi(["function get_dy(int128 i, int128 j, uint256 dx) view returns (uint256)"]);

export type AUSDSnapshot = {
  block: bigint;
  walletBalance?: bigint;
  shares: bigint;
  /** What the shares are worth, counting setsUSDC's USDC one-for-one as AUSD. */
  value: bigint;
  maxDeposit: bigint;
  maxRedeem: bigint;
  /** Round trip through the pool for 1,000 AUSD, in basis points. */
  roundTripBps: number;
  pegOk: boolean;
};

export async function readAUSD(client: PublicClient, owner?: Address): Promise<AUSDSnapshot> {
  const block = await client.getBlockNumber();
  const at = { blockNumber: block } as const;
  const { wrapper, ausd, pool, pegFloorBps } = AUSD_SAVINGS;
  const probe = BigInt(1_000_000_000); // 1,000 AUSD
  const [maxDeposit, toUsdc, shares, maxRedeem, walletBalance] = await Promise.all([
    client.readContract({ address: wrapper, abi: ausdWrapperAbi, functionName: "maxDeposit", args: [wrapper], ...at }),
    client.readContract({ address: pool, abi: poolAbi, functionName: "get_dy", args: [BigInt(0), BigInt(1), probe], ...at }),
    owner ? client.readContract({ address: wrapper, abi: ausdWrapperAbi, functionName: "balanceOf", args: [owner], ...at }) : Promise.resolve(BigInt(0)),
    owner ? client.readContract({ address: wrapper, abi: ausdWrapperAbi, functionName: "maxRedeem", args: [owner], ...at }) : Promise.resolve(BigInt(0)),
    owner ? client.readContract({ address: ausd, abi: erc20Abi, functionName: "balanceOf", args: [owner], ...at }) : Promise.resolve(undefined),
  ]);
  const [back, value] = await Promise.all([
    client.readContract({ address: pool, abi: poolAbi, functionName: "get_dy", args: [BigInt(1), BigInt(0), toUsdc], ...at }),
    shares > BigInt(0)
      ? client.readContract({ address: wrapper, abi: ausdWrapperAbi, functionName: "convertToAssets", args: [shares], ...at })
      : Promise.resolve(BigInt(0)),
  ]);
  return {
    block,
    walletBalance,
    shares,
    value,
    maxDeposit,
    maxRedeem,
    roundTripBps: Number(((probe - back) * BigInt(10_000) * BigInt(100)) / probe) / 100,
    pegOk: toUsdc * BigInt(10_000) >= probe * pegFloorBps && back * BigInt(10_000) >= toUsdc * pegFloorBps,
  };
}
