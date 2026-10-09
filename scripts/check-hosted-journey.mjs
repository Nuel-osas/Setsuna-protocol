import { selectEarnAsset, useAvailableEarnShares } from "./earn-ui.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  erc20Abi,
  http,
  parseEther,
  toHex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { keeperNetwork } from "./earn-keeper-network.mjs";
import { checkTradingJourney } from "./check-trading-journey.mjs";
import { checkUSDCJourney } from "./check-usdc-journey.mjs";
import { demoForkProfiles } from "./demo-fork-profiles.mjs";

// Clone the existing synthetic-fund fork. Never snapshot, revert or change the user's running demo.
const unified = process.argv.includes("--unified");
const profile = demoForkProfiles[unified ? "unified" : "trading"];
const source = unified
  ? { rpc: process.env.MONAD_RPC_URL ?? "https://rpc-mainnet.monadinfra.com" }
  : JSON.parse(await readFile(".local/trading/demo.json", "utf8"));
if (!unified) {
  assert.equal(source.mode, "LOCAL_FORK_ONLY");
  assert.equal(source.chainId, 31337);
  assert.equal(source.rpc, "http://127.0.0.1:18608");
}
const sourceClient = createPublicClient({ transport: http(source.rpc) });
assert.equal(await sourceClient.getChainId(), unified ? 143 : 31337);
const sourceBlock = await sourceClient.getBlock(
  unified ? { blockNumber: profile.block } : {},
);
if (unified) assert.equal(sourceBlock.hash, profile.hash);
const rpcPort = unified ? 18614 : 18610,
  appPort = unified ? 3016 : 3011;
const rpc = `http://127.0.0.1:${rpcPort}`,
  base = `http://127.0.0.1:${appPort}`;
for (const port of [rpcPort, appPort])
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
const dir = `.local/${unified ? "unified-demo" : "hosted-readiness"}/${Date.now()}`;
const keepDemo = process.argv.includes("--keep-demo");
let passed = false;
await mkdir(dir, { recursive: true });
const log = await open(`${dir}/services.log`, "w", 0o600);
const children = [];
const owned = (cmd, args, env = process.env) => {
  const child = spawn(cmd, args, {
    env,
    detached: keepDemo,
    stdio: ["ignore", log.fd, log.fd],
  });
  children.push(child);
  return child;
};
const run = (args, env = process.env, expectedCode = 0) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (x) => (stdout += x));
    child.stderr.on("data", (x) => (stderr += x));
    child.once("error", reject);
    child.once("exit", (code) =>
      code === expectedCode
        ? resolve(stdout)
        : reject(new Error(`Child exited ${code}: ${stderr}`)),
    );
  });
