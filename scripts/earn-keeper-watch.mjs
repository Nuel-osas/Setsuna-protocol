import { spawn } from "node:child_process";
import { rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// A long-running worker, not a Vercel route. Every child holds the existing durable
// signer lock and reconciles pending receipts before choosing another action.
const interval = Number(process.env.EARN_KEEPER_INTERVAL_SECONDS ?? "15");
if (!Number.isInteger(interval) || interval < 15 || interval > 300)
  throw new Error("EARN_KEEPER_INTERVAL_SECONDS must be between 15 and 300");
let stopping = false,
  failures = 0,
  lastOk = null;
// After every run, a heartbeat the supervisor reads for /health and alerts.
const stateArg = process.argv.indexOf("--state-dir");
const heartbeat = stateArg > 0 ? resolve(process.argv[stateArg + 1], "heartbeat.json") : null;
async function beat(code) {
  if (!heartbeat) return;
  const body = JSON.stringify({ at: Date.now(), lastOk, failures, lastExitCode: code });
  await writeFile(`${heartbeat}.tmp`, body).then(() => rename(`${heartbeat}.tmp`, heartbeat)).catch(() => {});
}
const abort = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    stopping = true;
    abort.abort();
  });
while (!stopping) {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        new URL("earn-keeper.mjs", import.meta.url).pathname,
        ...process.argv.slice(2),
      ],
      { stdio: "inherit", env: process.env },
    );
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  // Each run reconciles its persisted journal before choosing an action, so a
  // retry never resubmits a transaction. Back off instead of halting the keeper.
  failures = code === 0 ? 0 : failures + 1;
  if (code === 0) lastOk = Date.now();
  await beat(code);
  if (failures)
    console.error(
      `Executor run failed (${failures} in a row); retrying after backoff. No automatic resubmission.`,
    );
  const wait = failures ? Math.min(300, interval * 2 ** failures) : interval;
  if (!stopping)
    await delay(wait * 1000, undefined, { signal: abort.signal }).catch(
      () => {},
    );
}
