import {
  selectEarnAsset,
  useAvailableEarnShares,
  openEarnWithdrawal,
} from "./earn-ui.mjs";
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { createPublicClient, http, erc20Abi, parseUnits } from "viem";
const withCurvance = process.argv.includes("--curvance");
const url = withCurvance ? "http://127.0.0.1:3015" : "http://127.0.0.1:3014";
const dir = withCurvance ? ".local/setsusdc-five" : ".local/setsusdc";
const d = await (await fetch(`${url}/api/deployment/`)).json();
assert.equal(d.mode, "local");
assert.equal(d.chainId, 31337);
assert.equal(
  d.rpc,
  withCurvance ? "http://127.0.0.1:18613" : "http://127.0.0.1:18612",
);
assert.equal(d.earnUSDC.adapters.length, withCurvance ? 5 : 4);
const m = d.earnUSDC,
  c = createPublicClient({ transport: http(d.rpc) });
assert.equal(await c.getChainId(), 31337);
const abi = JSON.parse(
  await readFile("contracts/abi/SetsunaUSDCVault.json", "utf8"),
);
const shares = () =>
  c.readContract({
    address: m.vault,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [d.owner],
  });
assert.equal(await shares(), 0n, "Start with an empty test position");
const eventsBefore = await c.getBlockNumber({ cacheTime: 0 });
const services = JSON.parse(await readFile(`${dir}/services.json`, "utf8"));
// Freeze only the worker owned by this demo while exercising the same public controls in the UI.
process.kill(services.keeper, "SIGSTOP");
await mkdir(`${dir}/browser`, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1512, height: 1100 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(`${url}/app/`, { waitUntil: "networkidle" });
  await selectEarnAsset(page, "USDC");
  await page
    .getByRole("button", { name: "Connect account", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: /Try the local demo account/ })
    .click();
  const deposit = page.getByRole("button", {
    name: "Deposit USDC",
    exact: true,
  });
  await page.getByLabel("Amount of USDC", { exact: true }).fill("100");
  await page.waitForFunction(() =>
    [...document.querySelectorAll("button")].some(
      (b) => b.textContent === "Deposit USDC" && !b.disabled,
    ),
  );
  const rows = page.locator(".s-rates-card tbody tr");
  assert.equal(await rows.count(), m.adapters.length + 1);
  if (withCurvance) {
    const row = rows.filter({ hasText: "Curvance · wsrUSD / USDC" });
    assert.equal(await row.count(), 1);
    assert.match(await row.innerText(), /Eligible/);
    const ca = JSON.parse(
      await readFile("contracts/abi/CurvanceUSDCAdapter.json", "utf8"),
    );
    assert(
      (await c.readContract({
        address: m.adapters[4],
        abi: ca,
        functionName: "totalAssets",
      })) > 0n,
    );
  }
  await page.getByLabel("Amount of USDC", { exact: true }).fill("-1");
  assert(await deposit.isDisabled());
  await page.getByLabel("Amount of USDC", { exact: true }).fill("10000000");
  assert(await deposit.isDisabled());
  await page.getByLabel("Amount of USDC", { exact: true }).fill("100.25");
  await deposit.click();
  await page
    .getByRole("status")
    .filter({ hasText: "Deposit confirmed" })
    .waitFor({ timeout: 60000 });
  assert((await shares()) > 0n);
  assert.equal(
    await c.readContract({
      address: m.asset,
      abi: erc20Abi,
      functionName: "allowance",
      args: [d.owner, m.vault],
    }),
    0n,
  );
  await page.screenshot({
    path: `${dir}/browser/deposited.png`,
    fullPage: true,
  });
  console.log("Deposit and exact approval verified");
  await page
    .getByText("Vault activity and public controls", { exact: true })
    .click();
  const block = await c.getBlock();
  await c.request({
    method: "evm_setNextBlockTimestamp",
    params: [Number(block.timestamp) + 601],
  });
  await c.request({ method: "evm_mine", params: [] });
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("button")].some(
        (b) => b.textContent === "Record protocol rates" && !b.disabled,
      ),
    {},
    { timeout: 25000 },
  );
  await page
    .getByRole("button", { name: "Record protocol rates", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Protocol rates recorded" })
    .waitFor({ timeout: 60000 });
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("button")].some(
        (b) => b.textContent === "Rebalance vault" && !b.disabled,
      ),
    {},
    { timeout: 25000 },
  );
  await page
    .getByRole("button", { name: "Rebalance vault", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Rebalance confirmed" })
    .waitFor({ timeout: 60000 });
  console.log("Permissionless rebalance verified");
  await openEarnWithdrawal(page);
  await page
    .getByLabel("setsUSDC shares to withdraw", { exact: true })
    .fill("40");
  await page
    .getByRole("button", { name: "Withdraw USDC", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Withdrawal confirmed" })
    .waitFor({ timeout: 60000 });
  assert((await shares()) > 0n);
  await useAvailableEarnShares(page);
  await page
    .getByRole("button", { name: "Withdraw USDC", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Withdrawal confirmed" })
    .waitFor({ timeout: 60000 });
  assert.equal(await shares(), 0n);
  console.log("Partial withdrawal and full redemption verified");
  await page.reload({ waitUntil: "networkidle" });
  await selectEarnAsset(page, "USDC");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: `${dir}/browser/mobile.png`,
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  const events = await c.getContractEvents({
    address: m.vault,
    abi,
    fromBlock: eventsBefore,
  });
  const proof = {
    checkedAt: new Date().toISOString(),
    sourceBlock: m.forkBlock,
    vault: m.vault,
    checks: [
      `${m.adapters.length} destinations visible and Curvance funded when configured`,
      "invalid and excess input blocked",
      "exact approval consumed",
      "deposit mints shares",
      "public rate observation",
      "public rebalance",
      "partial redemption",
      "full redemption",
      "reload",
      "mobile width",
    ],
    events: events.map((e) => ({
      event: e.eventName,
      hash: e.transactionHash,
      block: String(e.blockNumber),
    })),
    errors,
  };
  await writeFile(`${dir}/browser/proof.json`, JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof, null, 2));
} finally {
  await browser.close();
  process.kill(services.keeper, "SIGCONT");
}
