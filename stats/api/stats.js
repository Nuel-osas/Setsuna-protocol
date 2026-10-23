// GET /api/stats: the real-usage report, read live from Monad mainnet.
// Starts from a checked-in checkpoint of past logs, keeps scanning forward in memory while the
// instance is warm, and answers from a 60-second memo so a refresh storm reads the chain once.
import { readFile } from "node:fs/promises";
import { createPublicClient, http } from "viem";
import { computeUsage } from "../lib/score.js";

export const config = { maxDuration: 60 };

const data = (name) => readFile(new URL(`../data/${name}`, import.meta.url), "utf8").then(JSON.parse);
const client = createPublicClient({ transport: http(process.env.MONAD_RPC_URL ?? "https://rpc2.monad.xyz", { retryCount: 3, timeout: 20_000 }) });
let cache;
let memo = { at: 0, report: null, pending: null };

async function build() {
  cache ??= await data("checkpoint.json");
  // team.json is kept out of git (the repo is public); without it no wallet counts as team.
  const [team, incentivized] = await Promise.all([data("team.json").catch(() => ({ wallets: [] })), data("incentivized.json")]);
  return computeUsage({ client, cache, team: team.wallets.map((w) => w.address), incentivized });
}

export async function GET() {
  try {
    if (!memo.report || Date.now() - memo.at > 60_000) {
      memo.pending ??= build().finally(() => (memo.pending = null));
      memo.report = await memo.pending;
      memo.at = Date.now();
    }
    return Response.json(memo.report, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    // RPC messages can carry endpoint details, so only the error's kind is returned.
    return Response.json({ error: "chain_read_failed", kind: error?.name ?? "Error" }, { status: 502 });
  }
}
