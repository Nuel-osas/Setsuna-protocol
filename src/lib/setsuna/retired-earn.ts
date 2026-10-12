import { erc4626Abi, getAddress, type Address } from "viem";
import { clientFor } from "./rpc-client";
import type { Deployment } from "./types";

/**
 * The first mainnet vault pair, retired when withdrawals moved to
 * lowest-yield-first. Deposits there are permanently paused; withdrawals
 * still work, and the Earn form takes any remaining position out first.
 */
const retired = {
  USDC: { vault: getAddress("0xAA5366660c3dDb3400f7083F21196Db125d6a2E7") },
  MON: {
    vault: getAddress("0x3F271AaD41D6064Be2A9245fE00Fa72606c5Fda1"),
    gateway: getAddress("0x32BcA3c83968682173c8c5A05Ab8Fb927EE5D8d2"),
  },
} as const;

export type EarlierPosition = {
  vault: Address;
  gateway?: Address;
  shares: bigint;
  assets: bigint;
};

/** The account's redeemable position in the retired vault, if any. */
export async function readEarlier(
  d: Deployment,
  asset: "USDC" | "MON",
  account?: Address,
): Promise<EarlierPosition | undefined> {
  const current = asset === "MON" ? d.earnMON?.vault : d.earnUSDC?.vault;
  const old = retired[asset];
  if (d.chainId !== 143 || !account || !current || current === old.vault)
    return undefined;
  const c = clientFor(d);
  const shares = await c.readContract({
    address: old.vault,
    abi: erc4626Abi,
    functionName: "maxRedeem",
    args: [account],
  });
  if (shares === BigInt(0)) return undefined;
  const assets = await c.readContract({
    address: old.vault,
    abi: erc4626Abi,
    functionName: "previewRedeem",
    args: [shares],
  });
  if (assets === BigInt(0)) return undefined;
  return { ...old, shares, assets };
}
