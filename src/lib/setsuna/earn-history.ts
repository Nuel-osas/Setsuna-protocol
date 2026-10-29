import {
  erc4626Abi,
  erc20Abi,
  parseAbi,
  parseEventLogs,
  type Address,
  type Log,
} from "viem";
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

const ZERO = "0x0000000000000000000000000000000000000000";
const SAMPLES = 13;
// Monad RPCs reject getLogs ranges much past 15k blocks.
const LOG_SPAN = BigInt(10_000);
const min = (a: bigint, b: bigint) => (a < b ? a : b);

/** `count` evenly spaced blocks from start to end inclusive, without repeats. */
export function sampleBlocks(start: bigint, end: bigint, count: number) {
  const span = end - start;
  const blocks = Array.from(
    { length: count },
    (_, i) => start + (span * BigInt(i)) / BigInt(count - 1),
  );
  return blocks.filter((b, i) => i === 0 || b !== blocks[i - 1]);
}

export type Sample = { healthy: boolean; supply: bigint; point: EarnPoint };
/**
 * Chart points from per-block vault reads. Unreadable or unhealthy samples
 * count as missing. An emptied vault reprices its next shares against leftover
 * dust, so prices on either side are not comparable: chart the current period only.
 */
export function chartSamples(samples: (Sample | undefined)[]) {
  let points: EarnPoint[] = [];
  let missing = 0;
  for (const s of samples) {
    if (!s || !s.healthy) missing++;
    else if (s.supply === BigInt(0)) points = [];
    else points.push(s.point);
  }
  return { points, missing };
}

// Share value is read straight from the vault at evenly spaced blocks, so the
// cost is fixed however old the vault is. Monad RPCs serve state back to the
// deployment; a sample they cannot answer is skipped and counted as missing.
async function loadEarnPerformance(d: Deployment, asset: "MON" | "USDC") {
  const m = asset === "MON" ? d.earnMON : d.earnUSDC;
  if (!m) throw new Error("Vault unavailable");
  const client = clientFor(d);
  if ((await client.getChainId()) !== d.chainId)
    throw new Error("Wrong network");
  const head = await client.getBlock();
  const deployed = BigInt(m.startBlock);
  if (deployed > head.number) throw new Error("History unavailable");
  const unit = BigInt(10) ** BigInt(asset === "MON" ? 24 : 12);
  // Chart from the first mint: before it the vault has no shares to price.
  const firstMint = await client.getContractEvents({
    address: m.vault,
    abi: erc20Abi,
    eventName: "Transfer",
    args: { from: ZERO },
    fromBlock: deployed,
    toBlock: min(deployed + LOG_SPAN - BigInt(1), head.number),
    strict: true,
  });
  const start = firstMint[0]?.blockNumber ?? deployed;
  const samples = await Promise.all(
    sampleBlocks(start, head.number, SAMPLES).map(
      async (blockNumber): Promise<Sample | undefined> => {
        try {
          const at = { address: m.vault, blockNumber } as const;
          const [[nav, healthy], supply, price, block] = await Promise.all([
            client.readContract({
              ...at,
              abi: accountingAbi,
              functionName: "accounting",
            }),
            client.readContract({
              ...at,
              abi: erc20Abi,
              functionName: "totalSupply",
            }),
            client.readContract({
              ...at,
              abi: erc4626Abi,
              functionName: "convertToAssets",
              args: [unit],
            }),
            blockNumber === head.number
              ? head
              : client.getBlock({ blockNumber }),
          ]);
          return {
            healthy,
            supply,
            point: {
              block: blockNumber,
              timestamp: Number(block.timestamp),
              price,
              assets: nav,
            },
          };
        } catch {
          return undefined;
        }
      },
    ),
  );
  return { ...chartSamples(samples), block: head.number };
}

const performanceCache =
  createReadCache<Awaited<ReturnType<typeof loadEarnPerformance>>>(60_000);
export function readEarnPerformance(d: Deployment, asset: "MON" | "USDC") {
  return performanceCache.read(earnSummaryKey(d, asset), () =>
    loadEarnPerformance(d, asset),
  );
}

