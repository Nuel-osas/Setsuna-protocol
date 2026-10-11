import { erc4626Abi, erc20Abi, parseAbi, type Address } from "viem";
import { clientFor } from "./rpc-client.ts";
import { createReadCache } from "./read-cache.ts";
import { earnSummaryKey } from "./earn-summary.ts";
import type { Deployment } from "./types";
import type { EarnFlow } from "./earn-accounting";
const accountingAbi = parseAbi([
  "function accounting() view returns(uint256 nav, bool healthy)",
]);
export type EarnPoint = {
  block: bigint;
  timestamp: number;
  price: bigint;
  assets: bigint;
};

const accountingEvent = parseAbi([
  "event AccountingUpdated(uint256 assets, uint256 idle)",
]);
const ZERO = "0x0000000000000000000000000000000000000000";
const SAMPLES = 13;

/** OpenZeppelin ERC-4626 convertToAssets(unit) with the vault's 6-decimal share offset. */
export function sharePrice(nav: bigint, supply: bigint, unit: bigint) {
  return (unit * (nav + BigInt(1))) / (supply + BigInt(1_000_000));
}

type Log = { block: bigint; index: number };
type Replayed = { block: bigint; price: bigint; assets: bigint };
/**
 * Replays mint/burn transfers and AccountingUpdated in log order. The vault
 * emits AccountingUpdated before minting on deposit and after burning on
 * withdraw, so each emitted NAV is paired with the supply in force at that point.
 */
export function replayAccounting(
  mints: (Log & { from: string; to: string; value: bigint })[],
  updates: (Log & { assets: bigint })[],
  unit: bigint,
) {
  const events = [
    ...mints.map((e) => ({ ...e, kind: "supply" as const })),
    ...updates.map((e) => ({ ...e, kind: "nav" as const })),
  ].sort((a, b) =>
    a.block === b.block ? a.index - b.index : a.block < b.block ? -1 : 1,
  );
  let supply = BigInt(0);
  const points: Replayed[] = [];
  for (const e of events) {
    if (e.kind === "supply") {
      if (e.from === ZERO) supply += e.value;
      if (e.to === ZERO) supply -= e.value;
      // An emptied vault reprices its next shares against leftover dust, so
      // prices on either side are not comparable. Chart the current period only.
      if (supply === BigInt(0)) points.length = 0;
    } else if (supply > BigInt(0)) {
      const point = {
        block: e.block,
        price: sharePrice(e.assets, supply, unit),
        assets: e.assets,
      };
      // Keep the last accounting state of each block.
      if (points.at(-1)?.block === e.block) points[points.length - 1] = point;
      else points.push(point);
    }
  }
  return points;
}

/** Evenly spaced picks that always keep the first and last point. */
export function downsample<T>(items: T[], count: number) {
  if (items.length <= count) return items;
  return [
    ...new Set(
      Array.from(
        { length: count },
        (_, i) => (i * (items.length - 1)) / (count - 1),
      ).map(Math.round),
    ),
  ].map((i) => items[i]);
}

// Sample actual archived state. A failed/empty-vault sample is a gap, never a fabricated value.
async function loadEarnPerformance(d: Deployment, asset: "MON" | "USDC") {
  const m = asset === "MON" ? d.earnMON : d.earnUSDC;
  if (!m) throw new Error("Vault unavailable");
  const client = clientFor(d);
  if ((await client.getChainId()) !== d.chainId)
    throw new Error("Wrong network");
  const head = await client.getBlock();
  const start = BigInt(m.startBlock);
  if (start > head.number) throw new Error("History unavailable");
  const blocks = [
    ...new Set(
      Array.from(
        { length: 13 },
        (_, i) => start + ((head.number - start) * BigInt(i)) / BigInt(12),
      ),
    ),
  ];
  let missing = 0;
  const points: EarnPoint[] = [];
  // Limit simultaneous RPC reads so the transaction card remains responsive.
  for (let i = 0; i < blocks.length; i += 3) {
    const samples = await Promise.all(
      blocks.slice(i, i + 3).map(async (blockNumber) => {
        try {
          const [block, accounting, supply, price] = await Promise.all([
            client.getBlock({ blockNumber }),
            client.readContract({
              address: m.vault,
              abi: accountingAbi,
              functionName: "accounting",
              blockNumber,
            }),
            client.readContract({
              address: m.vault,
              abi: erc20Abi,
              functionName: "totalSupply",
              blockNumber,
            }),
            client.readContract({
              address: m.vault,
              abi: erc4626Abi,
              functionName: "convertToAssets",
              args: [BigInt(10) ** BigInt(asset === "MON" ? 24 : 12)],
              blockNumber,
            }),
          ]);
          if (!accounting[1]) throw new Error("Unhealthy valuation");
          if (supply === BigInt(0)) return undefined;
          return {
            block: blockNumber,
            timestamp: Number(block.timestamp),
            price,
            assets: accounting[0],
          };
        } catch {
          missing++;
          return undefined;
        }
      }),
    );
    for (const point of samples) if (point) points.push(point);
  }
  return { points, missing, block: head.number };
}

