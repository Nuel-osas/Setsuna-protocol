import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { formatEther, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnetEarn } from "../src/lib/setsuna/mainnet-earn.ts";
import { keeperNetwork } from "./earn-keeper-network.mjs";

// One persistent service supervises the setsUSDC and setsMON keepers on Monad
// mainnet. Each keeper has its own gas wallet; neither holds the treasury key.
// Every run reconciles its persisted journal before acting, so a restart never
// resubmits a new transaction. The two keepers run independently: one failing,
// stopping or running out of gas never takes the other down.

// A keeper is unhealthy when it hasn't completed a run for this long (runs every
// 60 s; failures back off to at most 300 s).
const STALE_MS = 15 * 60 * 1000;
// Enough for one full emergency exit at today's gas (USDC ~3.6 MON); warn below it.
const LOW_GAS = parseEther("3");
const EMPTY_GAS = parseEther("1");
const ALERT_EVERY_MS = 60 * 60 * 1000;

async function main() {
  const d = mainnetEarn();
  if (!d) throw new Error("SETSUNA_MAINNET_EARN required");
  const rpc = process.env.MONAD_RPC_URL ?? "https://rpc.monad.xyz";
  const keyMON = process.env.SETSUNA_MAINNET_MON_KEEPER_PRIVATE_KEY;
  const keyUSDC = process.env.SETSUNA_MAINNET_USDC_KEEPER_PRIVATE_KEY;
  const signers = [privateKeyToAccount(keyMON), privateKeyToAccount(keyUSDC)];
  if (signers[0].address === signers[1].address)
    throw new Error("Separate MON and USDC signers required");
  const { client } = await keeperNetwork({ rpc });
  if (!process.env.SETSUNA_KEEPER_STATE_DIR)
    throw new Error("Persistent state directory required");
  const dir = resolve(process.env.SETSUNA_KEEPER_STATE_DIR);
  await mkdir(dir, { recursive: true, mode: 0o700 });

  const common = { ...process.env, MONAD_RPC_URL: rpc };
  delete common.SETSUNA_MAINNET_MON_KEEPER_PRIVATE_KEY;
  delete common.SETSUNA_MAINNET_USDC_KEEPER_PRIVATE_KEY;
  delete common.EARN_KEEPER_PRIVATE_KEY;
  const shared = ["--execute", "--max-gas-price-gwei", "300"];
  const definitions = [
    {
      name: "MON",
      signer: signers[0].address,
      state: `${dir}/mon`,
      args: ["--asset", "MON", "--vault", d.earnMON.vault, "--max-gas", "2000000", "--state-dir", `${dir}/mon`],
      key: keyMON,
    },
    {
      name: "USDC",
      signer: signers[1].address,
      state: `${dir}/usdc`,
      args: ["--asset", "USDC", "--multi", "--vault", d.earnUSDC.vault, "--max-gas", "3500000", "--state-dir", `${dir}/usdc`],
      key: keyUSDC,
    },
  ];

  // No keeper runs yet, so any lock left by a crash or redeploy is stale. Without this, a
  // leftover lock fails every later run with "file exists".
  for (const def of definitions) {
    await mkdir(def.state, { recursive: true, mode: 0o700 });
    for (const f of await readdir(def.state))
      if (f.endsWith(".lock")) {
        await unlink(resolve(def.state, f));
        console.error(JSON.stringify({ keeper: def.name, cleared: "stale lock" }));
      }
  }

  const startedAt = Date.now();
  const warmingUp = () => Date.now() - startedAt < STALE_MS;

  // Health: each keeper's last successful run (from its heartbeat) and its gas balance.
  let balances = { at: 0, values: {} };
  async function status() {
    if (Date.now() - balances.at > 60_000) {
      const values = {};
      for (const def of definitions)
        values[def.name] = await client.getBalance({ address: def.signer }).catch(() => null);
      balances = { at: Date.now(), values };
    }
    return Promise.all(
      definitions.map(async (def) => {
        const beat = await readFile(resolve(def.state, "heartbeat.json"), "utf8").then(JSON.parse).catch(() => null);
        const balance = balances.values[def.name];
        const lastOk = beat?.lastOk ?? null;
        return {
          name: def.name,
          running: def.child?.exitCode === null,
          lastOkSecondsAgo: lastOk ? Math.round((Date.now() - lastOk) / 1000) : null,
          failuresInARow: beat?.failures ?? null,
          gasMON: balance == null ? null : Number(formatEther(balance)),
          healthy:
            def.child?.exitCode === null &&
            (warmingUp() || (lastOk !== null && Date.now() - lastOk < STALE_MS)) &&
            (balance == null || balance >= EMPTY_GAS),
          lowGas: balance != null && balance < LOW_GAS,
        };
      }),
    );
  }

  // Alerts go to Telegram (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID) and/or ALERT_WEBHOOK_URL (Discord
  // or Slack) when set, and always to the log as an ALERT line. Each condition alerts at most hourly,
  // and once more when it clears. The bot token is never logged.
  async function notify(message) {
    const sends = [];
    const url = process.env.ALERT_WEBHOOK_URL;
    if (url)
      sends.push(fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: message, text: message }), signal: AbortSignal.timeout(10_000) }));
    const bot = process.env.TELEGRAM_BOT_TOKEN;
    const chat = process.env.TELEGRAM_CHAT_ID;
    if (bot && chat)
      sends.push(fetch(`https://api.telegram.org/bot${bot}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chat, text: message, disable_web_page_preview: true }), signal: AbortSignal.timeout(10_000) }));
    const results = await Promise.allSettled(sends);
    if (results.some((r) => r.status === "rejected" || !r.value.ok)) console.error("ALERT delivery failed for at least one destination");
  }
  const raised = new Map();
  async function alert(key, active, text) {
    const last = raised.get(key);
    if (active && (!last || Date.now() - last >= ALERT_EVERY_MS)) raised.set(key, Date.now());
    else if (!active && last) raised.delete(key);
    else return;
    const message = active ? `⚠️ Setsuna keepers: ${text}` : `✅ Setsuna keepers: resolved, ${text}`;
    console.error(`ALERT ${message}`);
    await notify(message);
  }
  const watch = setInterval(async () => {
    for (const s of await status().catch(() => [])) {
      const stalled = !warmingUp() && (s.lastOkSecondsAgo === null || s.lastOkSecondsAgo * 1000 >= STALE_MS);
      await alert(`${s.name}:stalled`, stalled, `${s.name} keeper has not completed a run in ${s.lastOkSecondsAgo === null ? "this session" : `${Math.round(s.lastOkSecondsAgo / 60)} min`} (${s.failuresInARow ?? "?"} failures in a row)`);
      await alert(`${s.name}:gas`, s.lowGas, `${s.name} keeper gas is ${s.gasMON?.toFixed(2)} MON (keep at least ${formatEther(LOW_GAS)})`);
    }
  }, 60_000);

  let stopping = false;
  let server;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    clearInterval(watch);
    for (const def of definitions) if (def.child?.exitCode === null) def.child.kill("SIGTERM");
    server?.close();
  };
  for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, stop);

  server = createServer(async (req, res) => {
    if (req.url !== "/health") {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Not found" }));
    }
    const keepers = await status().catch(() => []);
    // Ready while warming up after a start, then only with recent successful runs and gas.
    const ready = !stopping && keepers.length === definitions.length && keepers.every((k) => k.healthy);
    res.writeHead(ready ? 200 : 503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ready, network: "monad-mainnet", keepers }));
  });
  const port = Number(process.env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid health port");
  await new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(port, "0.0.0.0", done);
  });

  // Each keeper loop restarts on its own after a pause if it exits; the other keeps running.
  function run(def) {
    if (stopping) return;
    const child = spawn(process.execPath, ["scripts/earn-keeper-watch.mjs", ...def.args, ...shared], {
      env: { ...common, EARN_KEEPER_INTERVAL_SECONDS: "60", EARN_KEEPER_PRIVATE_KEY: def.key },
      stdio: "inherit",
    });
    def.child = child;
    const restart = async (why) => {
      if (stopping) return;
      console.error(JSON.stringify({ keeper: def.name, stopped: why, restartingIn: "30s" }));
      await delay(30_000);
      run(def);
    };
    child.once("error", () => restart("spawn error"));
    child.once("exit", (code) => restart(`exit ${code}`));
  }
  for (const def of definitions) run(def);
  // One message per start, so a new alert destination can be confirmed working.
  if (process.env.TELEGRAM_BOT_TOKEN || process.env.ALERT_WEBHOOK_URL)
    await notify("Setsuna keepers started. Alerts are on: you'll hear here if a keeper stalls or runs low on gas.");
}
main().catch(() => {
  console.error(
    "Keeper setup stopped. Check private configuration and the state directory. Credentials are not logged.",
  );
  process.exitCode = 1;
});
