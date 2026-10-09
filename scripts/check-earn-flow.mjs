import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  erc20Abi,
  erc4626Abi,
  formatUnits,
  http,
  parseUnits,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  pickEarnAsset,
  selectEarnAsset,
  openEarnWithdrawal,
  useAvailableEarnShares,
} from "./earn-ui.mjs";

// Local-only flow check. Real synthetic-fund transactions; controlled failures are labeled.
const base = new URL(process.argv[2] ?? "http://127.0.0.1:3018").origin;
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const d = await (await fetch(`${base}/api/deployment/`)).json();
assert.equal(d.chainId, 31337);
assert.ok(["localhost", "127.0.0.1"].includes(new URL(d.rpc).hostname));
assert.ok(d.earnMON && d.earnUSDC);
const dir = `.local/earn-flow/${Date.now()}`;
await mkdir(dir, { recursive: true });
const account = privateKeyToAccount(generatePrivateKey());
const chain = defineChain({
  id: 31337,
  name: "Local Setsuna demo",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [d.rpc] } },
});
const client = createPublicClient({
  chain,
  transport: http(d.rpc, { retryCount: 0 }),
});
const signer = createWalletClient({
  account,
  chain,
  transport: http(d.rpc, { retryCount: 0 }),
});
const browser = await chromium.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
});
page.setDefaultTimeout(30000);
const errors = [],
  checks = [],
  txs = [];
let rejectNext = false,
  holdNext = false,
  release;
page.on("pageerror", (e) => errors.push(e.message));
await page.exposeFunction("earnFlowWallet", async ({ method, params = [] }) => {
  if (["eth_accounts", "eth_requestAccounts"].includes(method))
    return [account.address];
  if (method === "eth_chainId") return "0x7a69";
  if (
    ["wallet_switchEthereumChain", "wallet_addEthereumChain"].includes(method)
  )
    return null;
  if (method === "eth_sendTransaction") {
    if (holdNext) {
      holdNext = false;
      await new Promise((resolve) => {
        release = resolve;
      });
    }
    if (rejectNext) {
      rejectNext = false;
      throw new Error("User rejected the request (controlled browser test).");
    }
    const tx = params[0];
    assert.equal(tx.from.toLowerCase(), account.address.toLowerCase());
    const hash = await signer.sendTransaction({
      to: tx.to,
      data: tx.data,
      value: BigInt(tx.value ?? "0x0"),
      ...(tx.gas ? { gas: BigInt(tx.gas) } : {}),
    });
    txs.push({ hash, to: tx.to });
    return hash;
  }
  return client.request({ method, params });
});
await page.addInitScript(() => {
  window.ethereum = {
    request: async (args) => {
      try {
        return await window.earnFlowWallet(args);
      } catch (error) {
        // Playwright does not preserve custom Error properties across its bridge.
        if (/User rejected/.test(error.message)) error.code = 4001;
        throw error;
      }
    },
    on() {},
    removeListener() {},
  };
});
const button = (name) => page.getByRole("button", { name, exact: true });
const form = page.getByRole("region", {
  name: "Earn transaction",
  exact: true,
});
const status = (text) =>
  page.getByRole("status").filter({ hasText: text }).waitFor();
const shares = (asset) =>
  client.readContract({
    address: d[`earn${asset}`].vault,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  });
const allowance = (token, spender) =>
  client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account.address, spender],
  });
