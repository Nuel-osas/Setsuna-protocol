import { useAvailableEarnShares } from "./earn-ui.mjs";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import {
  createPublicClient,
  http,
  erc20Abi,
  parseAbi,
  zeroAddress,
} from "viem";

const url = "http://127.0.0.1:3008";
const d = await (await fetch(`${url}/api/deployment/`)).json();
assert.equal(d.mode, "local");
assert.equal(d.chainId, 31337);
assert.equal(d.rpc, "http://127.0.0.1:18608");
assert.ok(d.spot && d.factory && d.earnMON);
const c = createPublicClient({ transport: http(d.rpc) });
assert.equal(await c.getChainId(), 31337);
const accountABI = JSON.parse(
  await readFile("contracts/abi/SetsunaAccount.json"),
);
const exchangeABI = JSON.parse(
  await readFile("contracts/abi/IPerplExchange.json"),
);
const factoryABI = parseAbi([
  "function accountOf(address) view returns(address)",
]);
const accountOf = () =>
  c.readContract({
    address: d.factory,
    abi: factoryABI,
    functionName: "accountOf",
    args: [d.owner],
  });
const tokens = (token, owner = d.owner) =>
  c.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [owner],
  });
const read = async (functionName, args = []) =>
  c.readContract({
    address: await accountOf(),
    abi: accountABI,
    functionName,
    args,
  });
const position = async () =>
  (
    await c.readContract({
      address: d.exchange,
      abi: exchangeABI,
      functionName: "getPositionV2",
      args: [1n, await read("accountId")],
    })
  )[0];
await mkdir(".local/trading/browser", { recursive: true });
const browser = await chromium.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1050 },
  reducedMotion: "reduce",
});
const errors = [],
  checks = [];
