import {
  selectEarnAsset,
  useAvailableEarnShares,
  openEarnWithdrawal,
} from "./earn-ui.mjs";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  erc20Abi,
  http,
  parseEther,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { checkTradingJourney } from "./check-trading-journey.mjs";

// Public synthetic-fund acceptance. No admin RPC, clock changes or fixture mutation.
const base = new URL(process.argv[2]).origin;
assert.equal(new URL(base).protocol, "https:");
const dir = `.local/public-demo/${Date.now()}`;
await mkdir(dir, { recursive: true });
const d = await (await fetch(`${base}/api/deployment/`)).json();
assert.equal(d.mode, "demo");
assert.equal(d.chainId, 31337);
assert.equal(d.rpc, `${base}/api/rpc/`);
assert.ok(d.faucet && d.earnMON && d.earnUSDC && d.spot && d.factory);
assert.equal(d.owner, undefined);
assert.equal(d.earnUSDC.adapters.length, 5);
const c = createPublicClient({
  transport: http(d.rpc, { timeout: 30000, retryCount: 0 }),
});
assert.equal(await c.getChainId(), 31337);
const user = privateKeyToAccount(generatePrivateKey());
const chain = defineChain({
  id: 31337,
  name: "Setsuna demo · test funds",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [d.rpc] } },
});
const signed = createWalletClient({
  account: user,
  chain,
  transport: http(d.rpc, { timeout: 30000, retryCount: 0 }),
});
const txs = [],
  checks = [],
  errors = [],
  fault = { rejectNext: false };
