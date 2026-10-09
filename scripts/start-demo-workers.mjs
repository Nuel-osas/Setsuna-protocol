import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "node:http";
import { privateKeyToAccount } from "viem/accounts";
import { keeperNetwork } from "./earn-keeper-network.mjs";
import { reviewedDemoFork } from "./demo-fork-profiles.mjs";
import { demoTradingFixture } from "./demo-trading-fixture.mjs";

// One persistent service supervises three independent workers. It never resets pending receipts.
async function main() {
  const localAdmin = process.argv.includes("--local-admin");
  const manifest = JSON.parse(process.env.SETSUNA_DEMO_MANIFEST ?? "null");
  if (!manifest?.earnUSDC || manifest.earnUSDC.adapters?.length !== 5)
    throw new Error("Combined five-protocol manifest required");
  reviewedDemoFork(manifest);
  const rpc = process.env.SETSUNA_DEMO_RPC_URL;
  const adminRPC = process.env.SETSUNA_DEMO_ADMIN_RPC_URL;
  const keyMON = process.env.SETSUNA_MON_KEEPER_PRIVATE_KEY;
  const keyUSDC = process.env.SETSUNA_USDC_KEEPER_PRIVATE_KEY;
  const signers = [privateKeyToAccount(keyMON), privateKeyToAccount(keyUSDC)];
  if (signers[0].address === signers[1].address)
    throw new Error("Separate MON and USDC signers required");
  for (const [i, assetSymbol] of ["MON", "USDC"].entries()) {
    const { client } = await keeperNetwork({
      rpc,
      manifest,
      assetSymbol,
      address: i === 0 ? manifest.vault : manifest.earnUSDC.vault,
    });
    if ((await client.getBalance({ address: signers[i].address })) === 0n)
      throw new Error("Executor signer needs synthetic gas");
  }
  await demoTradingFixture({ rpc, adminRPC, manifest, localAdmin });
  if (!process.argv.includes("--execute")) {
    console.log(
      JSON.stringify({
        mode: "read-only",
        checks: [
          "reviewed-fork",
          "both-vaults",
          "distinct-funded-signers",
          "price-fixture",
        ],
        workers: 3,
      }),
    );
    return;
  }
  if (!process.env.SETSUNA_WORKER_STATE_DIR)
    throw new Error("Persistent state directory required");
  const dir = resolve(process.env.SETSUNA_WORKER_STATE_DIR);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const manifestPath = `${dir}/manifest.json`;
  const identity = (m) =>
    JSON.stringify([
      m.chainId,
      m.forkHash,
      m.vault,
      m.earnUSDC?.vault,
      m.perplFactory,
      m.faucet,
    ]);
  try {
    const prior = JSON.parse(await readFile(manifestPath, "utf8"));
    if (identity(prior) !== identity(manifest))
      throw new Error("State directory belongs to a different deployment");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), {
    mode: 0o600,
  });
  const common = { ...process.env };
  delete common.SETSUNA_MON_KEEPER_PRIVATE_KEY;
  delete common.SETSUNA_USDC_KEEPER_PRIVATE_KEY;
  delete common.EARN_KEEPER_PRIVATE_KEY;
  const definitions = [
    {
      name: "MON",
      script: "earn-keeper-watch.mjs",
      args: [
        "--demo-manifest",
        manifestPath,
        "--asset",
        "MON",
        "--vault",
        manifest.vault,
        "--execute",
        "--max-gas-price-gwei",
        "200",
        "--max-gas",
        "1500000",
        "--state-dir",
        `${dir}/mon`,
      ],
      env: {
        ...common,
        MONAD_RPC_URL: rpc,
        EARN_KEEPER_PRIVATE_KEY: keyMON,
        SETSUNA_DEMO_ADMIN_RPC_URL: "",
      },
    },
    {
      name: "USDC",
      script: "earn-keeper-watch.mjs",
      args: [
        "--demo-manifest",
        manifestPath,
        "--asset",
        "USDC",
        "--multi",
        "--vault",
        manifest.earnUSDC.vault,
        "--execute",
        "--max-gas-price-gwei",
        "200",
        "--max-gas",
        "3500000",
        "--state-dir",
        `${dir}/usdc`,
      ],
      env: {
        ...common,
        MONAD_RPC_URL: rpc,
        EARN_KEEPER_PRIVATE_KEY: keyUSDC,
        SETSUNA_DEMO_ADMIN_RPC_URL: "",
      },
    },
    {
      name: "Perps fixture",
      script: "demo-trading-watch.mjs",
      args: [
        "--manifest",
        manifestPath,
        "--execute",
        "--watch",
        "--journal",
        `${dir}/perps-price.json`,
        ...(localAdmin ? ["--local-admin"] : []),
      ],
      env: common,
    },
  ];
  const children = [];
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    for (const child of children)
      if (child.exitCode === null) child.kill("SIGTERM");
  };
  for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, stop);
  const server = createServer((req, res) => {
    const ready =
      !stopping &&
      children.length === 3 &&
      children.every((c) => c.exitCode === null);
    res.writeHead(req.url === "/health" ? (ready ? 200 : 503) : 404, {
      "Content-Type": "application/json",
    });
    res.end(
      JSON.stringify(
        req.url === "/health" ? { ready, workers: 3 } : { error: "Not found" },
      ),
    );
  });
  // The health endpoint reports process liveness only; receipts remain the execution evidence.
  const port = Number(process.env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid health port");
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, localAdmin ? "127.0.0.1" : "0.0.0.0", resolve);
  });
  try {
    await Promise.all(
      definitions.map(
        (def) =>
          new Promise((resolve) => {
            const child = spawn(
              process.execPath,
              [`scripts/${def.script}`, ...def.args],
              { env: def.env, stdio: "inherit" },
            );
            children.push(child);
            child.once("error", () => {
              process.exitCode = 1;
              stop();
              resolve();
            });
            child.once("exit", (code) => {
              if (!stopping) {
                console.error(
                  `${def.name} worker stopped; inspect receipts before restarting.`,
                );
                process.exitCode = code || 1;
                stop();
              }
              resolve();
            });
          }),
      ),
    );
  } finally {
    stop();
    server.close();
  }
}
main().catch(() => {
  console.error(
    "Worker setup stopped. Check private configuration, deployment identity and persisted receipts. Credentials are not logged.",
  );
  process.exitCode = 1;
});
