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
  erc20Abi,
  http,
  parseEther,
  formatUnits,
} from "viem";

// Mutating browser proof, restricted to the owned synthetic local demo.
const url = "http://127.0.0.1:3007";
const deployment = await (await fetch(`${url}/api/deployment/`)).json();
assert.equal(deployment.mode, "local");
assert.equal(deployment.chainId, 31337);
assert.equal(deployment.rpc, "http://127.0.0.1:18607");
assert.ok(deployment.earnMON);
const { vault, gateway, asset } = deployment.earnMON;
const client = createPublicClient({ transport: http(deployment.rpc) });
assert.equal(await client.getChainId(), 31337);
const balance = () =>
  client.readContract({
    address: vault,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [deployment.owner],
  });
assert.equal(
  await balance(),
  0n,
  "Use an empty local demo account; leave an existing position untouched",
);
await mkdir(".local/setsmon/browser", { recursive: true });
const browser = await chromium.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto(`${url}/app/`);
  await page
    .getByRole("button", { name: "Connect account", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Try the local demo account/ })
    .click();
  const deposit = page.getByRole("button", {
    name: "Deposit MON",
    exact: true,
  });
  await page.getByLabel("Amount of MON", { exact: true }).fill("100");
  await page.waitForFunction(() =>
    [...document.querySelectorAll("button")].some(
      (b) => b.textContent === "Deposit MON" && !b.disabled,
    ),
  );
  await page.getByLabel("Amount of MON", { exact: true }).fill("-1");
  assert.equal(await deposit.isDisabled(), true);
  await page.getByLabel("Amount of MON", { exact: true }).fill("99999999");
  assert.equal(await deposit.isDisabled(), true);
  await page.getByLabel("Amount of MON", { exact: true }).fill("42.125");
  const before = await client.getBalance({ address: deployment.owner });
  await deposit.click();
  await page
    .getByRole("status")
    .filter({ hasText: "Deposit confirmed" })
    .waitFor({ timeout: 60_000 });
  const shares = await balance();
  assert.ok(shares > 0n);
  assert.ok(
    (await client.getBalance({ address: deployment.owner })) <
      before - parseEther("42.125"),
  );
  assert.equal(
    await client.readContract({
      address: asset,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [gateway],
    }),
    0n,
  );
  assert.equal(
    await client.readContract({
      address: asset,
      abi: erc20Abi,
      functionName: "allowance",
      args: [gateway, vault],
    }),
    0n,
  );
  await page.screenshot({
    path: ".local/setsmon/browser/deposited-desktop.png",
    fullPage: true,
  });
  await useAvailableEarnShares(page);
  assert.equal(
    await page
      .getByLabel("setsMON shares to withdraw", { exact: true })
      .inputValue(),
    formatUnits(shares, 24),
  );
  await page.getByRole("button", { name: "Withdraw MON", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Withdrawal confirmed" })
    .waitFor({ timeout: 60_000 });
  assert.equal(await balance(), 0n);
  assert.equal(
    await client.readContract({
      address: vault,
      abi: erc20Abi,
      functionName: "allowance",
      args: [deployment.owner, gateway],
    }),
    0n,
  );
  assert.equal(await client.getBalance({ address: gateway }), 0n);
  assert.equal(
    await client.readContract({
      address: asset,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [gateway],
    }),
    0n,
  );
  await page
    .getByText("Vault activity and public controls", { exact: true })
    .click();
  assert.ok(
    await page
      .locator(".s-mon-history")
      .getByText("Withdraw", { exact: true })
      .count(),
  );
  await page.screenshot({
    path: ".local/setsmon/browser/withdrawn-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.waitForTimeout(250);
  await page.screenshot({ path: ".local/setsmon/browser/mobile.png" });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "No page-level horizontal overflow",
  );
  await selectEarnAsset(page, "USDC");
  assert.ok(
    (await page.locator("main").innerText()).includes(
      "This vault is not available in this environment.",
    ),
  );
  await selectEarnAsset(page, "MON");
  await page.route("http://127.0.0.1:18607/**", (route) => route.abort());
  await page
    .getByRole("alert")
    .filter({ hasText: "Could not read the setsMON vault" })
    .waitFor({ timeout: 35_000 });
  assert.equal(
    await page
      .getByRole("button", { name: "Deposit MON", exact: true })
      .isDisabled(),
    true,
  );
  await openEarnWithdrawal(page);
  assert.equal(
    await page
      .getByRole("button", { name: "Withdraw MON", exact: true })
      .isDisabled(),
    true,
  );
  await page.unroute("http://127.0.0.1:18607/**");
  assert.deepEqual(errors, []);
  const report = {
    result: "passed",
    mode: "LOCAL_FORK_ONLY",
    syntheticFunding: true,
    url,
    vault,
    gateway,
    depositMON: "42.125",
    mintedShares: shares.toString(),
    finalShares: "0",
    runtimeErrors: errors,
    checks: [
      "local demo connection",
      "invalid and over-cap amounts blocked",
      "native MON deposit",
      "receipt shares verified onchain",
      "exact share approval and native withdrawal",
      "gateway balances and allowances cleared",
      "activity history",
      "mobile layout",
      "separate USDC status",
      "RPC outage disables transactions",
    ],
    checkedAt: new Date().toISOString(),
  };
  await writeFile(
    ".local/setsmon/browser/result.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
