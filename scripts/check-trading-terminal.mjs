import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";
const base = "http://127.0.0.1:3008",
  out = ".local/trading-terminal/review";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
});
const errors = [],
  checks = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  for (const tab of ["spot", "perps"]) {
    await page.goto(`${base}/app/?tab=${tab}`, { waitUntil: "networkidle" });
    await page.waitForFunction(
      () => document.querySelector(".t-stat strong")?.textContent !== "—",
    );
    assert.equal(await page.locator("h1").count(), 1);
    assert.ok(
      await page.locator(".t-ticket").isVisible(),
      "Order form visible before connecting",
    );
    if (tab === "spot") {
      assert.ok((await page.locator(".t-book-row").count()) > 5);
      await page
        .getByRole("group", { name: "Book side", exact: true })
        .getByRole("button", { name: "Bids", exact: true })
        .click();
      assert.equal(await page.locator(".t-book-row.is-sell").count(), 0);
      await page
        .getByRole("group", { name: "Book side", exact: true })
        .getByRole("button", { name: "Asks", exact: true })
        .click();
      assert.equal(await page.locator(".t-book-row.is-buy").count(), 0);
      await page
        .getByRole("group", { name: "Book side", exact: true })
        .getByRole("button", { name: "All", exact: true })
        .click();
      await page
        .getByRole("group", { name: "Chart view", exact: true })
        .getByRole("button", { name: "Price", exact: true })
        .click();
      assert.ok(
        await page
          .getByRole("img", {
            name: "Price observations recorded in this browser session",
          })
          .isVisible(),
      );
      await page
        .getByRole("group", { name: "Chart view", exact: true })
        .getByRole("button", { name: "Depth", exact: true })
        .click();
      checks.push(
        "Spot book filters and price/depth switching work with actual fork data.",
      );
    } else {
      const ticket = page.locator(".t-ticket");
      const chip = page.getByRole("button", { name: "2×", exact: true });
      await chip.click();
      assert.match(await chip.getAttribute("class"), /is-on/);
      const [a, b] = await Promise.all([
        ticket.boundingBox(),
        chip.boundingBox(),
      ]);
      assert.ok(
        b.x >= a.x &&
          b.x + b.width <= a.x + a.width &&
          b.y >= a.y &&
          b.y + b.height <= a.y + a.height,
        "Leverage controls stay inside order ticket",
      );
      await page.getByRole("button", { name: "10×", exact: true }).click();
      await page.getByRole("tab", { name: "Short", exact: true }).click();
      assert.equal(
        await page
          .getByRole("tab", { name: "Short", exact: true })
          .getAttribute("aria-selected"),
        "true",
      );
      await page.getByRole("tab", { name: "Long", exact: true }).click();
      await page
        .getByRole("group", { name: "Chart sample window" })
        .getByRole("button", { name: "30 samples" })
        .click();
      assert.match(
        await page.locator("main").innerText(),
        /oracle guard is disabled only on this fork/,
      );
      checks.push(
        "Perps side, leverage and chart controls work; fixture disclosure remains visible.",
      );
    }
    for (const width of [1440, 1024, 768, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${tab} overflow at ${width}`,
      );
      const connect = await page.locator(".s-header-end").boundingBox();
      assert.ok(
        connect.x + connect.width > width - 40,
        "Wallet control at right edge",
      );
      await page.screenshot({
        path: `${out}/${tab}-${width}.png`,
        fullPage: true,
      });
      checks.push(`${tab}: ${width}px, no document overflow.`);
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("button", { name: "Connect to trade", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Try the local demo account/ })
    .click();
  await page
    .getByRole("button", { name: "Review order", exact: true })
    .waitFor();
  await page.screenshot({ path: `${out}/perps-connected.png`, fullPage: true });
  await page.getByRole("button", { name: "Spot", exact: true }).click();
  await page.getByRole("button", { name: "Get quote", exact: true }).waitFor();
  await page.screenshot({ path: `${out}/spot-connected.png`, fullPage: true });
  await page.route("http://127.0.0.1:18608/**", (r) => r.abort());
  await page
    .getByRole("status")
    .filter({ hasText: "Market data unavailable" })
    .waitFor({ timeout: 30000 });
  assert.equal(
    await page.locator(".t-book-row").count(),
    0,
    "Read failure removes stale book",
  );
  assert.equal(await page.locator(".t-stat strong").first().innerText(), "—");
  await page.unroute("http://127.0.0.1:18608/**");
  checks.push(
    "RPC failure clears market price/depth instead of presenting stale data.",
  );
  await page.getByRole("button", { name: "Earn", exact: true }).click();
  assert.equal(await page.locator(".t-shell").count(), 0);
  assert.ok(await page.locator(".s-earn-asset-tabs").isVisible());
  await page.goto(base, { waitUntil: "networkidle" });
  assert.ok(await page.locator(".m-hero").isVisible());
  assert.equal(await page.locator(".t-shell").count(), 0);
  checks.push("Earn and marketing pages retain their own styling.");
  assert.deepEqual(errors, []);
  const result = {
    result: "passed",
    checkedAt: new Date().toISOString(),
    checks,
    errors,
  };
  await writeFile(`${out}/result.json`, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
