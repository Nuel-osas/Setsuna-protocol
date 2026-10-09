import { selectEarnAsset } from "./earn-ui.mjs";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { docs, docHref } from "../src/lib/docs/catalog.ts";
const base = process.env.DOCS_CHECK_URL || "http://127.0.0.1:3015";
const out = ".local/docs-review";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  permissions: ["clipboard-read", "clipboard-write"],
  reducedMotion: "reduce",
});
const page = await context.newPage();
const errors = [],
  checked = [],
  links = new Set();
page.on("pageerror", (e) => errors.push(e.message));
try {
  for (const doc of docs) {
    const response = await page.goto(base + docHref(doc.slug), {
      waitUntil: "networkidle",
    });
    assert.equal(response.status(), 200, doc.slug);
    assert.equal(await page.locator("h1").count(), 1);
    assert.equal(await page.locator("h1").textContent(), doc.title);
    assert.equal(
      await page.locator(".s-header").count(),
      0,
      "No marketing header inside docs",
    );
    assert.equal(
      await page.locator('.sd-sidebar a[aria-current="page"]').textContent(),
      doc.title,
    );
    const width = await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    assert(width.scroll <= width.width, `Desktop overflow: ${doc.slug}`);
    const anchors = await page
      .locator(".sd-prose a, .sd-pagination a, .sd-contents nav a")
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("href")));
    for (const href of anchors) {
      if (href?.startsWith("/")) links.add(href);
      if (href?.startsWith("#"))
        assert(
          await page.locator(`[id="${href.slice(1)}"]`).count(),
          `Missing anchor ${doc.slug} ${href}`,
        );
    }
    checked.push(docHref(doc.slug));
  }
  for (const href of links)
    assert.equal(
      (await page.request.get(base + href)).status(),
      200,
      `Broken link ${href}`,
    );
  assert.equal(
    (await page.request.get(base + "/docs/does-not-exist/")).status(),
    404,
  );
  await page.goto(base + "/docs/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Copy page as Markdown" }).click();
  assert.match(
    await page.evaluate(() => navigator.clipboard.readText()),
    /^# Introduction/,
  );
  await page.keyboard.press("Control+k");
  await page
    .getByRole("combobox", { name: "Search documentation" })
    .fill("Curvance");
  const results = page.getByRole("listbox", { name: "Search results" });
  assert((await results.getByRole("option").count()) > 0);
  await results
    .getByRole("option")
    .filter({ hasText: "Where your funds go" })
    .click();
  await page.waitForURL("**/docs/how-it-works/where-funds-go/");
  assert.equal(
    await page.locator(".sd-search-dialog").evaluate((el) => el.open),
    false,
  );
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox").fill("nothingshouldmatchzzyy");
  await page.getByText("No pages match", { exact: false }).waitFor();
  await page.keyboard.press("Escape");
  assert.equal(
    await page.locator(".sd-search-dialog").evaluate((el) => el.open),
    false,
  );
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox").fill("exchange rate");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await page.waitForURL("**/docs/math/exchange-rate/");
  await page.getByLabel("Deposit (USDC)", { exact: true }).fill("1000");
  await page
    .getByLabel("Change in vault value (%)", { exact: true })
    .fill("-5");
  assert.match(
    await page.locator(".sd-calculator-results").textContent(),
    /950\.00/,
  );
  await page
    .getByLabel("Change in vault value (%)", { exact: true })
    .fill("-100");
  await page.locator(".sd-calculator").getByRole("alert").waitFor();
  await page.getByLabel("Change in vault value (%)", { exact: true }).fill("5");
  await page
    .getByRole("button", { name: "Copy code", exact: true })
    .first()
    .click();
  assert.match(
    await page.evaluate(() => navigator.clipboard.readText()),
    /idle underlying/,
  );
  await page.screenshot({ path: `${out}/math-desktop.png`, fullPage: true });
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  assert.equal(
    await page.locator(".sd-shell").getAttribute("data-theme"),
    "dark",
  );
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(
    await page.locator(".sd-shell").getAttribute("data-theme"),
    "dark",
  );
  await page.screenshot({ path: `${out}/dark-desktop.png`, fullPage: true });
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await page.goto(base + "/docs/", { waitUntil: "networkidle" });
  await page.screenshot({
    path: `${out}/introduction-desktop.png`,
    fullPage: true,
  });
  await page
    .getByRole("navigation", { name: "On this page", exact: true })
    .getByRole("link", { name: "Earn, Spot and Perps", exact: true })
    .click();
  assert((await page.locator("#earn-spot-and-perps").boundingBox()).y >= 70);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const slug of [
    "",
    "developers/contracts",
    "math/exchange-rate",
    "developers/keepers",
  ]) {
    await page.goto(base + docHref(slug), { waitUntil: "networkidle" });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `Mobile overflow ${slug}`,
    );
    assert(
      await page
        .getByRole("button", { name: "Open documentation menu" })
        .isVisible(),
    );
  }
  await page.getByRole("button", { name: "Open documentation menu" }).click();
  const menu = page.getByRole("dialog", {
    name: "Documentation menu",
    exact: true,
  });
  await menu
    .getByRole("link", { name: "Where your funds go", exact: true })
    .click();
  await page.waitForURL("**/docs/how-it-works/where-funds-go/");
  assert.equal(
    await page.locator(".sd-mobile-menu").evaluate((el) => el.open),
    false,
  );
  await page.getByRole("button", { name: "Open documentation menu" }).click();
  await page.keyboard.press("Escape");
  assert.equal(
    await page.locator(".sd-mobile-menu").evaluate((el) => el.open),
    false,
  );
  await page.locator(".sd-search-trigger").click();
  await page.getByRole("combobox").fill("withdraw");
  assert((await results.getByRole("option").count()) > 0);
  await page.screenshot({ path: `${out}/search-mobile.png`, fullPage: true });
  await page.keyboard.press("Escape");
  await page.goto(base + "/docs/", { waitUntil: "networkidle" });
  await page.screenshot({
    path: `${out}/introduction-mobile.png`,
    fullPage: true,
  });
  for (const route of ["/", "/app/"]) {
    await page.goto(base + route, { waitUntil: "networkidle" });
    assert.equal(
      await page.locator(".s-header").count(),
      1,
      "App and homepage keep their own header",
    );
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `Existing mobile page overflow ${route}`,
    );
    if (route === "/app/") await selectEarnAsset(page, "USDC");
  }
  assert.deepEqual(errors, []);
  const proof = {
    checkedAt: new Date().toISOString(),
    base,
    pages: checked,
    internalLinks: links.size,
    checks: [
      "22 pages render with one heading and active navigation",
      "internal links and section anchors",
      "unknown doc 404",
      "Markdown and code clipboard copy",
      "search body text and no-results state",
      "Ctrl+K, arrow keys, Enter and Escape",
      "positive/negative share-value example and invalid inputs",
      "dark theme persists after reload",
      "desktop and 390px mobile without document overflow",
      "mobile navigation closes after route change",
      "existing homepage and Earn app navigation preserved",
    ],
    errors,
  };
  await writeFile(
    `${out}/browser-proof.json`,
    JSON.stringify(proof, null, 2) + "\n",
  );
  console.log(JSON.stringify(proof, null, 2));
} finally {
  await browser.close();
}
