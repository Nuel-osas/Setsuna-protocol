import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, readFile, writeFile, open } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { createPublicClient, createWalletClient, defineChain, http, parseGwei, encodeFunctionData, erc20Abi, toHex } from "viem";
import { checkAccount, json } from "./keeper-core.mjs";

const { values } = parseArgs({ options: { keep: { type: "boolean", default: false }, "prepare-only": { type: "boolean", default: false } } });
const root = fileURLToPath(new URL("../", import.meta.url));
const port = 18549;
const rpc = `http://127.0.0.1:${port}`;
const upstream = process.env.MONAD_RPC_URL ?? "https://rpc.monad.xyz";
const pinnedBlock = 108749101n;
const pinnedHash = "0x7ce374183bf2649f316a1bb1312074e9c37965995ecb60cdc947ab236bc67150";
await mkdir(new URL("../.local/", import.meta.url), { recursive: true });

// Never attach to or stop a pre-existing process on this port.
await new Promise((resolve, reject) => {
  const reservation = createServer();
  reservation.once("error", () => reject(new Error(`Local demo port ${port} is occupied`)));
  reservation.listen(port, "127.0.0.1", () => reservation.close(resolve));
});
const upstreamClient = createPublicClient({ transport: http(upstream, { timeout: 20_000 }) });
if (await upstreamClient.getChainId() !== 143) throw new Error("Demo upstream must be Monad mainnet (read-only)");
const pinned = await upstreamClient.getBlock({ blockNumber: pinnedBlock });
if (pinned.hash !== pinnedHash) throw new Error("Pinned block hash differs from reviewed evidence");

const log = await open(new URL("../.local/anvil.log", import.meta.url), "w");
const anvil = spawn("anvil", ["--fork-url", upstream, "--fork-block-number", String(pinnedBlock),
  "--chain-id", "31337", "--host", "127.0.0.1", "--port", String(port), "--silent",
  "--gas-limit", "1000000000", "--timestamp", String(pinned.timestamp)], { cwd: root, stdio: ["ignore", log.fd, log.fd] });
let spawnError;
anvil.on("error", (error) => { spawnError = error; });
let stop;
const stopped = new Promise((resolve) => { stop = resolve; });
process.once("SIGINT", () => stop());
process.once("SIGTERM", () => stop());
const chain = defineChain({ id: 31337, name: "Setsuna local Monad fork", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
const client = createPublicClient({ chain, transport: http(rpc, { retryCount: 0, timeout: 15_000 }) });

async function command(binary, args, env = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd: `${root}/contracts`, env: { ...process.env, ...env }, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${binary} exited with ${code}`)));
  });
}
try {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (spawnError || anvil.exitCode !== null) throw new Error("Owned Anvil process did not start; see .local/anvil.log");
    try { ready = await client.getChainId() === 31337; } catch { /* booting */ }
    if (ready) break;
    await delay(250);
  }
  if (!ready) throw new Error("Local fork did not become ready");
  // Deterministic demo clock: each local block advances one second from the pinned state.
  await client.request({ method: "evm_setNextBlockTimestamp", params: [Number(pinned.timestamp) + 1] });
  await client.request({ method: "anvil_setBlockTimestampInterval", params: [1] });
  const [owner, keeper] = await client.request({ method: "eth_accounts" });
  const collateral = "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a";
  const trace = await client.request({ method: "debug_traceCall", params: [{ to: collateral,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [owner] }) }, "latest", { disableMemory: true, disableStorage: true }] });
  const reads = trace.structLogs.filter((step) => step.op === "SLOAD");
  if (reads.length !== 2) throw new Error("Unexpected AUSD balance read layout; no storage was changed");
  const slot = toHex(BigInt(`0x${reads.at(-1).stack.at(-1).replace(/^0x/, "")}`), { size: 32 });
  const previous = BigInt(await client.getStorageAt({ address: collateral, slot }) ?? "0x0");
  const synthetic = (10_000_000_000n << 8n) | (previous & 255n);
  await client.request({ method: "anvil_setStorageAt", params: [collateral, slot, toHex(synthetic, { size: 32 })] });
  if (await client.readContract({ address: collateral, abi: erc20Abi, functionName: "balanceOf", args: [owner] }) !== 10_000_000_000n) throw new Error("Synthetic local funding did not match expected AUSD layout");
  await command("forge", ["script", "script/LocalDemo.s.sol:LocalDemo", "--rpc-url", rpc,
    "--broadcast", "--unlocked", "--sender", owner, "--slow"], { DEMO_OWNER: owner });
  const manifestPath = new URL("../.local/demo.json", import.meta.url);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const abi = JSON.parse(await readFile(new URL("../contracts/abi/SetsunaAccount.json", import.meta.url), "utf8"));
  if (!await client.getCode({ address: manifest.account })) throw new Error("Account was not deployed locally");
  if ((await client.readContract({ address: manifest.account, abi, functionName: "owner" })).toLowerCase() !== owner.toLowerCase()) throw new Error("Unexpected demo account owner");
  Object.assign(manifest, { rpc, keeper, mode: "LOCAL_FORK_ONLY", syntheticFunding: true });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  const wallet = createWalletClient({ account: keeper, chain, transport: http(rpc) });
  const before = await checkAccount({ publicClient: client, address: manifest.account, abi, execute: false });
  if (before.quote.status !== 0) throw new Error(`Prepared demo is not ready: ${before.status}`);
  let rescue, after;
  if (!values["prepare-only"]) {
    rescue = await checkAccount({ publicClient: client, walletClient: wallet, address: manifest.account, abi, execute: true, maxGasPrice: parseGwei("200") });
    if (rescue.action !== "rescued") throw new Error(`Demo rescue did not execute: ${rescue.action}`);
    after = await checkAccount({ publicClient: client, address: manifest.account, abi, execute: false });
    if (after.quote.status !== 8) throw new Error(`Expected healthy position after rescue, got ${after.status}`);
  }
  const result = { ...manifest, before, rescue, after };
  await writeFile(new URL("../.local/demo-result.json", import.meta.url), json(result) + "\n");
  console.log(json({ mode: "LOCAL_FORK_ONLY", rpc, account: manifest.account,
    outcome: rescue?.action ?? "prepared", afterStatus: after?.status, manifest: ".local/demo.json" }));
  if (values.keep) {
    console.log("Local demo remains running. Ctrl+C stops this Anvil process. No public-chain transactions were sent.");
    await stopped;
  }
} finally {
  anvil.kill("SIGTERM");
  await log.close();
}
