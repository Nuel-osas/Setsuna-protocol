import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

// A long-running worker, not a Vercel route. Every child holds the existing durable
// signer lock and reconciles pending receipts before choosing another action.
const interval = Number(process.env.EARN_KEEPER_INTERVAL_SECONDS ?? "15");
if (!Number.isInteger(interval) || interval < 15 || interval > 300)
  throw new Error("EARN_KEEPER_INTERVAL_SECONDS must be between 15 and 300");
let stopping = false;
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
  if (code !== 0) {
    console.error(
      "Executor halted. Inspect pending state and RPC health before restarting; no automatic resubmission.",
    );
    process.exitCode = 1;
    break;
  }
  if (!stopping)
    await delay(interval * 1000, undefined, { signal: abort.signal }).catch(
      () => {},
    );
}
