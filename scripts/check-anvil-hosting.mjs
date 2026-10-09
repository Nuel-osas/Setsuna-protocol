import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  toHex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { demoForkProfiles } from "./demo-fork-profiles.mjs";

// Isolated persistence probe. Never attaches to or resets an existing demo node.
const dir = resolve(`.local/anvil-hosting-check-${Date.now()}`);
const rpc = "http://127.0.0.1:18615";
const profile = demoForkProfiles.unified;
const source =
  process.env.MONAD_RPC_URL ?? "https://rpc-mainnet.monadinfra.com";
const client = createPublicClient({
  transport: http(rpc, { retryCount: 0, timeout: 1500 }),
});
const upstream = createPublicClient({
  transport: http(source, { retryCount: 0, timeout: 20000 }),
});
let child;
const stop = async () => {
  if (!child || child.exitCode !== null) return;
  const exit = once(child, "exit");
  child.kill("SIGINT");
  const outcome = await Promise.race([exit, delay(15000).then(() => null)]);
  if (!outcome) {
    child.kill("SIGKILL");
    await exit;
    throw new Error("Anvil did not shut down cleanly");
  }
  child = undefined;
};
const start = async () => {
  child = spawn(
    "anvil",
    [
      "--fork-url",
      source,
      "--fork-block-number",
      String(profile.block),
      "--chain-id",
      "31337",
      "--host",
      "127.0.0.1",
      "--port",
      "18615",
      "--accounts",
      "0",
      "--state",
      `${dir}/state.json`,
      "--state-interval",
      "2",
      "--cache-path",
      `${dir}/cache`,
      "--quiet",
    ],
    { stdio: ["ignore", "ignore", "ignore"] },
  );
  child.once("error", () => {});
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null)
      throw new Error("Anvil stopped during startup");
    try {
      if ((await client.getChainId()) === 31337) return;
    } catch {}
    await delay(250);
  }
  throw new Error("Anvil startup timed out");
};

try {
  let occupied = false;
  try {
    await client.getChainId();
    occupied = true;
  } catch {}
  assert.equal(occupied, false, "Probe port is already occupied");
  assert.equal(await upstream.getChainId(), 143);
  assert.equal(
    (await upstream.getBlock({ blockNumber: profile.block })).hash,
    profile.hash,
  );
  await mkdir(dir, { mode: 0o700 });
  await start();
  const account = privateKeyToAccount(generatePrivateKey());
  const recipient = privateKeyToAccount(generatePrivateKey()).address;
  await client.request({
    method: "anvil_setBalance",
    params: [account.address, toHex(parseEther("3"))],
  });
  const wallet = createWalletClient({ account, transport: http(rpc) });
  const hash = await wallet.sendTransaction({
    chain: null,
    to: recipient,
    value: parseEther("1"),
    gas: 21000n,
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, "success");
  // Runtime emits an event and writes storage slot zero on every call.
  const runtime = "0x60003560005560006000a000";
  const contract = "0x0000000000000000000000000000000000001337";
  await client.request({
    method: "anvil_setCode",
    params: [contract, runtime],
  });
  const contractHash = await wallet.sendTransaction({
    chain: null,
    to: contract,
    data: toHex(42n, { size: 32 }),
    gas: 100000n,
  });
  const contractReceipt = await client.waitForTransactionReceipt({
    hash: contractHash,
  });
  assert.equal(contractReceipt.status, "success");
  assert.equal(contractReceipt.logs.length, 1);
  const before = {
    block: String(await client.getBlockNumber({ cacheTime: 0 })),
    sender: String(await client.getBalance({ address: account.address })),
    recipient: String(await client.getBalance({ address: recipient })),
    nonce: await client.getTransactionCount({ address: account.address }),
    storage: await client.getStorageAt({
      address: contract,
      slot: toHex(0, { size: 32 }),
    }),
    code: await client.getCode({ address: contract }),
  };
  await stop();
  const saved = JSON.parse(await readFile(`${dir}/state.json`, "utf8"));
  await start();
  const after = {
    block: String(await client.getBlockNumber({ cacheTime: 0 })),
    sender: String(await client.getBalance({ address: account.address })),
    recipient: String(await client.getBalance({ address: recipient })),
    nonce: await client.getTransactionCount({ address: account.address }),
    storage: await client.getStorageAt({
      address: contract,
      slot: toHex(0, { size: 32 }),
    }),
    code: await client.getCode({ address: contract }),
  };
  assert.deepEqual(
    after,
    before,
    "State changed after restarting the isolated fork",
  );
  let persistedReceipt = false,
    persistedTransaction = false,
    persistedLogs = false;
  try {
    persistedReceipt =
      (await client.getTransactionReceipt({ hash: contractHash })).blockHash ===
      contractReceipt.blockHash;
  } catch {}
  try {
    persistedTransaction =
      (await client.getTransaction({ hash: contractHash })).hash ===
      contractHash;
  } catch {}
  try {
    persistedLogs =
      (
        await client.getLogs({
          address: contract,
          fromBlock: contractReceipt.blockNumber,
          toBlock: contractReceipt.blockNumber,
        })
      ).length === 1;
  } catch {}
  const result = {
    author: "Codex",
    recordedAt: new Date().toISOString(),
    scope: "Isolated Anvil fork; state persistence after graceful restart",
    forkBlock: String(profile.block),
    forkHash: profile.hash,
    statePreserved: true,
    persistedReceipt,
    persistedTransaction,
    persistedLogs,
    stateFileFields: Object.keys(saved),
    before,
    after,
    testTransaction: hash,
    storageTransaction: contractHash,
    cloudDeployed: false,
  };
  await writeFile(`${dir}/result.json`, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ directory: dir, ...result }, null, 2));
} finally {
  await stop();
}
