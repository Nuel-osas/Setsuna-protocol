import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { erc20Abi, formatUnits, parseAbi } from "viem";

// Called by the isolated hosted-configuration test, with a freshly funded signed wallet.
export async function checkTradingJourney({
  page,
  client: c,
  d,
  user,
  dir,
  txs,
  fault,
}) {
  const checks = [];
  const appOrigin = new URL(page.url()).origin;
  const click = (name) =>
    page.getByRole("button", { name, exact: true }).click();
  const status = (text) =>
    page
      .getByRole("status")
      .filter({ hasText: text })
      .waitFor({ timeout: 60000 });
  const enabled = async (name) =>
    page.waitForFunction(
      (label) =>
        [...document.querySelectorAll("button")].some(
          (b) => b.textContent.trim() === label && !b.disabled,
        ),
      name,
    );
  const confirm = async (text) => {
    await click("Confirm");
    await status(text);
  };
  const tokens = (address, owner = user.address) =>
    c.readContract({
      address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [owner],
    });
  const allowance = (token, owner, spender) =>
    c.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [owner, spender],
    });
  const accountABI = JSON.parse(
    await readFile("contracts/abi/SetsunaAccount.json"),
  );
  const exchangeABI = JSON.parse(
    await readFile("contracts/abi/IPerplExchange.json"),
  );
  await enabled("Get quote");
  for (const invalid of ["-1", "10.00000000001", "1000000000"]) {
    await page.getByLabel("Spot amount", { exact: true }).fill(invalid);
    assert.ok(
      await page
        .getByRole("button", { name: "Get quote", exact: true })
        .isDisabled(),
    );
  }
  await page.getByLabel("Spot amount", { exact: true }).fill("10");
  const usdcBefore = await tokens(d.spot.usdc);
  await click("Get quote");
  await enabled("Swap MON for USDC");
  fault.rejectNext = true;
  const count = txs.length;
  await click("Swap MON for USDC");
  await page
    .getByRole("alert")
    .filter({ hasText: /cancelled|reject|denied/i })
    .waitFor();
  assert.equal(txs.length, count, "Rejected signature must never broadcast");
  await enabled("Swap MON for USDC");
  await click("Swap MON for USDC");
  await status("Swap confirmed");
  const soldHash = txs.at(-1);
  const gained = (await tokens(d.spot.usdc)) - usdcBefore;
  assert.ok(gained > 0n);
  await click("Buy MON");
  await page.getByLabel("Spot amount", { exact: true }).fill("1");
  const monBefore = await c.getBalance({ address: user.address });
  await click("Get quote");
  await enabled("Swap USDC for MON");
  await click("Swap USDC for MON");
  await status("Swap confirmed");
  assert.equal(await tokens(d.spot.usdc), usdcBefore + gained - 1000000n);
  assert.ok((await c.getBalance({ address: user.address })) > monBefore);
  assert.equal(await tokens(d.spot.usdc, d.spot.gateway), 0n);
  assert.equal(await c.getBalance({ address: d.spot.gateway }), 0n);
  assert.equal(await allowance(d.spot.usdc, user.address, d.spot.gateway), 0n);
  await page.screenshot({ path: `${dir}/spot-desktop.png`, fullPage: true });
  checks.push(
    "Spot entry funding",
    "Spot both directions with settled wallet balances",
    "Spot exact approval consumed and gateway empty",
    "Invalid size and signature rejection handled",
  );
  console.log(
    "Spot sell, buy, rejected signature, balances and approvals passed. Testing Perps…",
  );

  await click("Perps");
  await page
    .getByRole("button", { name: "Test funds already claimed", exact: true })
    .waitFor();
  await enabled("Create account");
  await click("Create account");
  await confirm("Account created");
  const account = await c.readContract({
    address: d.factory,
    abi: parseAbi(["function accountOf(address) view returns(address)"]),
    functionName: "accountOf",
    args: [user.address],
  });
  const read = (functionName, args = []) =>
    c.readContract({ address: account, abi: accountABI, functionName, args });
  const funding = page.locator("details").filter({
    has: page.locator("summary").filter({ hasText: "Trading balance" }),
  });
  await funding.locator("summary").click();
  await page.getByLabel("Opening deposit", { exact: true }).fill("100");
  await click("Open trading account");
  await confirm("Trading balance updated");
  const accountId = await read("accountId");
  const position = async () =>
    (
      await c.readContract({
        address: d.exchange,
        abi: exchangeABI,
        functionName: "getPositionV2",
        args: [1n, accountId],
      })
    )[0];
  const free = async () =>
    (
      await c.readContract({
        address: d.exchange,
        abi: exchangeABI,
        functionName: "getAccountById",
        args: [accountId],
      })
    ).balanceCNS;
  await funding.getByLabel("Amount", { exact: true }).fill("25");
  await funding.getByRole("button", { name: "Deposit", exact: true }).click();
  await confirm("Trading balance updated");
  assert.equal(await free(), 125000000n);
  await page.getByLabel("Add", { exact: true }).fill("50");
  await click("Fund reserve");
  await confirm("Reserve funded");
  assert.equal(await read("reserveCNS"), 50000000n);
  const place = async (side, size, price) => {
    await page.getByRole("tab", { name: side, exact: true }).click();
    if (size) await page.getByLabel("Size", { exact: true }).fill(size);
    if (price)
      await page.getByLabel("Limit price", { exact: true }).fill(price);
    await enabled("Review order");
    await click("Review order");
    if (price)
      assert.ok(
        (
          await page
            .getByRole("dialog", { name: "Place order", exact: true })
            .innerText()
        ).includes(`$${price}`),
        "Review must preserve the entered limit",
      );
    if (price) {
      const before = txs.length;
      await click("Confirm");
      await page
        .getByRole("alert")
        .filter({ hasText: "Order cannot fill completely" })
        .waitFor();
      assert.equal(
        txs.length,
        before,
        "Non-crossing FOK must stop before signing",
      );
      await page
        .getByRole("dialog", { name: "Place order", exact: true })
        .getByRole("button", { name: "Close", exact: true })
        .click();
    } else await confirm(`${side} filled:`);
  };
  await place("Long", "0.001");
  assert.equal((await position()).lotLNS, 100n);
  assert.equal((await position()).positionType, 0);
  await enabled("Turn protection on");
  await click("Turn protection on");
  await confirm("Protection policy armed");
  assert.ok((await read("getPolicy", [await read("currentPolicyId")])).active);
  await page.screenshot({
    path: `${dir}/perps-long-desktop.png`,
    fullPage: true,
  });
  await place("Close long", "0.0005");
  assert.equal((await position()).lotLNS, 50n);
  assert.equal(
    (await read("getPolicy", [await read("currentPolicyId")])).active,
    false,
  );
  // Oversized close must fail before any wallet transaction.
  await page.getByLabel("Size", { exact: true }).fill("1");
  await click("Review order");
  await page
    .getByRole("alert")
    .filter({ hasText: "Close size exceeds" })
    .waitFor();
  await place("Close long", "0.0005");
  assert.equal((await position()).lotLNS, 0n);
  await place("Short", "0.001");
  assert.equal((await position()).positionType, 1);
  assert.equal((await position()).lotLNS, 100n);
  await place("Close short", "0.001");
  assert.equal((await position()).lotLNS, 0n);
  const beforeUnfilled = await free();
  await place(
    "Long",
    "0.001",
    String(Math.floor((Number(d.perplFixture.markPNS) / 10) * 0.9)),
  );
  assert.equal((await position()).lotLNS, 0n);
  assert.equal(await free(), beforeUnfilled);
  const closeHash = txs.at(-1);
  await page
    .locator(".t-history")
    .getByText("Order filled", { exact: true })
    .first()
    .waitFor();
  assert.equal(await read("reserveCNS"), 50000000n);
  checks.push(
    "Perps account initialization and repeat collateral deposit",
    "Long fill, partial close and full close",
    "Short fill and full close",
    "Non-crossing FOK rejected before signing with readable liquidity error",
    "Activity verifies receipt fills",
    "Protection revoked on trade and reserve isolated",
    "Oversized close blocked before signing",
  );
  console.log(
    "Long, partial close, short and zero-fill reporting passed. Testing full withdrawals and recovery…",
  );
  await funding.getByLabel("Amount", { exact: true }).fill("1000000");
  await funding.getByRole("button", { name: "Withdraw", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "exceeds your free trading balance" })
    .waitFor();
  const walletBefore = await tokens(d.collateral),
    freeBefore = await free();
  await click("Use full free balance");
  assert.equal(
    await funding.getByLabel("Amount", { exact: true }).inputValue(),
    formatUnits(freeBefore, 6),
  );
  await funding.getByRole("button", { name: "Withdraw", exact: true }).click();
  await confirm("Trading collateral withdrawn");
  assert.equal(await free(), 0n);
  assert.equal(await tokens(d.collateral), walletBefore + freeBefore);
  await click("Use full reserve");
  await page
    .locator(".t-reserve")
    .getByRole("button", { name: "Withdraw", exact: true })
    .click();
  await confirm("Reserve withdrawn");
  assert.equal(await read("reserveCNS"), 0n);
  assert.equal(
    await tokens(d.collateral),
    walletBefore + freeBefore + 50000000n,
  );
  assert.equal(await tokens(d.collateral, account), 0n);
  assert.equal(await allowance(d.collateral, user.address, account), 0n);
  assert.equal(await allowance(d.collateral, account, d.exchange), 0n);
  checks.push(
    "Full free collateral and reserve returned to wallet",
    "No residual AUSD or allowances in trading account",
  );

  for (const [tab, hash, key, action, reconcile] of [
    [
      "spot",
      soldHash,
      `setsuna.spot.pending.${d.chainId}.${d.spot.gateway}.${user.address}`,
      "Get quote",
      "Check receipt",
    ],
    [
      "perps",
      closeHash,
      `setsuna.perps.pending.${d.chainId}.${d.factory}.${user.address}`,
      "Review order",
      "Check it now",
    ],
  ]) {
    await page.evaluate(([k, h]) => localStorage.setItem(k, h), [key, hash]);
    await page.goto(`${appOrigin}/app/?tab=${tab}`);
    await page
      .getByRole("button", {
        name: tab === "spot" ? "Connect to swap" : "Connect to trade",
        exact: true,
      })
      .click();
    await page.getByRole("button", { name: /Browser wallet/ }).click();
    await page.getByRole("button", { name: reconcile, exact: true }).waitFor();
    assert.ok(
      await page
        .getByRole("button", { name: action, exact: true })
        .isDisabled(),
    );
    const txCount = txs.length;
    await click(reconcile);
    await status(/confirmed/i);
    assert.equal(
      await page.evaluate((k) => localStorage.getItem(k), key),
      null,
    );
    assert.equal(txs.length, txCount);
  }
  checks.push(
    "Spot and Perps pending receipts survive reload, block writes and reconcile without duplicate broadcast",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  for (const tab of ["Spot", "Perps"]) {
    await click(tab);
    if (tab === "Spot") await click("Trade MON");
    await page.evaluate(() => window.scrollTo(0, 0));
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      `${tab} mobile overflow`,
    );
    await page.screenshot({
      path: `${dir}/${tab.toLowerCase()}-mobile.png`,
      fullPage: true,
    });
    await page.route("**/api/rpc/", (route) =>
      route.fulfill({
        status: 503,
        body: '{"error":"test outage"}',
        contentType: "application/json",
      }),
    );
    await page.getByRole("alert").first().waitFor({ timeout: 25000 });
    const action = tab === "Spot" ? "Get quote" : "Trading unavailable";
    await page.waitForFunction(
      (label) =>
        [...document.querySelectorAll("button")].some(
          (b) => b.textContent.trim() === label && b.disabled,
        ),
      action,
      { timeout: 25000 },
    );
    await page.unroute("**/api/rpc/");
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await click("Earn");
  checks.push("Spot and Perps mobile layouts and RPC outage disable writes");
  return { account, accountId: String(accountId), checks };
}
