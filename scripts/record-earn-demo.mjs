import { selectEarnAsset, useAvailableEarnShares } from "./earn-ui.mjs";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  erc20Abi,
  http,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

// Records real signed demo-fork actions. The signing wallet is explicitly disclosed.
// The saved private key stays in ignored, owner-only local storage for recovery.
const base = "https://setsuna-metropolis.vercel.app";
const dir = `.local/submission-recording/${Date.now()}`;
await mkdir(dir, { recursive: true });
const d = await (await fetch(`${base}/api/deployment/`)).json();
assert.equal(d.chainId, 31337);
assert.equal(d.mode, "demo");
const privateKey = generatePrivateKey();
await writeFile(`${dir}/wallet.json`, JSON.stringify({ privateKey }), {
  mode: 0o600,
});
const account = privateKeyToAccount(privateKey);
const chain = defineChain({
  id: 31337,
  name: "Setsuna demo",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [d.rpc] } },
});
const c = createPublicClient({
  transport: http(d.rpc, { retryCount: 0, timeout: 30000 }),
});
const w = createWalletClient({
  account,
  chain,
  transport: http(d.rpc, { retryCount: 0, timeout: 30000 }),
});
const browser = await chromium.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir, size: { width: 1440, height: 900 } },
  reducedMotion: "reduce",
});
const page = await context.newPage();
page.setDefaultTimeout(90000);
const txs = [],
  chapters = [],
  errors = [];
