import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "node:net";
import { chromium } from "playwright-core";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  http,
  parseEther,
  toHex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { checkTradingJourney } from "./check-trading-journey.mjs";

// Always creates a new local fork; never sends to or changes a user's running chain.
const rpcPort = 18620,
  appPort = 3020;
const rpc = `http://127.0.0.1:${rpcPort}`,
  base = `http://127.0.0.1:${appPort}`;
const keep = process.argv.includes("--keep-demo");
for (const port of [rpcPort, appPort])
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
const dir = `.local/order-types/${Date.now()}`;
await mkdir(dir, { recursive: true });
const log = await open(`${dir}/services.log`, "w", 0o600),
  children = [];
const env = {
  ...process.env,
  SETSUNA_DEMO_RPC_URL: rpc,
  SETSUNA_DEMO_ADMIN_RPC_URL: rpc,
  SETSUNA_TREASURY: "0x1111111111111111111111111111111111111111",
  SETSUNA_MAINNET_TRADING: "",
};
function start(cmd, args, childEnv = env) {
  const child = spawn(cmd, args, {
    env: childEnv,
    stdio: ["ignore", log.fd, log.fd],
    detached: keep,
  });
  children.push(child);
  return child;
}
const run = (args) =>
  new Promise((resolve, reject) => {
    const child = start(process.execPath, args);
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `Command failed (${code}): ${args[0]}; see ${dir}/services.log`,
            ),
          ),
    );
  });
let browser,
  page,
  passed = false;