const post = (body, origin = base) =>
  fetch(`${base}/api/demo/fund/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
  });
for (const method of [
  "eth_sendTransaction",
  "anvil_setBalance",
  "anvil_reset",
  "eth_accounts",
])
  assert.equal(
    (
      await fetch(d.rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }),
      })
    ).status,
    403,
  );
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
checks.push(
  "Public deployment validates all integrations and publishes only same-origin RPC",
  "Admin RPC methods blocked",
  "Faucet rejects cross-origin, invalid recipient and arbitrary amounts",
);
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(60000);
page.on("pageerror", (e) => errors.push(e.message));
const click = (name) => page.getByRole("button", { name, exact: true }).click();
const status = (text) =>
  page
    .getByRole("status")
    .filter({ hasText: text })
    .waitFor({ timeout: 90000 });
const balance = (address) =>
  c.readContract({
    address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [user.address],
  });
const allowance = (address, spender) =>
  c.readContract({
    address,
    abi: erc20Abi,
    functionName: "allowance",
    args: [user.address, spender],
  });
let fundingHash;
try {
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
  page.on("response", async (r) => {
    if (
      r.url().endsWith("/api/demo/fund/") &&
      r.request().method() === "POST"
    ) {
      try {
        fundingHash = (await r.json()).hash;
      } catch {}
    }
  });
  await page.goto(`${base}/app/?tab=spot`);
  await page
    .getByRole("button", { name: "Connect to swap", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: /Browser wallet/ }).click();
  await click("Get test funds");
  await status("Test funds received");
  assert.equal(
    await c.getBalance({ address: user.address }),
    parseEther("101"),
  );
  for (const token of [d.spot.usdc, d.collateral])
    assert.equal(await balance(token), 1_000_000_000n);
  assert.equal((await post({ address: user.address })).status, 409);
  checks.push("Fresh wallet funded through public UI; second claim blocked");
  console.log("Public funding passed. Running Spot and Perps…");
  const trading = await checkTradingJourney({
    page,
    client: c,
    d,
    user,
    dir,
    txs,
    fault,
  });
  checks.push(...trading.checks);
  await writeFile(
    `${dir}/trading-result.json`,
    JSON.stringify(trading, null, 2),
  );
  await page.getByLabel("Amount of MON", { exact: true }).fill("10");
  await click("Deposit MON");
  await status("Deposit confirmed");
  assert.ok((await balance(d.earnMON.vault)) > 0n);
  await page.screenshot({ path: `${dir}/mon-deposited.png`, fullPage: true });
  await useAvailableEarnShares(page);
  await click("Withdraw MON");
  await status("Withdrawal confirmed");
  assert.equal(await balance(d.earnMON.vault), 0n);
  assert.equal(await allowance(d.earnMON.vault, d.earnMON.gateway), 0n);
  checks.push(
    "MON deposit, shares and full native withdrawal; zero residual gateway approval",
  );
  console.log("Public MON round trip passed. Running USDC…");
  await selectEarnAsset(page, "USDC");
  const before = await balance(d.spot.usdc);
  await page.getByLabel("Amount of USDC", { exact: true }).fill("100.25");
  await click("Deposit USDC");
  await status("Deposit confirmed");
  assert.equal(await balance(d.spot.usdc), before - 100_250_000n);
  assert.ok((await balance(d.earnUSDC.vault)) > 0n);
  assert.equal(await allowance(d.spot.usdc, d.earnUSDC.vault), 0n);
  assert.equal(await page.locator(".s-rates-card tbody tr").count(), 6);
  await page.screenshot({ path: `${dir}/usdc-deposited.png`, fullPage: true });
  await openEarnWithdrawal(page);
  await page
    .getByLabel("setsUSDC shares to withdraw", { exact: true })
    .fill("40");
  await click("Withdraw USDC");
  await status("Withdrawal confirmed");
  assert.ok((await balance(d.earnUSDC.vault)) > 0n);
  await useAvailableEarnShares(page);
  await click("Withdraw USDC");
  await status("Withdrawal confirmed");
  assert.equal(await balance(d.earnUSDC.vault), 0n);
  assert.ok((await balance(d.spot.usdc)) >= before - 10n);
  checks.push(
    "USDC exact deposit/approval, five protocol rows, partial and full redemption",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await page.screenshot({ path: `${dir}/usdc-mobile.png`, fullPage: true });
  await page.route("**/api/rpc/", (r) =>
    r.fulfill({
      status: 503,
      body: '{"error":"test outage"}',
      contentType: "application/json",
    }),
  );
  const alert = page
    .getByRole("alert")
    .filter({ hasText: "Could not read the setsUSDC vault" });
  await alert.waitFor({ timeout: 30000 });
  assert.ok(
    await page
      .getByRole("button", { name: "Deposit USDC", exact: true })
      .isDisabled(),
  );
  await page.unroute("**/api/rpc/");
  await alert.waitFor({ state: "hidden", timeout: 30000 });
  checks.push(
    "USDC mobile layout, disabled writes during RPC failure and recovery",
  );
  for (const hash of txs)
    assert.equal((await c.getTransactionReceipt({ hash })).status, "success");
  assert.equal((await fetch(`${d.explorer}/tx/${txs.at(-1)}`)).status, 200);
  checks.push(
    "Every signed transaction has a successful public receipt; explorer accessible",
  );
  assert.deepEqual(errors, []);
  const result = {
    checkedAt: new Date().toISOString(),
    status: "passed",
    url: base,
    wallet: user.address,
    deployment: d,
    fundingHash,
    transactions: txs,
    checks,
    controlledTimeAdvancement: false,
    walletMethod:
      "Injected EIP-1193 test wallet with actual signed transactions; not a browser-extension/device test",
    errors,
  };
  await writeFile(`${dir}/result.json`, JSON.stringify(result, null, 2) + "\n");
  await writeFile(
    ".local/public-demo/latest.json",
    JSON.stringify({ dir }) + "\n",
  );
  console.log(
    JSON.stringify({
      status: "passed",
      dir,
      transactions: txs.length,
      checks: checks.length,
    }),
  );
} catch (error) {
  await page
    .screenshot({ path: `${dir}/failure.png`, fullPage: true })
    .catch(() => {});
  await writeFile(
    `${dir}/failure.json`,
    JSON.stringify(
      {
        status: "failed",
        url: base,
        wallet: user.address,
        fundingHash,
        transactions: txs,
        checks,
        errors,
        error: String(error),
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser.close();
}
