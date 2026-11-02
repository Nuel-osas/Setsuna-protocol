// GET /api/stats: the real-usage report, read live from Monad mainnet.
// With the stats database: the chain-scan cache and the last report live in Postgres, so a refresh
// answers at once from the saved report and a cold start reads only blocks it hasn't seen. A report
// older than a minute is returned marked stale and rebuilt in the background. Without the database it
// starts from the checked-in checkpoint, as before.
import { readFile } from "node:fs/promises";
import { waitUntil } from "@vercel/functions";
import { createPublicClient, http, isAddress } from "viem";
import { computeUsage, monPriceUSD } from "../lib/score.js";
import { accountsReport, fetchPrivyUsers } from "../lib/accounts.js";
import { db, kvGet, kvSet, ready } from "../lib/db.js";
import { summarize } from "../lib/bridge.js";

export const config = { maxDuration: 60 };

const FRESH_MS = 60_000;
const data = (name) => readFile(new URL(`../data/${name}`, import.meta.url), "utf8").then(JSON.parse);
const client = createPublicClient({ transport: http(process.env.MONAD_RPC_URL ?? "https://rpc2.monad.xyz", { retryCount: 3, timeout: 20_000 }) });
let cache;
let memo = { at: 0, report: null, pending: null };

async function loadCache(sql) {
  if (cache) return cache;
  const saved = sql ? await kvGet(sql, "scan-cache").catch(() => null) : null;
  cache = saved?.value ?? (await data("checkpoint.json"));
  return cache;
}

async function build() {
  const sql = db();
  if (sql) await ready(sql);
  await loadCache(sql);
  // team.json is kept out of git (the repo is public); without it no wallet counts as team.
  const [team, incentivized] = await Promise.all([data("team.json").catch(() => ({ wallets: [] })), data("incentivized.json")]);
  const teamAll = team.wallets.map((w) => w.address);
  const teamEvm = teamAll.filter((a) => isAddress(a)); // the list also holds Sui wallets, for the bridge
  const report = await computeUsage({ client, cache, team: teamEvm, incentivized, monPrice: await monPriceUSD() });
  report.accounts = await accounts(report.wallets, teamEvm);
  report.bridge = sql ? summarize(await sql`select * from bridge_transfers`, teamAll, incentivized) : null;
  if (sql) await Promise.all([kvSet(sql, "scan-cache", cache), kvSet(sql, "report", report)]);
  return report;
}

function refresh() {
  memo.pending ??= build()
    .then((report) => {
      memo.report = report;
      memo.at = Date.now();
      return report;
    })
    .finally(() => (memo.pending = null));
  return memo.pending;
}

const reply = (report, stale) =>
  Response.json(stale ? { ...report, stale: true } : report, { headers: { "Cache-Control": "private, no-store" } });

// Sign-ups from Privy, matched to on-chain wallets. Optional: without the secret the page says so.
async function accounts(walletRows, team) {
  const appId = process.env.PRIVY_APP_ID;
  const secret = process.env.PRIVY_APP_SECRET;
  if (!appId || !secret) return { available: false, reason: "not_configured" };
  try {
    return accountsReport({ users: await fetchPrivyUsers({ appId, secret }), walletRows, team });
  } catch (error) {
    return { available: false, reason: "privy_error", status: error?.status ?? null };
  }
}

export async function GET() {
  try {
    if (memo.report && Date.now() - memo.at < FRESH_MS) return reply(memo.report, false);
    if (!memo.report) {
      const sql = db();
      const saved = sql ? await kvGet(sql, "report").catch(() => null) : null;
      if (saved) memo = { ...memo, at: saved.at, report: saved.value };
      if (saved && Date.now() - saved.at < FRESH_MS) return reply(saved.value, false);
    }
    if (memo.report) {
      // Answer now with the last report; the rebuild finishes after the response.
      waitUntil(refresh().catch(() => undefined));
      return reply(memo.report, true);
    }
    return reply(await refresh(), false);
  } catch (error) {
    // RPC messages can carry endpoint details, so only the error's kind is returned.
    return Response.json({ error: "chain_read_failed", kind: error?.name ?? "Error" }, { status: 502 });
  }
}
