// Real-usage scorecard, read from Monad mainnet logs. Read-only: no key, no transactions.
//
//   node scripts/usage-scorecard.mjs [--json] [--out DIR] [--incentivized wallets.json]
//
// Wallets are split three ways: team (stats/data/team.json), incentivized (wallets that
// received a campaign reward: stats/data/incentivized.json, or a file you pass) and organic.
// The scoring lives in stats/lib/score.js, shared with stats.setsuna.finance.
// Logs already read are cached in .local/usage-cache.json, so a rerun reads only new blocks.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createPublicClient, http } from "viem";
import { computeUsage } from "../stats/lib/score.js";

const { values } = parseArgs({
  options: {
    rpc: { type: "string", default: process.env.MONAD_RPC_URL ?? "https://rpc2.monad.xyz" },
    json: { type: "boolean", default: false },
    out: { type: "string" },
    incentivized: { type: "string" },
  },
});

const root = new URL("..", import.meta.url).pathname;
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const team = readJson(`${root}stats/data/team.json`).wallets.map((w) => w.address);
const incentivized = readJson(values.incentivized ?? `${root}stats/data/incentivized.json`);
const cacheFile = `${root}.local/usage-cache.json`;
const cache = existsSync(cacheFile) ? readJson(cacheFile) : {};

const client = createPublicClient({ transport: http(values.rpc, { retryCount: 4, timeout: 30_000 }) });
const report = await computeUsage({ client, cache, team, incentivized });
mkdirSync(`${root}.local`, { recursive: true });
writeFileSync(cacheFile, JSON.stringify(cache));

if (values.out) {
  mkdirSync(values.out, { recursive: true });
  for (const [name, rows] of Object.entries({ snapshot: [report.snapshot], scorecard: report.scorecard, activity: report.activity, daily: report.daily, wallets: report.wallets }))
    writeFileSync(`${values.out}/${name}.json`, JSON.stringify(rows, null, 1));
}
if (values.json) console.log(JSON.stringify(report, null, 2));
else {
  const s = report.snapshot;
  console.log(`Setsuna usage, ${s.network}, through block ${s.through_block} (${s.at})\n`);
  console.log("metric".padEnd(28) + "organic".padStart(10) + "rewarded".padStart(10) + "team".padStart(10) + "target".padStart(14));
  for (const r of report.scorecard)
    console.log(r.label.padEnd(28) + String(r.organic ?? "—").padStart(10) + String(r.incentivized ?? "—").padStart(10) + String(r.team ?? "—").padStart(10) + `${r.target_low}${r.target_high ? "–" + r.target_high : "+"}`.padStart(14));
  console.log("\nWallets are addresses, not verified people. Perps filled notional is not computed.");
}