async function quoteReady() {
  await page.waitForFunction(() => {
    const text = document.querySelector(
      'output[aria-label="Estimated amount received"]',
    )?.textContent;
    return text && !["…", "—", "0.00", "0"].includes(text);
  });
}
async function noOverflow() {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
}
try {
  await page.goto(`${base}/app/`, { waitUntil: "domcontentloaded" });
  await selectEarnAsset(page, "MON");
  assert.equal(
    await page.getByRole("navigation", { name: "Earn asset" }).count(),
    0,
  );
  assert.equal(await form.count(), 1);
  await page.getByLabel("Amount of MON", { exact: true }).fill("1");
  await quoteReady();
  await selectEarnAsset(page, "USDC");
  assert.equal(
    await page.getByLabel("Amount of USDC", { exact: true }).inputValue(),
    "",
  );
  assert.equal(
    await page.getByLabel("Estimated amount received").innerText(),
    "0.00",
  );
  checks.push(
    "One form and asset dropdown; switching assets clears amount and old quote",
  );
  await form
    .getByRole("button", { name: "Connect account", exact: true })
    .click();
  await page.getByRole("button", { name: /Browser wallet/ }).click();
  await button("Get test funds").click();
  await status("Test funds received");

  for (const asset of ["USDC", "MON"]) {
    await selectEarnAsset(page, asset);
    const input = page.getByLabel(`Amount of ${asset}`, { exact: true });
    const deposit = button(`Deposit ${asset}`);
    for (const invalid of [
      "-1",
      "0",
      "1000000000000",
      "1e4",
      asset === "MON" ? "0.0000000000000000001" : "0.0000001",
    ]) {
      await input.fill(invalid);
      assert.equal(await deposit.isDisabled(), true);
    }
    const amount = asset === "MON" ? "1" : "10";
    await input.fill(amount);
    await quoteReady();
    const expected = await client.readContract({
      address: d[`earn${asset}`].vault,
      abi: erc4626Abi,
      functionName: "previewDeposit",
      args: [parseUnits(amount, asset === "MON" ? 18 : 6)],
    });
    const shown = Number(
      (
        await page.getByLabel("Estimated amount received").innerText()
      ).replaceAll(",", ""),
    );
    assert.ok(
      Math.abs(
        shown - Number(formatUnits(expected, asset === "MON" ? 24 : 12)),
      ) <= 0.000001,
    );
    if (asset === "USDC") {
      holdNext = true;
      rejectNext = true;
      await deposit.click();
      await page.waitForFunction(
        () =>
          document.querySelector('[role="combobox"][aria-label="Earn asset"]')
            ?.disabled,
      );
      assert.equal(await button("Switch to withdraw").isDisabled(), true);
      assert.equal(
        await page
          .getByRole("group", { name: "Earn action" })
          .getByRole("button", { name: "Withdraw", exact: true })
          .isDisabled(),
        true,
      );
      while (!release) await new Promise((resolve) => setTimeout(resolve, 20));
      release();
      await page
        .getByRole("alert")
        .filter({ hasText: /cancelled/i })
        .waitFor();
      assert.equal(txs.length, 0);
      checks.push(
        "Asset and mode stay locked during signing; rejected approval sends no transaction and recovers",
      );
    }
    await deposit.click();
    await status("Deposit confirmed");
    assert.ok((await shares(asset)) > 0n);
    const other = asset === "MON" ? "USDC" : "MON";
    assert.equal(await shares(other), 0n);
    await page.screenshot({
      path: `${dir}/${asset.toLowerCase()}-desktop.png`,
      fullPage: false,
    });
    await openEarnWithdrawal(page);
    assert.equal(
      await page
        .getByLabel(`sets${asset} shares to withdraw`, { exact: true })
        .inputValue(),
      "",
    );
    // The asset picker preserves withdrawal mode and never offers a cross-asset conversion.
    await pickEarnAsset(page, other);
    await page
      .getByLabel(`sets${other} shares to withdraw`, { exact: true })
      .waitFor();
    await pickEarnAsset(page, asset);
    await useAvailableEarnShares(page);
    await quoteReady();
    await button(`Withdraw ${asset}`).click();
    await status("Withdrawal confirmed");
    assert.equal(await shares(asset), 0n);
    if (asset === "MON")
      assert.equal(await allowance(d.earnMON.vault, d.earnMON.gateway), 0n);
    else assert.equal(await allowance(d.earnUSDC.asset, d.earnUSDC.vault), 0n);
    checks.push(
      `${asset}: validation, exact onchain preview, signed deposit, asset-specific shares, full withdrawal, no residual approval`,
    );
  }

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await selectEarnAsset(page, "USDC");
    await noOverflow();
    const formBox = await form.boundingBox();
    const positionBox = await page.locator(".s-position").boundingBox();
    assert.ok(
      formBox.y < positionBox.y,
      "Transaction card comes first on mobile",
    );
    await form.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${dir}/mobile-${width}.png` });
  }
  checks.push(
    "390px and 320px mobile: transaction card first, no horizontal overflow",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await selectEarnAsset(page, "USDC");
  await page.getByLabel("Amount of USDC", { exact: true }).fill("1");
  await quoteReady();
  // A failed quote must not leave an older estimate actionable.
  await page.route("**/api/rpc/**", async (route) => {
    const body = route.request().postDataJSON();
    if (
      body?.method === "eth_call" &&
      body.params?.[0]?.data?.startsWith("0xef8b30f7")
    )
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32000, message: "Controlled quote outage" },
        }),
      });
    return route.continue();
  });
  await page.getByLabel("Amount of USDC", { exact: true }).fill("2");
  await page
    .getByRole("status")
    .filter({ hasText: "Could not load an onchain quote" })
    .waitFor();
  assert.equal(await button("Deposit USDC").isDisabled(), true);
  assert.equal(
    await page.getByLabel("Estimated amount received").innerText(),
    "—",
  );
  await page.unroute("**/api/rpc/**");
  await page.getByLabel("Amount of USDC", { exact: true }).fill("3");
  await quoteReady();
  checks.push(
    "Controlled quote failure clears the estimate, blocks submit, and recovers",
  );
  assert.deepEqual(errors, []);
  assert.equal(txs.length, 6);
  for (const tx of txs)
    assert.equal(
      (await client.getTransactionReceipt({ hash: tx.hash })).status,
      "success",
    );
  await writeFile(
    `${dir}/result.json`,
    JSON.stringify(
      {
        author: "Codex",
        checkedAt: new Date().toISOString(),
        base,
        status: "passed",
        checks,
        txs,
        errors,
        scope:
          "Local synthetic Monad fork only. Automated injected signing wallet; one controlled user rejection and one controlled quote outage. No production deployment or mainnet transaction.",
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      status: "passed",
      checks: checks.length,
      transactions: txs.length,
      dir,
    }),
  );
} catch (error) {
  await page.screenshot({ path: `${dir}/failure.png` }).catch(() => {});
  await writeFile(
    `${dir}/failure.json`,
    JSON.stringify({ error: error.message, checks, txs, errors }, null, 2),
  );
  console.error(error);
  process.exitCode = 1;
} finally {
  release?.();
  await browser.close();
}
