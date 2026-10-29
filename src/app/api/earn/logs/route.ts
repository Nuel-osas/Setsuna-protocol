import { NextResponse } from "next/server";
import { createPublicClient, isAddress, parseAbi, toEventSelector, type Address } from "viem";
import { mainnetDeployment } from "@/lib/setsuna/mainnet-deployment";
import { chainFor, rpcTransport } from "@/lib/setsuna/rpc-client";
import snapshot from "@/lib/setsuna/data/earn-logs.json";

/**
 * GET /api/earn/logs/?asset=USDC|MON&owner=0x… — one wallet's Deposit, Withdraw and Transfer
 * logs on a vault, from its deployment block. A vault older than the browser's scan limit (about
 * two weeks of Monad) would otherwise show no deposit/withdrawal totals at all. History up to a
 * committed snapshot (scripts/earn-log-snapshot.mjs) ships with the app; each server instance
 * scans only the blocks since, then keeps extending.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SPAN = BigInt(10_000); // Monad RPCs reject much wider getLogs ranges.
const TOPICS = parseAbi([
  "event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)",
  "event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]).map((e) => toEventSelector(e));
const CONCURRENCY = 8;

type WireLog = {
  address: Address;
  blockNumber: string;
  blockHash: string;
  logIndex: number;
  transactionHash: string;
  transactionIndex: number;
  topics: string[];
  data: string;
};
type Index = { to: bigint; logs: WireLog[]; pending?: Promise<void> };
const indexes = new Map<string, Index>();

async function extend(index: Index, vault: Address) {
  const d = mainnetDeployment();
  const client = createPublicClient({ chain: chainFor(d), transport: rpcTransport(d) });
  const head = await client.getBlockNumber();
  const ranges: [bigint, bigint][] = [];
  for (let from = index.to + BigInt(1); from <= head; from += SPAN)
    ranges.push([from, from + SPAN - BigInt(1) > head ? head : from + SPAN - BigInt(1)]);
  const found: WireLog[][] = new Array(ranges.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, ranges.length) }, async () => {
      for (let i = next++; i < ranges.length; i = next++) {
        const [fromBlock, toBlock] = ranges[i];
        const logs = (await client.request({
          method: "eth_getLogs",
          params: [
            {
              address: vault,
              topics: [TOPICS],
              fromBlock: `0x${fromBlock.toString(16)}`,
              toBlock: `0x${toBlock.toString(16)}`,
            },
          ],
        })) as {
          address: Address;
          blockNumber: string;
          blockHash: string;
          logIndex: string;
          transactionHash: string;
          transactionIndex: string;
          topics: string[];
          data: string;
        }[];
        found[i] = logs.map((l) => ({
          address: l.address,
          blockNumber: String(BigInt(l.blockNumber)),
          blockHash: l.blockHash,
          logIndex: Number(l.logIndex),
          transactionHash: l.transactionHash,
          transactionIndex: Number(l.transactionIndex),
          topics: l.topics,
          data: l.data,
        }));
      }
    }),
  );
  index.logs.push(...found.flat());
  index.to = head;
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const asset = q.get("asset");
  const owner = q.get("owner") ?? "";
  if (asset !== "USDC" && asset !== "MON")
    return NextResponse.json({ error: "asset must be USDC or MON" }, { status: 400 });
  if (!isAddress(owner))
    return NextResponse.json({ error: "owner must be an address" }, { status: 400 });
  const d = mainnetDeployment();
  const m = asset === "MON" ? d.earnMON : d.earnUSDC;
  if (!m) return NextResponse.json({ error: "Vault unavailable" }, { status: 404 });
  let index = indexes.get(m.vault);
  if (!index) {
    const saved = (snapshot as Record<string, { vault: string; to: string; logs: WireLog[] }>)[asset];
    index =
      saved && saved.vault.toLowerCase() === m.vault.toLowerCase()
        ? { to: BigInt(saved.to), logs: [...saved.logs] }
        : { to: BigInt(m.startBlock) - BigInt(1), logs: [] };
    indexes.set(m.vault, index);
  }
  try {
    // One extension at a time per vault; concurrent requests share it.
    index.pending ??= extend(index, m.vault).finally(() => (index!.pending = undefined));
    await index.pending;
  } catch {
    // A failed range leaves the index where it was; nothing partial is served as complete.
    return NextResponse.json({ error: "chain_read_failed" }, { status: 502 });
  }
  // The wallet as an indexed topic: Deposit owner, Withdraw owner/receiver, Transfer from/to.
  const word = `0x${owner.slice(2).toLowerCase().padStart(64, "0")}`;
  const mine = index.logs.filter((l) => l.topics.slice(1).some((t) => t.toLowerCase() === word));
  return NextResponse.json(
    { vault: m.vault, from: m.startBlock, to: String(index.to), logs: mine },
    { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=300" } },
  );
}
