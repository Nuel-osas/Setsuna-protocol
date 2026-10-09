import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createPublicClient, http, encodeFunctionData, erc20Abi } from "viem";
const base = process.env.PREVIEW_URL || "http://localhost:3000";
const executablePath =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ executablePath, headless: true });
const report = { checkedAt: new Date().toISOString(), pages: [], checks: [] };
await mkdir("evidence", { recursive: true });
const d = await (await fetch(`${base}/api/deployment/`)).json();
assert.equal(
  d.mode,
  "local",
  "Start the prepared local fork and run Next with SETSUNA_LOCAL_DEMO=1",
);
assert.equal(d.chainId, 31337);
const rpc = createPublicClient({ transport: http(d.rpc) });
assert.equal(await rpc.getChainId(), 31337);
let snapshotId = await rpc.request({ method: "evm_snapshot", params: [] });
const accountAbi = JSON.parse(
  await readFile("contracts/abi/SetsunaAccount.json", "utf8"),
);
const factoryAbi = JSON.parse(
  await readFile("contracts/abi/SetsunaFactory.json", "utf8"),
);
async function read(name, args = []) {
  return rpc.readContract({
    address: d.account,
    abi: accountAbi,
    functionName: name,
    args,
  });
}
async function connectDemo(page) {
  await page
    .getByRole("button", { name: "Connect account", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Try the local demo account" })
    .click();
  await page.getByText("Top-up eligible", { exact: true }).waitFor();
}
async function confirm(page) {
  await page
    .getByRole("button", { name: "Confirm transaction", exact: true })
    .click();
  await page.locator(".s-toast").waitFor({ timeout: 45000 });
}
try {
  for (const [name, viewport] of [
    ["desktop", { width: 1440, height: 1000 }],
    ["mobile", { width: 390, height: 844 }],
  ]) {
    const context = await browser.newContext({
      viewport,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", (r) => {
      if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
    });
    for (const path of [
      "/",
      "/app/",
      "/faq/",
      "/privacy-policy/",
      "/terms-of-use/",
    ]) {
      const response = await page.goto(base + path, {
        waitUntil: "networkidle",
      });
      assert.equal(response.status(), 200);
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all(
          [...document.images].map(async (i) => {
            i.loading = "eager";
            await i.decode();
          }),
        );
      });
      const audit = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth,
        broken: [...document.images]
          .filter((i) => !i.naturalWidth)
          .map((i) => i.src),
        h1s: document.querySelectorAll("h1").length,
        copy: document.body.innerText,
        external: [...document.querySelectorAll("a")]
          .map((a) => a.href)
          .filter((h) => /deepbook|sui\.io|mysten/i.test(h)),
      }));
      assert.equal(audit.overflow, false, `${name}${path} overflows`);
      assert.deepEqual(audit.broken, []);
      assert.deepEqual(audit.external, []);
      assert.equal(audit.h1s, 1);
      assert.doesNotMatch(audit.copy, /DeepBook|Built on Sui|Mysten/);
      if (path === "/") {
        assert.equal(
          await page.locator("video").evaluate((v) => v.paused),
          true,
        );
        await page.locator("summary").first().click();
        assert.equal(
          await page
            .locator("details")
            .first()
            .evaluate((e) => e.open),
          true,
        );
      }
      await page.screenshot({
        path: `evidence/setsuna-${path === "/" ? "home" : path.replaceAll("/", "")}-${name}.png`,
        fullPage: true,
      });
      report.pages.push({ viewport: name, path, passed: true });
      console.log(`Checked ${name} ${path}`);
    }
    await page.goto(base + "/app/", { waitUntil: "networkidle" });
    await connectDemo(page);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: `evidence/setsuna-connected-${name}.png`,
      fullPage: true,
    });
    if (name === "desktop") {
      const initialReserve = await read("reserveCNS");
      await page.getByRole("button", { name: "Execute demo top-up" }).click();
      await confirm(page);
      assert.equal((await read("previewTopUp")).status, 8);
      const used = (await read("getPolicy", [1n])).usedCNS;
      assert(used > 0n);
      await page.getByText("Above trigger", { exact: true }).waitFor();
      report.checks.push(
        "Contract top-up executed via browser; equity restored above trigger and fee-inclusive spending recorded",
      );
      await page.getByRole("button", { name: "Reserve", exact: true }).click();
      await page
        .getByLabel("Withdraw unused reserve", { exact: true })
        .fill("10");
      await page
        .getByRole("button", { name: "Withdraw reserve", exact: true })
        .click();
      await confirm(page);
      assert.equal(
        await read("reserveCNS"),
        initialReserve - used - 10_000_000n,
      );
      assert.equal((await read("getPolicy", [1n])).usedCNS, used);
      await page.getByLabel("Add to reserve", { exact: true }).fill("10");
      await page.getByRole("button", { name: "Fund reserve" }).click();
      await confirm(page);
      assert.equal(await read("reserveCNS"), initialReserve - used);
      assert.equal(
        await rpc.readContract({
          address: d.collateral,
          abi: erc20Abi,
          functionName: "allowance",
          args: [d.owner, d.account],
        }),
        0n,
      );
      report.checks.push(
        "Withdraw + approve/fund round trip; spending preserved and exact allowance consumed",
      );
      await page
        .getByLabel("Withdraw unused reserve", { exact: true })
        .fill("999999");
      await page
        .getByRole("button", { name: "Withdraw reserve", exact: true })
        .click();
      await page
        .getByRole("alert")
        .filter({ hasText: "exceeds your reserve" })
        .waitFor();
      report.checks.push("Excess withdrawal rejected before signing");
      await page
        .getByRole("button", { name: "Revoke policy", exact: true })
        .click();
      await confirm(page);
      assert.equal((await read("getPolicy", [1n])).active, false);
      await page.getByLabel("Trigger buffer", { exact: true }).fill("20");
      await page.getByLabel("Target buffer", { exact: true }).fill("50");
      await page.getByRole("button", { name: "Arm protection" }).click();
      await confirm(page);
      assert.equal(await read("currentPolicyId"), 2n);
      assert.equal((await read("getPolicy", [1n])).usedCNS, used);
      await page.getByLabel("Update total cap", { exact: true }).fill("120");
      await page
        .getByRole("button", { name: "Update cap", exact: true })
        .click();
      await confirm(page);
      assert.equal((await read("getPolicy", [2n])).config.capCNS, 120_000_000n);
      report.checks.push(
        "Revoke, re-arm and cap update; historical policy spending retained",
      );
      await page.getByRole("link", { name: "FAQs", exact: true }).click();
      await page.getByRole("link", { name: "Launch app", exact: true }).click();
      await page.getByText("Above trigger", { exact: true }).waitFor();
      report.checks.push("Wallet session persists across client navigation");
      await page.getByRole("button", { name: "Trade", exact: true }).click();
      await page
        .getByLabel("Add trading collateral", { exact: true })
        .fill("10");
      await page
        .getByRole("button", { name: "Deposit trading collateral" })
        .click();
      await confirm(page);
      await page.getByRole("button", { name: "Withdraw this amount" }).click();
      await confirm(page);
      await page.getByLabel("Action", { exact: true }).selectOption("2");
      await page.getByLabel("Size", { exact: true }).fill("0.001");
      await page.getByLabel("Limit price", { exact: true }).fill("80000");
      await page.getByRole("button", { name: "Review order" }).click();
      await confirm(page);
      const exchangeAbi = JSON.parse(
        await readFile("contracts/abi/IPerplExchange.json", "utf8"),
      );
      const afterTrade = await rpc.readContract({
        address: d.exchange,
        abi: exchangeAbi,
        functionName: "getPositionV2",
        args: [1n, await read("accountId")],
      });
      assert.equal(afterTrade[0].lotLNS, 900n);
      assert.equal((await read("getPolicy", [2n])).active, false);
      report.checks.push(
        "Trading deposit/withdrawal and actual FOK close fill; changed position revokes prior policy",
      );
      // Restore the original prepared demo before the mobile and wallet tests.
      assert.equal(
        await rpc.request({ method: "evm_revert", params: [snapshotId] }),
        true,
      );
      snapshotId = await rpc.request({ method: "evm_snapshot", params: [] });
    }
    assert.deepEqual(errors, [], `${name} browser errors`);
    await context.close();
  }
  const walletContext = await browser.newContext();
  const walletPage = await walletContext.newPage();
  await walletPage.addInitScript(
    ({ rpc, owner }) => {
      const listeners = {};
      window.testWallet = { reject: true, chain: "0x1", listeners };
      const provider = {
        request: async ({ method, params = [] }) => {
          if (method === "eth_requestAccounts") {
            if (window.testWallet.reject)
              throw Object.assign(new Error("User rejected"), { code: 4001 });
            return [owner];
          }
          if (method === "eth_accounts") return [owner];
          if (method === "eth_chainId") return window.testWallet.chain;
          if (method === "wallet_switchEthereumChain") {
            window.testWallet.chain = params[0].chainId;
            (listeners.chainChanged || []).forEach((fn) =>
              fn(params[0].chainId),
            );
            return null;
          }
          const response = await fetch(rpc, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          });
          const result = await response.json();
          if (result.error) throw result.error;
          return result.result;
        },
        on: (name, fn) => {
          (listeners[name] ??= []).push(fn);
        },
        removeListener: (name, fn) => {
          listeners[name] = (listeners[name] || []).filter((f) => f !== fn);
        },
      };
      window.ethereum = provider;
    },
    { rpc: d.rpc, owner: d.owner },
  );
  await walletPage.goto(base + "/app/", { waitUntil: "networkidle" });
  await walletPage
    .getByRole("button", { name: "Connect account", exact: true })
    .first()
    .click();
  await walletPage.getByRole("button", { name: /Browser wallet/ }).click();
  await walletPage
    .getByRole("alert")
    .filter({ hasText: "cancelled" })
    .waitFor();
  await walletPage.evaluate(() => (window.testWallet.reject = false));
  await walletPage.getByRole("button", { name: /Browser wallet/ }).click();
  await walletPage.getByText("Top-up eligible", { exact: true }).waitFor();
  await walletPage.getByLabel("Update total cap", { exact: true }).fill("100");
  await walletPage
    .getByRole("button", { name: "Update cap", exact: true })
    .click();
  await confirm(walletPage);
  assert.equal(
    await walletPage.evaluate(() => window.testWallet.chain),
    "0x7a69",
  );
  await walletPage.evaluate(() =>
    window.testWallet.listeners.accountsChanged.forEach((fn) => fn([])),
  );
  await walletPage
    .getByRole("button", { name: "Connect account", exact: true })
    .first()
    .waitFor();
  report.checks.push(
    "Injected wallet rejection, connection, chain switch before write, and disconnect on account change",
  );
  await walletContext.close();
  const meraContext = await browser.newContext();
  const meraPage = await meraContext.newPage();
  const cdp = await meraContext.newCDPSession(meraPage);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send(
    "WebAuthn.addVirtualAuthenticator",
    {
      options: {
        protocol: "ctap2",
        ctap2Version: "ctap2_1",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
        hasPrf: true,
      },
    },
  );
  await meraPage.goto(base + "/app/", { waitUntil: "networkidle" });
  await meraPage
    .getByRole("button", { name: "Connect account", exact: true })
    .first()
    .click();
  await meraPage
    .getByRole("button", { name: "Create a passkey account" })
    .click();
  await meraPage
    .getByRole("button", { name: "Create Setsuna account" })
    .waitFor({ timeout: 15000 });
  const addr = (await cdp.send("WebAuthn.getCredentials", { authenticatorId }))
    .credentials;
  assert.equal(addr.length, 1);
  const sessionText = await meraPage.locator(".s-session-line").innerText();
  assert.match(sessionText, /Passkey/);
  await meraPage.locator(".s-session-line button").click();
  const meraAddress = (await meraPage.locator(".s-address").innerText()).trim();
  await meraPage
    .getByRole("button", { name: "Disconnect account", exact: true })
    .click();
  await meraPage
    .getByRole("button", { name: "Connect account", exact: true })
    .first()
    .click();
  await meraPage
    .getByRole("button", { name: "Use an existing passkey" })
    .click();
  await meraPage
    .locator(".s-session-line")
    .filter({ hasText: "Passkey" })
    .waitFor();
  await meraPage.locator(".s-session-line button").click();
  assert.equal(
    (await meraPage.locator(".s-address").innerText()).trim(),
    meraAddress,
  );
  await meraPage.getByRole("button", { name: "Close account dialog" }).click();
  assert.deepEqual(
    await meraPage.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
    })),
    { local: 0, session: 0 },
  );
  // Local fixture gas only, to prove real passkey-backed signing creates an onchain account.
  await rpc.request({
    method: "anvil_setBalance",
    params: [meraAddress, "0x56bc75e2d63100000"],
  });
  await meraPage
    .getByRole("button", { name: "Create Setsuna account" })
    .click();
  await confirm(meraPage);
  const created = await rpc.readContract({
    address: d.factory,
    abi: factoryAbi,
    functionName: "accountOf",
    args: [meraAddress],
  });
  assert.notEqual(created, "0x0000000000000000000000000000000000000000");
  assert.equal(
    (
      await rpc.readContract({
        address: created,
        abi: accountAbi,
        functionName: "owner",
      })
    ).toLowerCase(),
    meraAddress.toLowerCase(),
  );
  report.checks.push(
    "Actual Mera PRF create/recover derives the same address; no web storage secrets; session signs local account deployment (virtual authenticator)",
  );
  await meraContext.close();
  report.passed = true;
  console.log(JSON.stringify(report, null, 2));
} finally {
  await rpc.request({ method: "evm_revert", params: [snapshotId] });
  await writeFile(
    "evidence/setsuna-browser-report.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser.close();
}