try {
  start("anvil", [
    "--fork-url",
    process.env.MONAD_RPC_URL ?? "https://rpc.monad.xyz",
    "--fork-block-number",
    "110418863",
    "--chain-id",
    "31337",
    "--host",
    "127.0.0.1",
    "--port",
    String(rpcPort),
    "--gas-limit",
    "1000000000",
    "--prune-history",
    "128",
    "--silent",
  ]);
  const c = createPublicClient({
    transport: http(rpc, { retryCount: 0, timeout: 120_000 }),
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await c.getChainId()) === 31337) break;
    } catch {}
    await delay(500);
  }
  assert.equal(await c.getChainId(), 31337);
  await c.request({ method: "anvil_setBlockTimestampInterval", params: [1] });
  console.log(
    `Deploying new trading contracts on isolated local fork. Evidence: ${dir}`,
  );
  await run([
    "scripts/deploy-hosted-demo.mjs",
    "--output",
    `${dir}/deployment`,
    "--local-admin",
    "--execute",
  ]);
  const manifest = JSON.parse(
    await readFile(`${dir}/deployment/manifest.json`, "utf8"),
  );
  assert.ok(manifest.spotOrdersFactory);
  await writeFile(`${dir}/demo.json`, JSON.stringify(manifest, null, 2));
  start(process.execPath, [
    "scripts/demo-trading-watch.mjs",
    "--manifest",
    `${dir}/demo.json`,
    "--execute",
    "--watch",
    "--local-admin",
    "--journal",
    `${dir}/mark.json`,
  ]);
  start(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(appPort),
    ],
    {
      ...env,
      SETSUNA_DIST_DIR: ".next-order-types",
      SETSUNA_DEMO_MANIFEST: JSON.stringify(manifest),
    },
  );
  let d;
  for (let i = 0; i < 120; i++) {
    try {
      d = await (await fetch(`${base}/api/deployment/`)).json();
      if (d.mode === "demo") break;
    } catch {}
    await delay(500);
  }
  assert.equal(d?.mode, "demo");
  assert.ok(d.spot.ordersFactory);
  assert.equal(d.trading, undefined);
  const user = privateKeyToAccount(generatePrivateKey());
  const funded = await fetch(`${base}/api/demo/fund/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ address: user.address }),
  });
  assert.ok(funded.ok, await funded.text());
  // Kuru's minimum resting order is 200 MON on this historical market.
  await c.request({
    method: "anvil_setBalance",
    params: [user.address, toHex(parseEther("1000"))],
  });
  // Warm the fork's storage cache before the short public RPC deadline is used.
  // This is a simulation, with no wallet signature or state mutation.
  const spotABI = JSON.parse(await readFile("contracts/abi/SetsunaSpot.json"));
  await c.estimateGas({
    account: user.address,
    to: d.spot.gateway,
    value: parseEther("10"),
    data: encodeFunctionData({
      abi: spotABI,
      functionName: "sellMON",
      args: [1n, (await c.getBlock()).timestamp + 120n],
    }),
  });
  const chain = defineChain({
    id: 31337,
    name: "Order types local proof",
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [d.rpc] } },
  });
  const signed = createWalletClient({
    account: user,
    chain,
    transport: http(d.rpc),
  });
  browser = await chromium.launch({
    executablePath:
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [],
    txs = [],
    fault = { rejectNext: false };
  page.on("pageerror", (e) => errors.push(e.message));
  await page.exposeFunction(
    "walletRequest",
    async ({ method, params = [] }) => {
      if (["eth_accounts", "eth_requestAccounts"].includes(method))
        return [user.address];
      if (method === "eth_chainId") return "0x7a69";
      if (
        ["wallet_switchEthereumChain", "wallet_addEthereumChain"].includes(
          method,
        )
      )
        return null;
      if (method === "eth_sendTransaction") {
        if (fault.rejectNext) {
          fault.rejectNext = false;
          return { setsunaWalletRejected: true };
        }
        const tx = params[0];
        assert.equal(tx.from.toLowerCase(), user.address.toLowerCase());
        const hash = await signed.sendTransaction({
          to: tx.to,
          data: tx.data,
          value: BigInt(tx.value ?? "0x0"),
          ...(tx.gas ? { gas: BigInt(tx.gas) } : {}),
        });
        txs.push(hash);
        return hash;
      }
      const result = await (
        await fetch(d.rpc, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        })
      ).json();
      if (result.error) throw new Error(result.error.message);
      return result.result;
    },
  );
  await page.addInitScript(() => {
    window.ethereum = {
      request: async (args) => {
        const result = await window.walletRequest(args);
        if (result?.setsunaWalletRejected)
          throw Object.assign(new Error("User rejected the wallet request"), {
            code: 4001,
          });
        return result;
      },
      on() {},
      removeListener() {},
    };
  });
  await page.goto(`${base}/trade/?mode=spot`);
  await page
    .getByRole("button", { name: "Connect to swap", exact: true })
    .click();
  await page.getByRole("button", { name: /Browser wallet/ }).click();
  const trading = await checkTradingJourney({
    page,
    client: c,
    d,
    user,
    dir,
    txs,
    fault,
  });
  assert.deepEqual(errors, []);
  await writeFile(
    `${dir}/result.json`,
    JSON.stringify(
      {
        syntheticFunds: true,
        sourceBlock: "110418863",
        user: user.address,
        transactions: txs,
        trading,
      },
      null,
      2,
    ),
  );
  passed = true;
  console.log(`PASS: market and limit browser journey. ${dir}/result.json`);
  if (keep)
    await writeFile(
      ".local/order-types/latest.json",
      JSON.stringify(
        {
          dir,
          app: `${base}/trade/`,
          rpc,
          services: children
            .filter((c) => c.exitCode === null)
            .map((c) => c.pid),
        },
        null,
        2,
      ),
    );
} catch (e) {
  if (page) {
    await page
      .screenshot({ path: `${dir}/failure.png`, fullPage: true })
      .catch(() => {});
    await writeFile(
      `${dir}/failure.txt`,
      await page.locator("body").innerText(),
    ).catch(() => {});
  }
  throw e;
} finally {
  await browser?.close();
  for (const child of children.reverse())
    if (child.exitCode === null) {
      if (keep && passed) child.unref();
      else child.kill("SIGTERM");
    }
  await log.close();
}