page.on("pageerror", (e) => errors.push(e.message));
const click = (name) => page.getByRole("button", { name, exact: true }).click();
async function enabled(name) {
  await page.waitForFunction(
    (label) =>
      [...document.querySelectorAll("button")].some(
        (b) => b.textContent.trim() === label && !b.disabled,
      ),
    name,
  );
}
async function status(text) {
  await page
    .getByRole("status")
    .filter({ hasText: text })
    .waitFor({ timeout: 60_000 });
}
async function confirm(text) {
  await click("Confirm");
  await status(text);
}
async function connect() {
  await click("Connect to swap");
  await page
    .getByRole("button", { name: /Try the local demo account/ })
    .click();
}
try {
  await page.goto(`${url}/app/?tab=spot`);
  await connect();
  await enabled("Get quote");
  await page.getByLabel("Spot amount", { exact: true }).fill("-1");
  assert.ok(
    await page
      .getByRole("button", { name: "Get quote", exact: true })
      .isDisabled(),
  );
  await page.getByLabel("Spot amount", { exact: true }).fill("100.00000000001");
  assert.ok(
    await page
      .getByRole("button", { name: "Get quote", exact: true })
      .isDisabled(),
  );
  await page.getByLabel("Spot amount", { exact: true }).fill("100");
  const usdcBefore = await tokens(d.spot.usdc);
  await click("Get quote");
  await enabled("Swap MON for USDC");
  await click("Swap MON for USDC");
  await status("Swap confirmed");
  const gained = (await tokens(d.spot.usdc)) - usdcBefore;
  assert.ok(gained > 3_000_000n);
  checks.push("native MON to USDC receipt and wallet balance");
  await page.screenshot({
    path: ".local/trading/browser/spot-desktop.png",
    fullPage: true,
  });
  await click("Buy MON");
  const monBefore = await c.getBalance({ address: d.owner });
  await click("Get quote");
  await enabled("Swap USDC for MON");
  await click("Swap USDC for MON");
  await status("Swap confirmed");
  assert.equal(await tokens(d.spot.usdc), usdcBefore + gained - 1_000_000n);
  assert.ok((await c.getBalance({ address: d.owner })) > monBefore);
  assert.equal(await tokens(d.spot.usdc, d.spot.gateway), 0n);
  assert.equal(await c.getBalance({ address: d.spot.gateway }), 0n);
  assert.equal(
    await c.readContract({
      address: d.spot.usdc,
      abi: erc20Abi,
      functionName: "allowance",
      args: [d.owner, d.spot.gateway],
    }),
    0n,
  );
  checks.push(
    "USDC approval and MON return swap",
    "gateway balances and allowances cleared",
    "invalid and precision-dust inputs blocked",
  );

  await click("Perps");
  assert.ok(
    (await page.locator("main").innerText()).includes(
      "oracle guard is disabled only on this fork",
    ),
  );
  if ((await accountOf()) === zeroAddress) {
    await enabled("Create account");
    await click("Create account");
    await confirm("Account created");
  }
  if ((await read("accountId")) === 0n) {
    await page
      .locator("summary")
      .filter({ hasText: "Trading balance" })
      .click();
    await page.getByLabel("Opening deposit", { exact: true }).fill("100");
    await click("Open trading account");
    await confirm("Trading balance updated");
  }
  assert.equal(
    (await position()).lotLNS,
    0n,
    "Do not alter a pre-existing open demo position",
  );
  await page.getByLabel("Add", { exact: true }).fill("50");
  await click("Fund reserve");
  await confirm("Reserve funded");
  const reserve = await read("reserveCNS");
  await enabled("Review order");
  await click("Review order");
  await confirm("Order confirmed");
  assert.equal((await position()).lotLNS, 100n);
  assert.equal((await position()).positionType, 0);
  await enabled("Turn protection on");
  await click("Turn protection on");
  await confirm("Protection policy armed");
  assert.equal(
    (await read("getPolicy", [await read("currentPolicyId")])).active,
    true,
  );
  await page.screenshot({
    path: ".local/trading/browser/perps-desktop.png",
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Close long", exact: true }).click();
  await click("Review order");
  await confirm("Order confirmed");
  assert.equal((await position()).lotLNS, 0n);
  assert.equal(
    (await read("getPolicy", [await read("currentPolicyId")])).active,
    false,
  );
  assert.equal(await read("reserveCNS"), reserve);
  checks.push(
    "Perpl account creation and AUSD funding",
    "actual BTC long fill",
    "protection armed",
    "actual close fill revokes protection without spending reserve",
  );
  const funding = page.locator("details").filter({
    has: page.locator("summary").filter({ hasText: "Trading balance" }),
  });
  if (!(await funding.evaluate((el) => el.open)))
    await funding.locator("summary").click();
  await funding.getByLabel("Amount", { exact: true }).fill("10");
  const ausdBefore = await tokens(d.collateral);
  await funding.getByRole("button", { name: "Withdraw", exact: true }).click();
  await confirm("Trading collateral withdrawn");
  assert.equal(await tokens(d.collateral), ausdBefore + 10_000_000n);
  checks.push("free trading collateral withdrawn to wallet");

  await click("Earn");
  assert.equal(await tokens(d.earnMON.vault), 0n);
  await page.getByLabel("Amount of MON", { exact: true }).fill("10");
  await click("Deposit MON");
  await status("Deposit confirmed");
  assert.ok((await tokens(d.earnMON.vault)) > 0n);
  await useAvailableEarnShares(page);
  await click("Withdraw MON");
  await status("Withdrawal confirmed");
  assert.equal(await tokens(d.earnMON.vault), 0n);
  assert.equal(await read("reserveCNS"), reserve);
  checks.push(
    "setsMON deposit and withdrawal in the same wallet; AUSD reserve untouched",
  );

  await page.setViewportSize({ width: 390, height: 844 });
  for (const tab of ["Earn", "Spot", "Perps"]) {
    await click(tab);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.waitForTimeout(200);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `${tab} mobile overflow`,
    );
    await page.screenshot({
      path: `.local/trading/browser/${tab.toLowerCase()}-mobile.png`,
    });
  }
  checks.push("all three sections at 390px without horizontal overflow");
  await click("Spot");
  await click("Trade MON");
  await page.route("http://127.0.0.1:18608/**", (route) => route.abort());
  await page
    .getByRole("alert")
    .filter({ hasText: "Could not read the Spot market" })
    .waitFor({ timeout: 30_000 });
  assert.ok(
    await page
      .getByRole("button", { name: "Get quote", exact: true })
      .isDisabled(),
  );
  await page.unroute("http://127.0.0.1:18608/**");
  checks.push("RPC failure disables quoting and swaps");
  assert.deepEqual(errors, []);
  const report = {
    result: "passed",
    url,
    mode: "LOCAL_FORK_ONLY",
    syntheticFunding: true,
    perplPriceFixture: d.perplFixture,
    checks,
    runtimeErrors: errors,
    checkedAt: new Date().toISOString(),
  };
  await writeFile(
    ".local/trading/browser/result.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} catch (e) {
  await page.screenshot({
    path: ".local/trading/browser/failure.png",
    fullPage: true,
  });
  await writeFile(
    ".local/trading/browser/failure.txt",
    await page.locator("body").innerText(),
  );
  throw e;
} finally {
  await browser.close();
}
