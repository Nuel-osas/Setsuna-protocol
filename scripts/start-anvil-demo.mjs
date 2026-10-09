import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createDemoGateway, atomicJSON } from "./anvil-demo-gateway.mjs";
import { demoForkProfiles, reviewedDemoFork } from "./demo-fork-profiles.mjs";

const children = [];
let gateway,
  stopping = false,
  ready = false,
  available = false,
  manifest;
let shutdown;
const stateDir = resolve(
  process.env.SETSUNA_HOSTED_STATE_DIR ?? "/data/setsuna",
);
const port = Number(process.env.PORT ?? 8080);
const anvilPort = Number(process.env.SETSUNA_ANVIL_PORT ?? 8545);
const adminPort = Number(process.env.SETSUNA_ADMIN_PORT ?? 8546);
const workerPort = Number(process.env.SETSUNA_WORKER_HEALTH_PORT ?? 8547);
const internalRPC = `http://127.0.0.1:${anvilPort}`;
const adminRPC = `http://127.0.0.1:${adminPort}`;
const token = process.env.SETSUNA_GATEWAY_TOKEN;
const faucetToken = process.env.SETSUNA_FAUCET_TOKEN;
const rpc = `http://127.0.0.1:${port}/${token}`;
const statePath = `${stateDir}/chain-state.json`;
const bootPath = `${stateDir}/bootstrap.json`;
const deploymentDir = `${stateDir}/deployment`;

const owned = (command, args, env) => {
  if (stopping) throw new Error("Shutdown in progress");
  const child = spawn(command, args, { env, stdio: "inherit" });
  const entry = {
    child,
    exited: new Promise((resolve) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
      child.once("error", () => resolve({ code: 1 }));
    }),
  };
  children.push(entry);
  return entry;
};
const terminate = async (entry, signal) => {
  if (!entry || entry.child.exitCode !== null || entry.child.signalCode) return;
  entry.child.kill(signal);
  let timeout;
  const ended = await Promise.race([
    entry.exited,
    new Promise((resolve) => {
      timeout = setTimeout(() => resolve(null), 15000);
    }),
  ]);
  clearTimeout(timeout);
  if (!ended) {
    entry.child.kill("SIGKILL");
    await entry.exited;
    process.exitCode = 1;
  }
};
const stop = (failed = false) => {
  if (shutdown) return shutdown;
  stopping = true;
  ready = false;
  available = false;
  if (failed) process.exitCode = 1;
  shutdown = (async () => {
    // Finish/stop transaction-producing processes before stopping the gateway and node.
    for (const entry of children.slice(1).reverse())
      await terminate(entry, "SIGTERM");
    if (gateway) {
      try {
        await gateway.close();
        await gateway.checkpoint();
      } catch {
        process.exitCode = 1;
      }
    }
    await terminate(children[0], "SIGINT");
    console.log(
      "Hosted demo stopped; durable fork state and worker journals retained.",
    );
  })();
  return shutdown;
};
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, () => {
    void stop();
  });

