import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";

// Read-only measurements against the configured backend; no synthetic rates or wallet.
const base = new URL(process.argv[2] ?? "http://127.0.0.1:3018").origin;
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const dir = `.local/earn-loading/${Date.now()}`;
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const results = [];
try {
  for (const path of ["/earn/", "/earn/usdc/", "/earn/mon/"]) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    const errors = [],
      requests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (!new URL(request.url()).pathname.startsWith("/api/")) return;
      const body = request.postDataJSON();
      const calls = body ? (Array.isArray(body) ? body : [body]) : [];
      requests.push({
        path: new URL(request.url()).pathname,
        calls: calls.length,
      });
      assert.ok(calls.length <= 20, "Batches stay within the gateway limit");
    });
    const start = performance.now();
    await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
    const selector = path === "/earn/" ? ".e-card-rate strong" : ".e-stats dd";
    await page.waitForFunction(
      (selector) => {
        const values = [...document.querySelectorAll(selector)].map((node) =>
          node.textContent.trim(),
        );
        return (
          values.length >= 2 &&
          values.every((value) => value && !value.includes("—"))
        );
      },
      selector,
      { timeout: 60_000 },
    );
    const cold = {
      path,
      headlineMs: Math.round(performance.now() - start),
      httpRequests: requests.length,
      rpcCalls: requests.reduce((sum, request) => sum + request.calls, 0),
      values: await page.locator(selector).allTextContents(),
    };
    await page.screenshot({
      path: `${dir}/${path.split("/").filter(Boolean).join("-")}.png`,
    });
    if (path === "/earn/") {
      const warmStart = performance.now();
      await page
        .getByRole("link", { name: "View setsUSDC vault", exact: true })
        .click();
      await page.waitForFunction(
        () => {
          const values = [...document.querySelectorAll(".e-stats dd")].map(
            (node) => node.textContent,
          );
          return (
            values.length === 3 && values.every((value) => !value.includes("—"))
          );
        },
        undefined,
        { timeout: 30_000 },
      );
      cold.warmUSDCNavigationMs = Math.round(performance.now() - warmStart);
    }
    assert.deepEqual(errors, []);
    results.push(cold);
    console.log(JSON.stringify(cold));
    await context.close();
  }
  await writeFile(
    `${dir}/result.json`,
    JSON.stringify(
      { checkedAt: new Date().toISOString(), base, results },
      null,
      2,
    ),
  );
  console.log(`Evidence: ${dir}`);
} finally {
  await browser.close();
}
