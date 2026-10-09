import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright-core";

const { values } = parseArgs({ options: { proof: { type: "string" } } });
if (!values.proof) throw new Error("--proof path/to/result.json required; the verified local demo must still be running");
const proof = JSON.parse(await readFile(values.proof, "utf8"));
const dir = dirname(values.proof), base = "http://127.0.0.1:3011";
const d = await (await fetch(`${base}/api/deployment/`)).json();
assert.equal(d.mode, "demo"); assert.equal(d.chainId, 31337); assert.equal(d.factory, proof.contracts.factory);
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.exposeFunction("walletRequest", async ({ method, params = [] }) => {
    if (["eth_accounts", "eth_requestAccounts"].includes(method)) return [proof.user];
    if (method === "eth_chainId") return "0x7a69";
    if (/send|sign|wallet_/i.test(method)) throw new Error("Read-only browser review: signing unavailable");
    const r = await (await fetch(d.rpc, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json();
    if (r.error) throw new Error(r.error.message);
    return r.result;
  });
  await page.addInitScript(() => { window.ethereum = { request: (args) => window.walletRequest(args), on() {}, removeListener() {} }; });
  await page.goto(`${base}/app/?tab=spot`);
  const click = (name) => page.getByRole("button", { name, exact: true }).click();
  await click("Trade MON"); await click("Connect to swap"); await page.getByRole("button", { name: /Browser wallet/ }).click();
  const enabled = (name) => page.waitForFunction((label) => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === label && !b.disabled), name);
  for (const tab of ["Spot", "Perps"]) {
    if (tab === "Perps") await click(tab);
    const action = tab === "Spot" ? "Get quote" : "Review order";
    await enabled(action);
    await page.screenshot({ path: `${dir}/${tab.toLowerCase()}-mobile-ready.png`, fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.route("**/api/rpc/", (route) => route.fulfill({ status: 503, body: '{"error":"test outage"}', contentType: "application/json" }));
    await page.getByRole("alert").first().waitFor({ timeout: 30000 });
    const disabled = tab === "Spot" ? "Get quote" : "Trading unavailable";
    await page.waitForFunction((label) => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === label && b.disabled), disabled);
    await page.unroute("**/api/rpc/");
    await enabled(action);
  }
  assert.deepEqual(errors, []);
  await writeFile(`${dir}/mobile-ready.json`, JSON.stringify({ author: "Codex", checkedAt: new Date().toISOString(), viewport: "390x844 Chromium", checks: ["loaded trading screens without horizontal overflow", "enabled actions become disabled on RPC outage", "actions recover when RPC returns"], physicalIPhoneTested: false }, null, 2));
  console.log("PASS: loaded mobile Spot/Perps screens, enabled → disabled → recovered RPC states; no runtime errors.");
} finally { await browser.close(); }