const started = Date.now();
page.on("pageerror", (e) => errors.push(e.message));
await page.exposeFunction(
  "recordingWallet",
  async ({ method, params = [] }) => {
    if (["eth_accounts", "eth_requestAccounts"].includes(method))
      return [account.address];
    if (method === "eth_chainId") return "0x7a69";
    if (
      ["wallet_switchEthereumChain", "wallet_addEthereumChain"].includes(method)
    )
      return null;
    if (method === "eth_sendTransaction") {
      const tx = params[0];
      assert.equal(tx.from.toLowerCase(), account.address.toLowerCase());
      const hash = await w.sendTransaction({
        to: tx.to,
        data: tx.data,
        value: BigInt(tx.value ?? "0x0"),
        ...(tx.gas ? { gas: BigInt(tx.gas) } : {}),
      });
      txs.push(hash);
      await writeFile(`${dir}/transactions.json`, JSON.stringify(txs, null, 2));
      return hash;
    }
    return c.request({ method, params });
  },
);
await page.addInitScript(() => {
  window.ethereum = {
    request: (args) => window.recordingWallet(args),
    on() {},
    removeListener() {},
  };
});
async function caption(title, detail) {
  chapters.push({ seconds: (Date.now() - started) / 1000, title, detail });
  await page.evaluate(
    ({ title, detail }) => {
      let el = document.getElementById("recording-caption");
      if (!el) {
        el = document.createElement("aside");
        el.id = "recording-caption";
        document.body.append(el);
      }
      el.style.cssText =
        "position:fixed;z-index:2147483647;bottom:0;left:0;right:0;padding:16px 36px;background:#061416;color:#eff8f8;font:18px/1.5 sans-serif;pointer-events:none;box-shadow:0 -1px 0 #397078";
      el.replaceChildren();
      const heading = document.createElement("strong");
      heading.textContent = title;
      heading.style.fontSize = "22px";
      const note = document.createElement("div");
      note.textContent = detail;
      const disclosure = document.createElement("div");
      disclosure.textContent =
        "RECORDING · Synthetic funds on a Monad fork · Automated signing wallet · No mainnet funds";
      disclosure.style.cssText = "font-size:12px;opacity:.7;margin-top:5px";
      el.append(heading, note, disclosure);
    },
    { title, detail },
  );
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const button = (name) => page.getByRole("button", { name, exact: true });
const notice = (text) =>
  page.getByRole("status").filter({ hasText: text }).waitFor();
const shares = () =>
  c.readContract({
    address: d.earnUSDC.vault,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  });
let status = "failed",
  failure;
try {
  await page.goto(`${base}/app/`, { waitUntil: "domcontentloaded" });
  await selectEarnAsset(page, "USDC");
  await caption(
    "Setsuna · one deposit, transparent allocation",
    "This is the public web demo. Earn leads, with Spot and Perps alongside it.",
  );
  await pause(6000);
  await button("Connect account").first().click();
  await page.getByRole("button", { name: /Browser wallet/ }).click();
  await caption(
    "Start with test funds",
    "The faucet supplies synthetic MON for gas, USDC for Earn/Spot, and AUSD for Perps.",
  );
  await button("Get test funds").click();
  await notice("Test funds received");
  await page.getByLabel("Amount of USDC", { exact: true }).fill("100");
  await caption(
    "Deposit 100 USDC",
    "Approve only the deposit amount. The vault then issues setsUSDC receipt shares.",
  );
  await pause(3000);
  await button("Deposit USDC").click();
  await notice("Deposit confirmed");
  assert.ok((await shares()) > 0n);
  await page
    .getByRole("heading", { name: "Your setsUSDC", exact: true })
    .scrollIntoViewIfNeeded();
  await pause(7000);
  await page
    .getByRole("heading", { name: "Where your USDC works" })
    .scrollIntoViewIfNeeded();
  await caption(
    "Inspect the actual vault holdings",
    "Five fixed lending integrations plus cash. A new deposit can remain idle until a permitted rebalance.",
  );
  await pause(8000);
  const decision = page.getByRole("region", {
    name: "USDC allocation decision",
  });
  await decision.scrollIntoViewIfNeeded();
  await caption(
    "See why the vault moves—or waits",
    "The contract reports its decision at the displayed block. The cooldown and movement limits still apply.",
  );
  await pause(8000);
  await decision
    .getByText("Rate inputs used by the rule", { exact: true })
    .click();
  await decision.getByRole("table").first().scrollIntoViewIfNeeded();
  await caption(
    "Compare the recorded rate inputs",
    "The allocation rule uses conservative base-rate observations. Rates are not guaranteed returns or a complete risk score.",
  );
  await pause(8000);
  await page
    .getByText("Vault activity and public controls", { exact: true })
    .click();
  await page.locator(".s-mon-history").scrollIntoViewIfNeeded();
  await caption(
    "Verify executed events",
    "Each receipt links to the same fork’s explorer. A proposed allocation is different from a completed move.",
  );
  await pause(7000);
  await useAvailableEarnShares(page);
  await page.getByLabel("setsUSDC shares to withdraw").scrollIntoViewIfNeeded();
  await caption(
    "Withdraw the available position",
    "Redeem setsUSDC into USDC. Availability depends on cash and lending-market liquidity.",
  );
  await pause(3000);
  await button("Withdraw USDC").click();
  await notice("Withdrawal confirmed");
  assert.equal(await shares(), 0n);
  await page
    .getByRole("heading", { name: "Your setsUSDC", exact: true })
    .scrollIntoViewIfNeeded();
  await pause(7000);
  await button("Spot").click();
  await caption(
    "Spot · MON / USDC through Kuru",
    "This supporting workspace uses wallet assets. Earn shares do not automatically fund trades.",
  );
  await pause(7000);
  await button("Perps").click();
  await caption(
    "Perps · AUSD collateral through Perpl",
    "Perps is separate from Earn. This fork demo uses a fixed historical BTC mark of $82,964.20.",
  );
  await pause(7000);
  await page.goto(`${base}/evidence/`, { waitUntil: "domcontentloaded" });
  await caption(
    "Try it yourself · inspect the evidence",
    "setsuna-metropolis.vercel.app · Recorded receipts and limits are available on the Evidence page.",
  );
  await pause(8000);
  for (const hash of txs)
    assert.equal((await c.getTransactionReceipt({ hash })).status, "success");
  assert.deepEqual(errors, []);
  status = "passed";
} catch (error) {
  failure = error.message;
  console.error(error);
  process.exitCode = 1;
} finally {
  await context.close();
  const video = await page.video().path();
  await browser.close();
  await writeFile(
    `${dir}/result.json`,
    JSON.stringify(
      {
        author: "Codex",
        recordedAt: new Date().toISOString(),
        status,
        base,
        wallet: account.address,
        transactions: txs,
        chapters,
        video,
        errors,
        failure,
        scope:
          "Real public fork funding and USDC deposit/full withdrawal, signed through an injected test wallet. Spot and Perps screens shown without new trades. Recording captions are an overlay, not application state. No clock changes or administrator RPC.",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ status, dir, video, transactions: txs.length }));
}
