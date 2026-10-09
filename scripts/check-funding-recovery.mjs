import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http, erc20Abi, parseEther } from "viem";
import { readFile, writeFile } from "node:fs/promises";

const { dir, app } = JSON.parse(
  await readFile(".local/unified-demo/latest.json", "utf8"),
);
const base = new URL(app).origin;
const d = await (await fetch(`${base}/api/deployment/`)).json();
assert.equal(d.mode, "demo");
assert.equal(d.chainId, 31337);
assert(["127.0.0.1", "localhost"].includes(new URL(d.rpc).hostname));
const user = privateKeyToAccount(generatePrivateKey());
const c = createPublicClient({ transport: http(d.rpc) });
assert.equal(await c.getBalance({ address: user.address }), 0n);
const browser = await chromium.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
try {
  const page = await browser.newPage();
  let posts = 0,
    hash,
    holdReceipt = true;
  await page.exposeFunction(
    "walletRequest",
    async ({ method, params = [] }) => {
      if (["eth_accounts", "eth_requestAccounts"].includes(method))
        return [user.address];
      if (method === "eth_chainId") return "0x7a69";
      if (method.startsWith("wallet_")) return null;
      if (method === "eth_sendTransaction")
        throw new Error("Funding requires no wallet signature");
      return c.request({ method, params });
    },
  );
  await page.addInitScript(() => {
    window.ethereum = {
      request: (args) => window.walletRequest(args),
      on() {},
      removeListener() {},
    };
  });
  await page.route("**/api/demo/fund/", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posts++;
    const response = await route.fetch();
    const result = await response.json();
    assert(result.hash, "The server must return the submitted hash");
    hash = result.hash;
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        hash,
        error:
          "Funding confirmation is unavailable. Check your balance and claim status before trying again.",
      }),
    });
  });
  await page.route("**/api/rpc/", async (route) => {
    const req = route.request().postDataJSON();
    if (
      holdReceipt &&
      req?.method === "eth_getTransactionReceipt" &&
      req.params?.[0] === hash
    )
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ jsonrpc: "2.0", id: req.id, result: null }),
      });
    return route.continue();
  });
  await page.goto(`${base}/app/?tab=spot`, { waitUntil: "networkidle" });
  await page
    .getByRole("button", { name: "Connect to swap", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: /Browser wallet/ }).click();
  await page
    .getByRole("button", { name: "Get test funds", exact: true })
    .click();
  const checking = page.getByRole("button", {
    name: "Checking funding transaction…",
    exact: true,
  });
  await checking.waitFor({ timeout: 60000 });
  assert(await checking.isDisabled());
  const key = `setsuna.funding.pending.${d.chainId}.${d.faucet}.${user.address}`;
  assert.equal(
    await page.evaluate((key) => localStorage.getItem(key), key),
    hash,
  );
  await page.reload({ waitUntil: "networkidle" });
  await page
    .getByRole("button", { name: "Connect to swap", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: /Browser wallet/ }).click();
  await checking.waitFor();
  assert(await checking.isDisabled());
  holdReceipt = false;
  await page
    .getByRole("status")
    .filter({ hasText: "Test funds received" })
    .waitFor({ timeout: 30000 });
  assert.equal(posts, 1, "No duplicate claim after reload");
  assert.equal(
    await page.evaluate((key) => localStorage.getItem(key), key),
    null,
  );
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
      1000000000n,
    );
  const proof = {
    user: user.address,
    hash,
    claimRequests: posts,
    checks: [
      "uncertain-response",
      "pending-disables-repeat",
      "reload-retains-hash",
      "actual-receipt-confirmed",
      "all-test-assets-received",
    ],
  };
  await writeFile(
    `${dir}/funding-recovery.json`,
    JSON.stringify(proof, null, 2),
  );
  console.log(JSON.stringify(proof));
} finally {
  await browser.close();
}
