import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { demoTradingFixture } from "./demo-trading-fixture.mjs";

const { values } = parseArgs({
  options: {
    manifest: { type: "string" },
    execute: { type: "boolean", default: false },
    watch: { type: "boolean", default: false },
    "local-admin": { type: "boolean", default: false },
    journal: { type: "string" },
  },
});
async function main() {
  if (!values.manifest) throw new Error("Manifest required");
  const manifest = JSON.parse(await readFile(values.manifest, "utf8"));
  if (!manifest.perplFixture) throw new Error("Deploy the demo fixture first");
  const fixture = await demoTradingFixture({
    rpc: process.env.SETSUNA_DEMO_RPC_URL,
    adminRPC: process.env.SETSUNA_DEMO_ADMIN_RPC_URL,
    manifest,
    localAdmin: values["local-admin"],
    record: async (entry) => {
      await writeFile(values.journal, JSON.stringify(entry, null, 2) + "\n", {
        mode: 0o600,
      });
    },
  });
  if (!values.execute) {
    console.log(
      JSON.stringify({ mode: "read-only", fixture: fixture.fixture }),
    );
    return;
  }
  if (!values.journal) throw new Error("A receipt journal path is required");
  try {
    const prior = JSON.parse(await readFile(values.journal, "utf8"));
    if (prior.state !== "confirmed")
      throw new Error(
        "Reconcile the pending fixture transaction before restarting",
      );
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  let stopped = false;
  process.on("SIGTERM", () => {
    stopped = true;
  });
  process.on("SIGINT", () => {
    stopped = true;
  });
  do {
    console.log(
      JSON.stringify({
        mode: "FIXED_HISTORICAL_MARK",
        ...(await fixture.refresh()),
      }),
    );
    if (!values.watch || stopped) break;
    await delay(15000);
  } while (!stopped);
}
main().catch(() => {
  console.error(
    "Demo price worker stopped. Inspect the fixture journal and receipt before restarting. No RPC credentials are logged.",
  );
  process.exitCode = 1;
});
