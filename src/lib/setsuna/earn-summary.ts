import { erc20Abi, parseAbi } from "viem";
import type { Deployment } from "./types";
import { clientFor } from "./rpc-client.ts";
import { createReadCache } from "./read-cache.ts";

export type SummaryAsset = "MON" | "USDC";
const vaultABI = parseAbi([
  "function accounting() view returns(uint256 nav,bool healthy)",
  "function convertToAssets(uint256) view returns(uint256)",
]);
const adapterABI = parseAbi([
  "function totalAssets() view returns(uint256)",
  "function supplyApr(int256) view returns(uint256)",
]);
export type EarnSummary = {
  block: bigint;
  nav: bigint;
  healthy: boolean;
  idle: bigint;
  shareValue: bigint;
  positions: bigint[];
  rates: bigint[];
  blendedApr: bigint;
};
export function earnSummaryKey(d: Deployment, asset: SummaryAsset) {
  const m = asset === "MON" ? d.earnMON : d.earnUSDC;
  return JSON.stringify([
    d.rpc,
    d.chainId,
    asset,
    m?.vault,
    m?.asset,
    m?.adapters,
    m?.startBlock,
  ]);
}
const summaries = createReadCache<EarnSummary>(10_000);
export const cachedEarnSummary = (d: Deployment, asset: SummaryAsset) =>
  summaries.peek(earnSummaryKey(d, asset));
export const invalidateEarnSummary = (d: Deployment, asset: SummaryAsset) =>
  summaries.invalidate(earnSummaryKey(d, asset));

/** Public display data only. No cached wallet balances, withdrawal limits or transaction quotes. */
export function readEarnSummary(d: Deployment, asset: SummaryAsset) {
  return summaries.read(earnSummaryKey(d, asset), async () => {
    const m = asset === "MON" ? d.earnMON : d.earnUSDC;
    if (!m) throw new Error("Vault unavailable");
    const client = clientFor(d);
    const [chainId, block] = await Promise.all([
      client.getChainId(),
      client.getBlock(),
    ]);
    if (chainId !== d.chainId) throw new Error("Wrong network");
    const at = { blockNumber: block.number };
    const [accounting, shareValue, idle, positions, rates] = await Promise.all([
      client.readContract({
        address: m.vault,
        abi: vaultABI,
        functionName: "accounting",
        ...at,
      }),
      client.readContract({
        address: m.vault,
        abi: vaultABI,
        functionName: "convertToAssets",
        args: [BigInt(10) ** BigInt(asset === "MON" ? 24 : 12)],
        ...at,
      }),
      client.readContract({
        address: m.asset,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [m.vault],
        ...at,
      }),
      Promise.all(
        m.adapters.map((address) =>
          client.readContract({
            address,
            abi: adapterABI,
            functionName: "totalAssets",
            ...at,
          }),
        ),
      ),
      Promise.all(
        m.adapters.map((address) =>
          client.readContract({
            address,
            abi: adapterABI,
            functionName: "supplyApr",
            args: [BigInt(0)],
            ...at,
          }),
        ),
      ),
    ]);
    const annualIncome = positions.reduce(
      (sum, p, i) => sum + (p * rates[i]) / BigInt(10) ** BigInt(18),
      BigInt(0),
    );
    return {
      block: block.number,
      nav: accounting[0],
      healthy: accounting[1],
      idle,
      shareValue,
      positions,
      rates,
      blendedApr:
        accounting[0] > BigInt(0)
          ? (annualIncome * BigInt(10) ** BigInt(18)) / accounting[0]
          : BigInt(0),
    };
  });
}
