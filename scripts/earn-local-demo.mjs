import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, readFile, writeFile, open } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseEther,
} from "viem";
import { inspectVault, json } from "./earn-keeper-core.mjs";
import {
  prepareTradingFixtures,
  refreshTradingMark,
  runLocalProtection,
} from "./trading-fixtures.mjs";

const { values } = parseArgs({
  options: {
    keep: { type: "boolean", default: false },
    trading: { type: "boolean", default: false },
  },
});
const root = fileURLToPath(new URL("../", import.meta.url));
const port = values.trading ? 18608 : 18607;
const outputDir = values.trading ? "trading" : "setsmon";
const rpc = `http://127.0.0.1:${port}`;
const upstream = process.env.MONAD_RPC_URL ?? "https://rpc.monad.xyz";
const forkBlock = 110418863n;
const forkHash =
  "0xed4f56748e560219f9926e46d78591ec746b5bca4497e65d0734062fbb46a97b";
await mkdir(`${root}/.local/setsmon`, { recursive: true });
await mkdir(`${root}/.local/${outputDir}`, { recursive: true });
await new Promise((resolve, reject) => {
  const reservation = createServer();
  reservation.once("error", () =>
    reject(
      new Error(`Port ${port} is occupied; existing process was left alone`),
    ),
  );
  reservation.listen(port, "127.0.0.1", () => reservation.close(resolve));
});
const upstreamClient = createPublicClient({
  transport: http(upstream, { timeout: 20_000 }),
});
if ((await upstreamClient.getChainId()) !== 143)
  throw new Error("Read-only upstream must be Monad mainnet");
const pinned = await upstreamClient.getBlock({ blockNumber: forkBlock });
if (pinned.hash !== forkHash)
  throw new Error("Fork block differs from reviewed evidence");
const log = await open(`${root}/.local/${outputDir}/anvil.log`, "w");
const anvil = spawn(
  "anvil",
  [
    "--fork-url",
    upstream,
    "--fork-block-number",
    String(forkBlock),
    "--chain-id",
    "31337",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--silent",
    "--gas-limit",
    "1000000000",
    "--timestamp",
    String(pinned.timestamp),
  ],
  { cwd: root, stdio: ["ignore", log.fd, log.fd] },
);
let spawnError;
anvil.on("error", (error) => {
  spawnError = error;
});
let stop;
const stopped = new Promise((resolve) => {
  stop = resolve;
});
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
const chain = defineChain({
  id: 31337,
  name: "Setsuna Earn — local Monad fork",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [rpc] } },
});
const client = createPublicClient({
  chain,
  transport: http(rpc, { retryCount: 0, timeout: 20_000 }),
});
const artifact = async (name) =>
  JSON.parse(await readFile(`${root}/contracts/abi/${name}.json`, "utf8"));