const performanceCache =
  createReadCache<Awaited<ReturnType<typeof loadEarnPerformance>>>(60_000);
export function readEarnPerformance(d: Deployment, asset: "MON" | "USDC") {
  return performanceCache.read(earnSummaryKey(d, asset), () =>
    loadEarnPerformance(d, asset),
  );
}

type CachedFlows = { block: bigint; hash: string; flows: EarnFlow[] };
const flowCache = new Map<string, CachedFlows>();
export async function readOwnerFlows(
  d: Deployment,
  asset: "MON" | "USDC",
  owner: Address,
  end: bigint,
) {
  const m = asset === "MON" ? d.earnMON : d.earnUSDC;
  if (!m) throw new Error("Vault unavailable");
  const client = clientFor(d);
  if ((await client.getChainId()) !== d.chainId)
    throw new Error("Wrong network");
  const key = `${d.rpc}:${d.chainId}:${m.vault}:${m.startBlock}:${owner.toLowerCase()}`;
  let cached = flowCache.get(key);
  if (
    cached &&
    (end < cached.block ||
      (await client.getBlock({ blockNumber: cached.block })).hash !==
        cached.hash)
  )
    cached = undefined;
  const start = BigInt(m.startBlock);
  if (end < start) throw new Error("History unavailable");
  // startBlock is the deployment block from the configured manifest. Logs remain
  // available even when the RPC has pruned pre-deployment contract state.
  let fromBlock = cached ? cached.block + BigInt(1) : start;
  // Large deployments should use an indexer. Never silently calculate from truncated logs.
  if (end - fromBlock > BigInt(100_000))
    throw new Error("Full history requires indexing");
  const flows = [...(cached?.flows ?? [])];
  const head = await client.getBlock({ blockNumber: end });
  while (fromBlock <= end) {
    const toBlock =
      fromBlock + BigInt(1999) < end ? fromBlock + BigInt(1999) : end;
    const at = { address: m.vault, fromBlock, toBlock };
    const [deposits, withdrawals, sent, received] = await Promise.all([
      client.getContractEvents({
        ...at,
        abi: erc4626Abi,
        eventName: "Deposit",
        args: { receiver: owner },
        strict: true,
      }),
      client.getContractEvents({
        ...at,
        abi: erc4626Abi,
        eventName: "Withdraw",
        args: { owner },
        strict: true,
      }),
      client.getContractEvents({
        ...at,
        abi: erc20Abi,
        eventName: "Transfer",
        args: { from: owner },
        strict: true,
      }),
      client.getContractEvents({
        ...at,
        abi: erc20Abi,
        eventName: "Transfer",
        args: { to: owner },
        strict: true,
      }),
    ]);
    flows.push(
      ...deposits.map((e) => ({
        kind: "deposit" as const,
        assets: e.args.assets,
        shares: e.args.shares,
      })),
      ...withdrawals.map((e) => ({
        kind: "withdraw" as const,
        assets: e.args.assets,
        shares: e.args.shares,
      })),
      ...[...sent, ...received].map((e) => ({
        kind: "transfer" as const,
        shares: e.args.value,
        from: e.args.from,
        to: e.args.to,
      })),
    );
    fromBlock = toBlock + BigInt(1);
  }
  if ((await client.getBlock({ blockNumber: end })).hash !== head.hash)
    throw new Error("Chain changed during history read");
  if (flowCache.size >= 20 && !flowCache.has(key))
    flowCache.delete(flowCache.keys().next().value!);
  flowCache.set(key, { block: end, hash: head.hash!, flows });
  return flows;
}