async function main() {
  if (!process.argv.includes("--execute"))
    throw new Error("Explicit --execute is required");
  if (!/^[a-f0-9]{64}$/.test(token ?? ""))
    throw new Error("A private random gateway token is required");
  if (!/^[a-f0-9]{64}$/.test(faucetToken ?? "") || faucetToken === token)
    throw new Error("A separate private faucet token is required");
  if (
    [port, anvilPort, adminPort, workerPort].some(
      (p) => !Number.isInteger(p) || p < 1024 || p > 65535,
    ) ||
    new Set([port, anvilPort, adminPort, workerPort]).size !== 4
  )
    throw new Error("Four distinct valid service ports are required");
  if (
    process.env.RAILWAY_ENVIRONMENT_ID &&
    process.env.RAILWAY_VOLUME_MOUNT_PATH !== "/data"
  )
    throw new Error("A persistent Railway volume at /data is required");
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const resumes = existsSync(bootPath);
  let resumedTimestamp;
  if (resumes) {
    const boot = JSON.parse(await readFile(bootPath, "utf8"));
    if (boot.status !== "ready" || !existsSync(statePath))
      throw new Error(
        "Incomplete bootstrap: inspect persisted deployment receipts before recovery",
      );
    manifest = JSON.parse(
      await readFile(`${deploymentDir}/manifest.json`, "utf8"),
    );
    reviewedDemoFork(manifest);
    const snapshot = JSON.parse(await readFile(statePath, "utf8"));
    const lastTimestamp = Object.values(snapshot.blocks).reduce(
      (maximum, block) => {
        const timestamp = BigInt(block.header.timestamp);
        return timestamp > maximum ? timestamp : maximum;
      },
      BigInt(snapshot.block.timestamp),
    );
    const elapsed = BigInt(
      Math.max(
        1,
        Math.floor((Date.now() - (await stat(statePath)).mtimeMs) / 1000),
      ),
    );
    resumedTimestamp = lastTimestamp + elapsed;
  } else if (existsSync(statePath) || existsSync(deploymentDir)) {
    throw new Error("Unrecognized existing fork state; refusing to reset it");
  }
  const profile = demoForkProfiles.unified;
  const upstream =
    process.env.MONAD_RPC_URL ?? "https://rpc-mainnet.monadinfra.com";
  const source = createPublicClient({
    transport: http(upstream, { timeout: 20000, retryCount: 0 }),
  });
  if (
    (await source.getChainId()) !== 143 ||
    (await source.getBlock({ blockNumber: profile.block })).hash !==
      profile.hash
  )
    throw new Error("Source RPC does not serve the reviewed Monad snapshot");
  const client = createPublicClient({
    transport: http(internalRPC, { timeout: 2000, retryCount: 0 }),
  });
  let occupied = false;
  try {
    await client.getChainId();
    occupied = true;
  } catch {}
  if (occupied) throw new Error("Internal Anvil port is already occupied");
  if (!resumes)
    await atomicJSON(bootPath, {
      status: "deploying",
      forkBlock: String(profile.block),
      forkHash: profile.hash,
    });
  console.log(
    resumes
      ? "Restoring the persisted Monad demo fork…"
      : "Starting a fresh pinned Monad demo fork…",
  );
  const anvil = owned(
    "anvil",
    [
      "--fork-url",
      upstream,
      "--fork-block-number",
      String(profile.block),
      "--chain-id",
      "31337",
      "--host",
      "127.0.0.1",
      "--port",
      String(anvilPort),
      "--accounts",
      "0",
      "--gas-limit",
      "1000000000",
      "--quiet",
      "--cache-path",
      `${stateDir}/rpc-cache`,
      ...(resumes
        ? ["--load-state", statePath, "--timestamp", String(resumedTimestamp)]
        : []),
    ],
    process.env,
  );
  anvil.exited.then(() => {
    if (!stopping) {
      console.error("Fork process stopped.");
      void stop(true);
    }
  });
  let online = false;
  for (let i = 0; i < 160 && !stopping; i++) {
    try {
      if ((await client.getChainId()) === 31337) {
        online = true;
        break;
      }
    } catch {}
    await delay(250);
  }
  if (!online || stopping) throw new Error("Fork startup failed");
  if (resumes) {
    // Anvil restores EVM state but not its wall-clock offset. Restore monotonic time
    // before any worker executes interest calculations or oracle refreshes.
    await client.request({
      method: "evm_setNextBlockTimestamp",
      params: [Number(resumedTimestamp)],
    });
    await client.request({ method: "evm_mine", params: [] });
    if ((await client.getBlock()).timestamp < resumedTimestamp)
      throw new Error("Fork clock recovery failed");
  }
  gateway = await createDemoGateway({
    upstream: internalRPC,
    token,
    faucetToken,
    statePath,
    port,
    adminPort,
    ready: () => ready && !stopping,
    available: () => available && !stopping,
    manifest: () => manifest,
    fatal: () => {
      console.error("Durable checkpoint failed; stopping writes.");
      void stop(true);
    },
  });
  if (resumes) await gateway.checkpoint();
  if (!resumes) {
    console.log("Deploying Earn, Spot, Perps and the bounded test faucet…");
    const deploy = owned(
      process.execPath,
      [
        "scripts/deploy-hosted-demo.mjs",
        "--unified",
        "--local-admin",
        "--execute",
        "--output",
        deploymentDir,
      ],
      {
        ...process.env,
        SETSUNA_DEMO_RPC_URL: adminRPC,
        SETSUNA_DEMO_ADMIN_RPC_URL: adminRPC,
      },
    );
    if ((await deploy.exited).code !== 0 || stopping)
      throw new Error("Initial contract deployment incomplete");
    manifest = JSON.parse(
      await readFile(`${deploymentDir}/manifest.json`, "utf8"),
    );
    reviewedDemoFork(manifest);
    await gateway.checkpoint();
    await atomicJSON(bootPath, {
      status: "ready",
      forkBlock: manifest.forkBlock,
      forkHash: manifest.forkHash,
      vault: manifest.vault,
      faucet: manifest.faucet,
    });
  }
  available = true;
  const mon = parseEnv(await readFile(`${deploymentDir}/keeper.env`, "utf8"));
  const usdc = parseEnv(
    await readFile(`${deploymentDir}/usdc-keeper.env`, "utf8"),
  );
  // This supervisor has established sole ownership of the node before any
  // worker starts. A killed process can leave its mutex file behind; retain
  // receipt journals so the executor still reconciles before another broadcast.
  for (const [asset, env] of [
    ["mon", mon],
    ["usdc", usdc],
  ]) {
    const signer = privateKeyToAccount(
      env.EARN_KEEPER_PRIVATE_KEY,
    ).address.toLowerCase();
    const lock = `${stateDir}/workers/${asset}/31337-${signer}.lock`;
    try {
      const previous = JSON.parse(await readFile(lock, "utf8"));
      if (!Number.isInteger(previous.pid) || previous.pid <= 0)
        throw new Error("Invalid prior executor lock");
      await unlink(lock);
      console.log(
        `Released prior ${asset} process lock; transaction journal retained.`,
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const workers = owned(
    process.execPath,
    ["scripts/start-demo-workers.mjs", "--execute", "--local-admin"],
    {
      ...process.env,
      PORT: String(workerPort),
      SETSUNA_DEMO_RPC_URL: rpc,
      SETSUNA_DEMO_ADMIN_RPC_URL: adminRPC,
      SETSUNA_DEMO_MANIFEST: JSON.stringify(manifest),
      SETSUNA_MON_KEEPER_PRIVATE_KEY: mon.EARN_KEEPER_PRIVATE_KEY,
      SETSUNA_USDC_KEEPER_PRIVATE_KEY: usdc.EARN_KEEPER_PRIVATE_KEY,
      SETSUNA_WORKER_STATE_DIR: `${stateDir}/workers`,
    },
  );
  workers.exited.then(() => {
    if (!stopping) {
      console.error("Worker supervisor stopped.");
      void stop(true);
    }
  });
  for (let i = 0; i < 120 && !stopping; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${workerPort}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok && (await response.json()).ready) {
        ready = true;
        break;
      }
    } catch {}
    await delay(500);
  }
  if (!ready || stopping) throw new Error("Worker startup failed");
  console.log(
    "Hosted Setsuna demo ready: persistent fork, three workers, restricted RPC and explorer.",
  );
  await Promise.race([anvil.exited, workers.exited]);
  await stop(process.exitCode === 1);
}
main().catch(async (error) => {
  console.error(
    `Hosted demo stopped: ${String(error.shortMessage ?? error.message)
      .replace(/https?:\/\/[^\s"'<>]+/g, "[RPC endpoint]")
      .slice(0, 300)}`,
  );
  await stop(true);
});