// About two weeks of Monad blocks, enough to cover judging from deployment.
const MAX_FLOW_SCAN = BigInt(3_000_000);
const FLOW_CONCURRENCY = 6;

const vaultEvents = (logs: Log[]) =>
  parseEventLogs({
    abi: erc4626Abi,
    logs,
    eventName: ["Deposit", "Withdraw", "Transfer"],
    strict: true,
  });

/** The owner's deposits, withdrawals and share transfers among a range's vault logs. */
function ownerFlows(
  logs: ReturnType<typeof vaultEvents>,
  owner: Address,
): EarnFlow[] {
  const me = owner.toLowerCase();
  const flows: EarnFlow[] = [];
  for (const e of logs) {
    if (e.eventName === "Deposit" && e.args.receiver.toLowerCase() === me)
      flows.push({
        kind: "deposit",
        assets: e.args.assets,
        shares: e.args.shares,
      });
    else if (e.eventName === "Withdraw" && e.args.owner.toLowerCase() === me)
      flows.push({
        kind: "withdraw",
        assets: e.args.assets,
        shares: e.args.shares,
      });
    else if (
      e.eventName === "Transfer" &&
      (e.args.from.toLowerCase() === me || e.args.to.toLowerCase() === me)
    )
      flows.push({
        kind: "transfer",
        shares: e.args.value,
        from: e.args.from,
        to: e.args.to,
      });
  }
  return flows;
}

/** Every log the vault has emitted, from /api/earn/logs; undefined if the index is unreachable. */
async function serverLogs(asset: "MON" | "USDC", owner: Address) {
  try {
    const response = await fetch(`/api/earn/logs/?asset=${asset}&owner=${owner}`);
    if (!response.ok) return undefined;
    const body = (await response.json()) as {
      vault: Address;
      to: string;
      logs: (Omit<Log, "blockNumber"> & { blockNumber: string })[];
    };
    return {
      vault: body.vault,
      to: BigInt(body.to),
      logs: body.logs.map((l) => ({ ...l, blockNumber: BigInt(l.blockNumber) }) as Log),
    };
  } catch {
    return undefined;
  }
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
  let indexed: EarnFlow[] = [];
  // A vault older than the browser scan limit reads its earlier logs from Setsuna's server
  // index (mainnet only), then scans just the remaining tail here.
  if (!cached && end - fromBlock > MAX_FLOW_SCAN && d.mode === "mainnet") {
    const index = await serverLogs(asset, owner);
    if (index && index.vault.toLowerCase() === m.vault.toLowerCase()) {
      const upTo = index.to < end ? index.to : end;
      indexed = ownerFlows(
        vaultEvents(index.logs.filter((l) => (l.blockNumber ?? BigInt(0)) <= upTo)),
        owner,
      );
      fromBlock = upTo + BigInt(1);
    }
  }
  // Beyond this an indexer is the right tool. Never calculate from truncated logs.
  if (end - fromBlock > MAX_FLOW_SCAN)
    throw new Error("Full history requires indexing");
  const head = await client.getBlock({ blockNumber: end });
  const ranges: [bigint, bigint][] = [];
  for (let from = fromBlock; from <= end; from += LOG_SPAN)
    ranges.push([from, min(from + LOG_SPAN - BigInt(1), end)]);
  // One unfiltered query per range covers deposits, withdrawals and transfers.
  const found: EarnFlow[][] = new Array(ranges.length);
  let next = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(FLOW_CONCURRENCY, ranges.length) },
      async () => {
        for (let i = next++; i < ranges.length; i = next++) {
          const [from, to] = ranges[i];
          const logs = await client.getLogs({
            address: m.vault,
            fromBlock: from,
            toBlock: to,
          });
          found[i] = ownerFlows(vaultEvents(logs), owner);
        }
      },
    ),
  );
  const flows = [...(cached?.flows ?? []), ...indexed, ...found.flat()];
  if ((await client.getBlock({ blockNumber: end })).hash !== head.hash)
    throw new Error("Chain changed during history read");
  if (flowCache.size >= 20 && !flowCache.has(key))
    flowCache.delete(flowCache.keys().next().value!);
  flowCache.set(key, { block: end, hash: head.hash!, flows });
  return flows;
}