try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    if (spawnError || anvil.exitCode !== null)
      throw new Error(
        "Owned Anvil did not start; inspect .local/setsmon/anvil.log",
      );
    try {
      ready = (await client.getChainId()) === 31337;
    } catch {
      /* booting */
    }
    if (ready) break;
    await delay(250);
  }
  if (!ready) throw new Error("Local fork unavailable");
  await client.request({
    method: "evm_setNextBlockTimestamp",
    params: [Number(pinned.timestamp) + 1],
  });
  await client.request({
    method: "anvil_setBlockTimestampInterval",
    params: [1],
  });
  const [owner, seedOwner, executor] = await client.request({
    method: "eth_accounts",
  });
  await new Promise((resolve, reject) => {
    const child = spawn(
      "forge",
      [
        "script",
        "script/LocalEarnDemo.s.sol:LocalEarnDemo",
        "--rpc-url",
        rpc,
        "--broadcast",
        "--unlocked",
        "--sender",
        owner,
        "--slow",
      ],
      {
        cwd: `${root}/contracts`,
        env: { ...process.env, DEMO_OWNER: owner },
        stdio: "inherit",
      },
    );
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Local deploy failed: ${code}`)),
    );
  });
  const deployed = JSON.parse(
    await readFile(`${root}/.local/setsmon/deployed.json`, "utf8"),
  );
  const abi = await artifact("SetsunaMONVault");
  const gatewayAbi = await artifact("SetsunaMONGateway");
  const seed = createWalletClient({
    account: seedOwner,
    chain,
    transport: http(rpc),
  });
  const keeper = createWalletClient({
    account: executor,
    chain,
    transport: http(rpc),
  });
  const transactions = [];
  async function transact(
    wallet,
    address,
    abi,
    functionName,
    args = [],
    value = 0n,
  ) {
    const { request } = await client.simulateContract({
      account: wallet.account,
      address,
      abi,
      functionName,
      args,
      value,
    });
    const hash = await wallet.writeContract(request);
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success")
      throw new Error(`Local ${functionName} reverted`);
    transactions.push({
      operation: functionName,
      hash,
      blockNumber: receipt.blockNumber,
    });
  }
  const initial = await client.getBlock();
  await transact(
    seed,
    deployed.gateway,
    gatewayAbi,
    "depositMON",
    [seedOwner, 1000n * 10n ** 24n, initial.timestamp + 300n],
    parseEther("1000"),
  );
  await transact(keeper, deployed.vault, abi, "observeRates");
  for (let i = 0; i < 9; i++) {
    // Explicit demo-only clock acceleration to satisfy the immutable observation/cooldown policy.
    const block = await client.getBlock();
    await client.request({
      method: "evm_setNextBlockTimestamp",
      params: [Number(block.timestamp) + 600],
    });
    await client.request({ method: "evm_mine", params: [] });
    await transact(keeper, deployed.vault, abi, "observeRates");
    await client.request({ method: "evm_mine", params: [] });
    await transact(keeper, deployed.vault, abi, "rebalance");
  }
  const manifest = {
    ...deployed,
    rpc,
    mode: "LOCAL_FORK_ONLY",
    syntheticFunding: true,
    chainId: 31337,
    forkChainId: 143,
    forkBlock: String(forkBlock),
    forkHash,
    seedOwner,
    executor,
    startBlock: String(initial.number),
    seededMON: "1000",
    preparedAt: new Date().toISOString(),
  };
  if (values.trading) {
    await new Promise((resolve, reject) => {
      const child = spawn(
        "forge",
        [
          "script",
          "script/LocalTradingDemo.s.sol:LocalTradingDemo",
          "--rpc-url",
          rpc,
          "--broadcast",
          "--unlocked",
          "--sender",
          owner,
          "--slow",
        ],
        {
          cwd: `${root}/contracts`,
          env: { ...process.env, DEMO_OWNER: owner },
          stdio: "inherit",
        },
      );
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`Trading deploy failed: ${code}`)),
      );
    });
    Object.assign(
      manifest,
      JSON.parse(
        await readFile(`${root}/.local/trading/deployed.json`, "utf8"),
      ),
    );
    manifest.perplFixture = await prepareTradingFixtures(client, owner);
  }
  await writeFile(
    `${root}/.local/${outputDir}/demo.json`,
    JSON.stringify(manifest, null, 2) + "\n",
  );
  await writeFile(
    `${root}/.local/${outputDir}/transactions.json`,
    json(transactions) + "\n",
  );
  console.log(
    json({
      mode: manifest.mode,
      rpc,
      vault: deployed.vault,
      gateway: deployed.gateway,
      nativeMON: "synthetic",
      seededMON: "1000",
      manifest: `.local/${outputDir}/demo.json`,
    }),
  );
  if (values.keep) {
    console.log(
      "setsMON demo ready. The local executor checks every 15 seconds. Ctrl+C stops this owned fork.",
    );
    let halted = false;
    stopped.then(() => {
      halted = true;
    });
    while (!halted) {
      await Promise.race([stopped, delay(15_000)]);
      if (halted) break;
      try {
        if ((await client.getChainId()) !== 31337)
          throw new Error("Local network changed");
        const now = await client.getBlock();
        await client.request({
          method: "evm_setNextBlockTimestamp",
          params: [Number(now.timestamp) + 15],
        });
        await client.request({ method: "evm_mine", params: [] });
        if (values.trading) {
          await refreshTradingMark(client, manifest.perplFixture);
          await runLocalProtection(
            client,
            keeper,
            manifest.perplFactory,
            owner,
          );
        }
        const report = await inspectVault({
          client,
          address: deployed.vault,
          abi,
          assetSymbol: "MON",
        });
        if (report.action) {
          await transact(keeper, deployed.vault, abi, report.action);
          await writeFile(
            `${root}/.local/${outputDir}/transactions.json`,
            json(transactions) + "\n",
          );
          console.log(
            json({ localExecutor: report.action, block: report.blockNumber }),
          );
        }
      } catch (error) {
        console.error(
          "Local executor stopped after an uncertain/failed action; restart after reviewing local receipts.",
        );
        // Do not retry a possibly broadcast write. Keep the UI's fork available for inspection.
        await stopped;
        break;
      }
    }
  }
} finally {
  anvil.kill("SIGTERM");
  await log.close();
}
