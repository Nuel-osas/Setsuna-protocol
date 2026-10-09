import { selectEarnAsset } from "./earn-ui.mjs";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import {
  encodeFunctionResult,
  encodeErrorResult,
  parseAbi,
  toFunctionSelector,
} from "viem";

const base = new URL(process.argv[2] ?? "http://127.0.0.1:3017").origin;
const output = `.local/earn-decision/${Date.now()}`;
await mkdir(output, { recursive: true });
const manifest = await (await fetch(`${base}/api/deployment/`)).json();
assert.equal(manifest.chainId, 31337);
assert.ok(manifest.earnMON && manifest.earnUSDC);
const browser = await chromium.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
page.setDefaultTimeout(60000);
const errors = [],
  checks = [],
  live = [];
page.on("pageerror", (e) => errors.push(e.message));
let fixture = null;
const selector = toFunctionSelector("previewRebalance()");
await page.route("**/api/rpc/**", async (route) => {
  const body = route.request().postDataJSON();
  const request = Array.isArray(body) ? undefined : body;
  if (
    !fixture ||
    request?.method !== "eth_call" ||
    request.params?.[0]?.data !== selector
  )
    return route.continue();
  const asset =
    request.params[0].to.toLowerCase() === manifest.earnMON.vault.toLowerCase()
      ? "MON"
      : "USDC";
  const n = asset === "MON" ? 2 : manifest.earnUSDC.adapters.length;
  const size = asset === "MON" ? "[2]" : "[]";
  const abi = parseAbi([
    "error CooldownActive()",
    `function previewRebalance() view returns((uint256 nav, uint256${size} positions, uint256${size} target, uint256${size} withdrawals, uint256${size} deposits, uint256${size} rates, uint256 annualIncomeBefore, uint256 annualIncomeAfter, uint256 grossMovement, bool repairsLimits))`,
  ]);
  let result;
  if (fixture === "unavailable")
    result = {
      error: { code: -32000, message: "Controlled preview read failure" },
    };
  else if (fixture === "cooldown")
    result = {
      error: {
        code: 3,
        message: "execution reverted",
        data: encodeErrorResult({ abi, errorName: "CooldownActive" }),
      },
    };
  else {
    const unit = 10n ** BigInt(asset === "MON" ? 18 : 6);
    const z = () => Array(n).fill(0n);
    const deposits = z();
    deposits[0] = unit;
    const target = z();
    target[0] = 9n * unit;
    result = {
      result: encodeFunctionResult({
        abi,
        functionName: "previewRebalance",
        result: {
          nav: 10n * unit,
          positions: z(),
          target,
          withdrawals: z(),
          deposits,
          rates: z(),
          annualIncomeBefore: unit,
          annualIncomeAfter: unit,
          grossMovement: unit,
          repairsLimits: false,
        },
      }),
    };
  }
  await route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ jsonrpc: "2.0", id: request.id, ...result }),
  });
});

async function open(asset) {
  await page.goto(`${base}/app/`, { waitUntil: "domcontentloaded" });
  await selectEarnAsset(page, asset);
  const panel = page.getByRole("region", {
    name: `${asset} allocation decision`,
  });
  await panel.locator(".s-earn-decision-facts").waitFor();
  return panel;
}
try {
  for (const asset of ["MON", "USDC"]) {
    const panel = await open(asset);
    live.push({ asset, text: await panel.innerText() });
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `${output}/${asset.toLowerCase()}-desktop.png`,
      fullPage: true,
    });
    await panel
      .getByText("Rate inputs used by the rule", { exact: true })
      .click();
    assert.ok(
      await panel
        .getByRole("columnheader", { name: "Earlier APR" })
        .isVisible(),
    );
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `${output}/${asset.toLowerCase()}-mobile.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1100 });
    checks.push(
      `${asset}: live fork decision, expandable rate inputs and mobile layout`,
    );
  }
  for (const [mode, title] of [
    ["cooldown", "Waiting for the cooldown"],
    ["unavailable", "Allocation preview unavailable"],
    ["small-gain", "Projected gain is too small"],
  ]) {
    fixture = mode;
    for (const asset of ["MON", "USDC"]) {
      const panel = await open(asset);
      await panel.getByRole("heading", { name: title, exact: true }).waitFor();
      if (mode === "small-gain") {
        await panel
          .getByRole("table", { name: `${asset} contract allocation preview` })
          .waitFor();
        assert.match(await panel.innerText(), /not a completed transaction/);
      }
      checks.push(`${asset}: controlled ${mode} preview explained accurately`);
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      {
        author: "Codex",
        checkedAt: new Date().toISOString(),
        base,
        status: "passed",
        checks,
        live,
        errors,
        scope:
          "Read-only browser verification. Three explicitly controlled RPC-response fixtures test error/preview presentation; no transactions or fork state changes.",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({ status: "passed", output, checks: checks.length }),
  );
} catch (error) {
  await page
    .screenshot({ path: `${output}/failure.png`, fullPage: true })
    .catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