let browser, page;
try {
  owned("anvil", [
    "--fork-url",
    source.rpc,
    "--fork-block-number",
    String(sourceBlock.number),
    "--chain-id",
    "31337",
    "--host",
    "127.0.0.1",
    "--port",
    String(rpcPort),
    "--gas-limit",
    "1000000000",
    "--timestamp",
    String(sourceBlock.timestamp),
    "--silent",
  ]);
  const c = createPublicClient({ transport: http(rpc, { retryCount: 0 }) });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await c.getChainId()) === 31337) break;
    } catch {}
    await delay(500);
  }
  assert.equal(await c.getChainId(), 31337);
  await c.request({ method: "anvil_setBlockTimestampInterval", params: [1] });
  const m = { ...source, mode: "HOSTED_FORK_ONLY", rpc };
  await writeFile(`${dir}/base.json`, JSON.stringify(m));
  const env = {
    ...process.env,
    SETSUNA_DEMO_RPC_URL: rpc,
    SETSUNA_DEMO_ADMIN_RPC_URL: rpc,
  };
  console.log("Deploying and seeding the bounded faucet on an isolated clone…");
  await run(
    [
      "scripts/deploy-hosted-demo.mjs",
      "--output",
      `${dir}/deployment`,
      "--local-admin",
      "--execute",
      ...(unified ? ["--unified"] : []),
    ],
    env,
  );
  const funded = JSON.parse(
    await readFile(`${dir}/deployment/manifest.json`, "utf8"),
  );
  assert.equal(funded.perplFixture?.mode, "FIXED_HISTORICAL_MARK");
  await writeFile(`${dir}/demo.json`, JSON.stringify(funded));
  assert.ok(funded.faucet);
  owned(
    process.execPath,
    [
      "scripts/demo-trading-watch.mjs",
      "--manifest",
      `${dir}/demo.json`,
      "--execute",
      "--watch",
      "--local-admin",
      "--journal",
      `${dir}/price-worker.json`,
    ],
    env,
  );
  owned(
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
      SETSUNA_DIST_DIR: unified ? ".next-unified-demo" : ".next-hosted-journey",
      SETSUNA_DEMO_MANIFEST: JSON.stringify(funded),
    },
  );
  let d;
  for (let i = 0; i < 80; i++) {
    try {
      d = await (await fetch(`${base}/api/deployment/`)).json();
      if (d.mode === "demo") break;
    } catch {}
    await delay(500);
  }
  assert.equal(d?.mode, "demo");
  assert.ok(d.faucet);
  assert.equal(d.owner, undefined);
  assert.equal(
    JSON.stringify(d).includes(`:${rpcPort}`),
    false,
    "Private RPC is never published",
  );
  const post = (body, origin = base) =>
    fetch(`${base}/api/demo/fund/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify(body),
    });
  const user = privateKeyToAccount(generatePrivateKey());
  assert.equal(await c.getBalance({ address: user.address }), 0n);
  assert.equal(
    (await post({ address: user.address }, "https://elsewhere.example")).status,
    403,
  );
  assert.equal(
    (await post({ address: user.address, amount: "999999" })).status,
    400,
  );
  assert.equal(
    (await post({ address: "0x0000000000000000000000000000000000000000" }))
      .status,
    400,
  );
  for (const method of [
    "eth_sendTransaction",
    "tenderly_setBalance",
    "anvil_setBalance",
    "eth_accounts",
  ])
    assert.equal(
      (
        await fetch(`${base}/api/rpc/`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }),
        })
      ).status,
      403,
    );
  const network = await keeperNetwork({
    rpc,
    manifest: funded,
    address: funded.vault,
    assetSymbol: "MON",
  });
  assert.equal(network.chainId, 31337);
  for (const patch of [
    { manifest: undefined },
    { manifest: { ...funded, chainId: 143 } },
    { assetSymbol: "USDC" },
    { address: user.address },
    { manifest: { ...funded, forkHash: "0x" + "00".repeat(32) } },
  ])
    await assert.rejects(() =>
      keeperNetwork({
        rpc,
        manifest: funded,
        address: funded.vault,
        assetSymbol: "MON",
        ...patch,
      }),
    );
  console.log(
    "Private RPC restrictions, funding input guards and executor network guards passed. Testing a fresh browser wallet…",
  );
  const chain = defineChain({
    id: 31337,
    name: "Hosted-path test",
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
  page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const txs = [];
  const fault = { rejectNext: false };
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
      const response = await fetch(d.rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      const result = await response.json();
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
  await page.goto(`${base}/app/?tab=spot`);
  await page
    .getByRole("button", { name: "Connect to swap", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: /Browser wallet/ }).click();
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("button")].some(
        (b) => b.textContent === "Get test funds" && !b.disabled,
      ),
    { timeout: 60000 },
  );
  await page
    .getByRole("button", { name: "Get test funds", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Test funds received" })
    .waitFor({ timeout: 60000 });
  assert.equal(
    await c.getBalance({ address: user.address }),
    parseEther("101"),
  );
  for (const token of [d.spot.usdc, d.collateral])
    assert.equal(
      await c.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [user.address],
      }),
      1_000_000_000n,
    );
  assert.equal((await post({ address: user.address })).status, 409);
  const trading = await checkTradingJourney({
    page,
    client: c,
    d,
    user,
    dir,
    txs,
    fault,
  });
  await writeFile(
    `${dir}/trading-result.json`,
    JSON.stringify(trading, null, 2),
  );
  await page.getByLabel("Amount of MON", { exact: true }).fill("100");
  await page.getByRole("button", { name: "Deposit MON", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Deposit confirmed" })
    .waitFor({ timeout: 60000 });
  const shares = await c.readContract({
    address: d.earnMON.vault,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [user.address],
  });
  assert.ok(shares > 0n);
  console.log(
    "Fresh wallet claimed synthetic assets and deposited 100 MON through the restricted RPC. Testing the signed executor…",
  );
  const key = generatePrivateKey(),
    keeper = privateKeyToAccount(key);
  await c.request({
    method: "anvil_setBalance",
    params: [keeper.address, toHex(parseEther("10"))],
  });
  const args = [
    "scripts/earn-keeper.mjs",
    "--demo-manifest",
    `${dir}/demo.json`,
    "--asset",
    "MON",
    "--rpc",
    rpc,
    "--vault",
    funded.vault,
    "--execute",
    "--max-gas-price-gwei",
    "200",
    "--max-gas",
    "1500000",
    "--state-dir",
    `${dir}/executor`,
  ];
  const reports = [];
  for (let i = 0; i < 5; i++) {
    const b = await c.getBlock();
    await c.request({
      method: "evm_setNextBlockTimestamp",
      params: [Number(b.timestamp) + 601],
    });
    await c.request({ method: "evm_mine", params: [] });
    const report = JSON.parse(
      await run(args, { ...process.env, EARN_KEEPER_PRIVATE_KEY: key }),
    );
    reports.push(report);
    await writeFile(
      `${dir}/executor-reports.json`,
      JSON.stringify(reports, null, 2),
    );
    if (
      report.result?.operation === "rebalance" &&
      report.result?.action === "confirmed"
    )
      break;
  }
  assert.ok(
    reports.some(
      (r) =>
        r.result?.operation === "rebalance" && r.result?.action === "confirmed",
    ),
    "At least one actual signed rebalance must settle",
  );
  // Restart reconciliation: reconstruct the just-mined pending record and confirm it without another broadcast.
  const statePath = `${dir}/executor/31337-${keeper.address.toLowerCase()}.json`;
  const latest = reports.at(-1).result;
  const settled = await c.getTransaction({ hash: latest.hash });
  await writeFile(
    statePath,
    JSON.stringify({
      pending: {
        hash: latest.hash,
        nonce: settled.nonce,
        signer: keeper.address,
        chainId: 31337,
        vault: funded.vault,
        action: latest.operation,
      },
    }),
  );
  const nonceBefore = await c.getTransactionCount({ address: keeper.address });
  const recovered = JSON.parse(
    await run(args, { ...process.env, EARN_KEEPER_PRIVATE_KEY: key }),
  );
  assert.equal(recovered.reconciled.action, "confirmed");
  assert.equal(
    await c.getTransactionCount({ address: keeper.address }),
    nonceBefore,
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `${dir}/deposited-desktop.png`,
    fullPage: true,
  });
  await useAvailableEarnShares(page);
  await page.getByRole("button", { name: "Withdraw MON", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Withdrawal confirmed" })
    .waitFor({ timeout: 60000 });
  assert.equal(
    await c.readContract({
      address: d.earnMON.vault,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [user.address],
    }),
    0n,
  );
  assert.equal(
    await c.readContract({
      address: d.earnMON.vault,
      abi: erc20Abi,
      functionName: "allowance",
      args: [user.address, d.earnMON.gateway],
    }),
    0n,
  );
  assert.ok(
    (await c.getBalance({ address: user.address })) > parseEther("100"),
  );
  const usdc = unified
    ? await checkUSDCJourney({ page, client: c, d, user, dir, run, rpc })
    : undefined;
  if (unified) {
    await selectEarnAsset(page, "MON");
    await page.getByLabel("Amount of MON", { exact: true }).waitFor();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `${dir}/withdrawn-mobile.png`,
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await page.route("**/api/rpc/", (route) =>
    route.fulfill({
      status: 503,
      body: '{"error":"test outage"}',
      contentType: "application/json",
    }),
  );
  await page
    .getByRole("alert")
    .filter({ hasText: "Could not read" })
    .waitFor({ timeout: 25000 });
  await page
    .getByRole("group", { name: "Earn action" })
    .getByRole("button", { name: "Deposit", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("button", { name: "Deposit MON", exact: true })
      .isDisabled(),
    true,
  );
  assert.deepEqual(errors, []);
  await writeFile(
    `${dir}/result.json`,
    JSON.stringify(
      {
        author: "Codex",
        mode: "isolated-local-hosted-path-proof",
        tenderlyDeployed: false,
        syntheticFunds: true,
        user: user.address,
        faucet: funded.faucet,
        contracts: d,
        transactionHashes: txs,
        executor: reports,
        trading,
        ...(usdc ? { usdc } : {}),
        recovered,
        checks: [
          "empty-wallet-funding",
          "all-assets-received",
          "repeat-claim-blocked",
          "admin-RPC-blocked",
          "invalid-input-blocked",
          "executor-network-guards",
          "MON-deposit-shares-withdrawal",
          "signed-rebalance",
          "restart-reconciliation-no-duplicate",
          "mobile-no-overflow",
          "RPC-failure-disables-writes",
        ],
      },
      null,
      2,
    ) + "\n",
  );
  passed = true;
  if (keepDemo) {
    owned(process.execPath, [
      `--env-file=${dir}/deployment/keeper.env`,
      "scripts/earn-keeper-watch.mjs",
      "--demo-manifest",
      `${dir}/demo.json`,
      "--asset",
      "MON",
      "--rpc",
      rpc,
      "--vault",
      funded.vault,
      "--execute",
      "--max-gas-price-gwei",
      "200",
      "--max-gas",
      "1500000",
      "--state-dir",
      `${dir}/live-executor`,
    ]);
    if (unified)
      owned(process.execPath, [
        `--env-file=${dir}/deployment/usdc-keeper.env`,
        "scripts/earn-keeper-watch.mjs",
        "--demo-manifest",
        `${dir}/demo.json`,
        "--asset",
        "USDC",
        "--multi",
        "--rpc",
        rpc,
        "--vault",
        funded.earnUSDC.vault,
        "--execute",
        "--max-gas-price-gwei",
        "200",
        "--max-gas",
        "3500000",
        "--state-dir",
        `${dir}/live-usdc-executor`,
      ]);
    await writeFile(
      `${dir}/services.json`,
      JSON.stringify(
        {
          app: `${base}/app/`,
          rpc,
          services: children
            .filter((child) => child.exitCode === null)
            .map((child) => ({ pid: child.pid, command: child.spawnargs[0] })),
        },
        null,
        2,
      ),
    );
    if (unified)
      await writeFile(
        ".local/unified-demo/latest.json",
        JSON.stringify({ dir, app: `${base}/app/`, rpc }, null, 2),
      );
  }
  console.log(
    `PASS: hosted configuration path, fresh-wallet funding, deposit, signed rebalance, restart reconciliation, withdrawal and mobile/RPC failure checks. Evidence: ${dir}/result.json. This is local proof, not a Tenderly deployment.`,
  );
} catch (error) {
  if (page) {
    await page
      .screenshot({ path: `${dir}/failure.png`, fullPage: true })
      .catch(() => {});
    await writeFile(
      `${dir}/failure.txt`,
      await page.locator("body").innerText(),
    ).catch(() => {});
  }
  throw error;
} finally {
  await browser?.close();
  for (const child of children.reverse()) {
    if (child.exitCode === null) {
      if (passed && keepDemo) child.unref();
      else child.kill("SIGTERM");
    }
  }
  await log.close();
}
