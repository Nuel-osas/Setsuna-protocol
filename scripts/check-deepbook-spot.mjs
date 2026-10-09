import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";
const base = process.env.SETSUNA_CHECK_URL ?? "http://127.0.0.1:3009",
  out = ".local/deepbook-spot/review";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  }),
  errors = [],
  checks = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(`${base}/app/?tab=spot`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".db-book-row", { timeout: 40000 });
  await page
    .getByRole("img", {
      name: "MON / USDC historical closing prices",
      exact: true,
    })
    .waitFor({ timeout: 30000 });
  const chart = await page.locator(".db-chart").boundingBox(),
    book = await page.locator(".db-book").boundingBox(),
    ticket = await page.locator(".db-ticket").boundingBox(),
    summary = await page.locator(".db-summary").boundingBox();
  assert.ok(chart.x < book.x && book.x < ticket.x);
  assert.ok(Math.abs(summary.width - chart.width) < 2);
  assert.ok(Math.abs(book.y - ticket.y) < 2);
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
    "rgb(3, 3, 3)",
  );
  await page
    .getByLabel("Price grouping", { exact: true })
    .selectOption("0.0001");
  assert.match(
    await page.locator(".db-book-row span").first().innerText(),
    /^\d+\.\d{4}$/,
  );
  await page
    .getByRole("group", { name: "Book size currency" })
    .getByRole("button", { name: "USDC", exact: true })
    .click();
  assert.match(
    await page.locator(".db-book-head").innerText(),
    /Size \(USDC\)/,
  );
  await page
    .getByLabel("Price grouping", { exact: true })
    .selectOption("0.000001");
  await page
    .getByRole("group", { name: "Book size currency" })
    .getByRole("button", { name: "MON", exact: true })
    .click();
  await page
    .getByRole("group", { name: "Book side" })
    .getByRole("button", { name: "Bids", exact: true })
    .click();
  assert.equal(await page.locator(".db-book-row.is-sell").count(), 0);
  await page
    .getByRole("group", { name: "Book side" })
    .getByRole("button", { name: "All", exact: true })
    .click();
  await page
    .getByRole("group", { name: "Market activity" })
    .getByRole("button", { name: "Trades", exact: true })
    .click();
  await page.waitForSelector(".db-trade-row", { timeout: 30000 });
  checks.push(
    "Desktop chart/book/ticket geometry, price grouping, quote/base sizes, book filters and actual Kuru trade feed pass.",
  );
  await page
    .getByRole("group", { name: "Market activity" })
    .getByRole("button", { name: "Order Book", exact: true })
    .click();
  await page.screenshot({ path: `${out}/spot-desktop.png`, fullPage: true });
  for (const width of [1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 844 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      `overflow ${width}`,
    );
    const header = await page.locator(".s-tabs").boundingBox();
    assert.ok(header.y < 10, `App navigation stays in header at ${width}`);
  }
  await page.screenshot({
    path: `${out}/spot-mobile-chart.png`,
    fullPage: true,
  });
  const mobile = page.getByRole("group", { name: "Spot market view" });
  await mobile.getByRole("button", { name: "Order Book", exact: true }).click();
  assert.ok(await page.locator(".db-book").isVisible());
  assert.ok(!(await page.locator(".db-chart").isVisible()));
  await mobile.getByRole("button", { name: "Trades", exact: true }).click();
  await page.waitForSelector(".db-trade-row", { timeout: 30000 });
  await mobile.getByRole("button", { name: "Chart", exact: true }).click();
  await page.getByRole("button", { name: "Trade MON", exact: true }).click();
  assert.ok(await page.locator(".db-ticket").isVisible());
  await page.getByRole("button", { name: "Buy MON", exact: true }).click();
  assert.match(await page.locator(".db-available").innerText(), /USDC/);
  await page.screenshot({
    path: `${out}/spot-mobile-ticket.png`,
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Close order form", exact: true })
    .first()
    .click();
  assert.ok(!(await page.locator(".db-ticket").isVisible()));
  checks.push(
    "Responsive widths pass; mobile chart/book/trades tabs and order form open/close work.",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("group", { name: "App sections" })
    .count()
    .catch(() => 0);
  await page.getByRole("button", { name: "Perps", exact: true }).click();
  assert.ok(!(await page.locator(".db-spot").count()));
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
    "rgb(11, 16, 19)",
  );
  assert.deepEqual(errors, []);
  await writeFile(
    `${out}/checks.json`,
    JSON.stringify(
      { base, at: new Date().toISOString(), checks, errors },
      null,
      2,
    ),
  );
  console.log(checks.join("\n"));
} finally {
  await browser.close();
}
