import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { createPublicClient, http, parseAbi } from "viem";

// Browser fault injection only: restore an already-confirmed real local hash as
// unresolved storage, then verify reload cannot silently repeat its transaction.
const url = "http://127.0.0.1:3008";
const d = await (await fetch(`${url}/api/deployment/`)).json();
assert.equal(d.mode, "local"); assert.equal(d.rpc, "http://127.0.0.1:18608"); assert.equal(d.chainId, 31337);
const c = createPublicClient({ transport: http(d.rpc) });
const account = await c.readContract({ address: d.factory, abi: parseAbi(["function accountOf(address) view returns(address)"]), functionName: "accountOf", args: [d.owner] });
const b = await c.getBlockNumber();
const hashFor = async (address) => (await c.getLogs({ address, fromBlock: BigInt(d.startBlock), toBlock: b })).at(-1)?.transactionHash;
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const page = await browser.newPage();
try {
  for (const [tab, contract, key, connect, action, reconcile] of [
    ["spot", d.spot.gateway, `setsuna.spot.pending.${d.chainId}.${d.spot.gateway}.${d.owner}`, "Connect to swap", "Get quote", "Check receipt"],
    ["perps", account, `setsuna.perps.pending.${d.chainId}.${d.factory}.${d.owner}`, "Connect to trade", "Review order", "Check it now"],
  ]) {
    const hash = await hashFor(contract); assert.ok(hash, "Run check:trading first to produce local receipts");
    await page.goto(`${url}/app/?tab=${tab}`);
    await page.evaluate(([k, h]) => localStorage.setItem(k, h), [key, hash]);
    await page.reload();
    await page.getByRole("button", { name: connect, exact: true }).click();
    await page.getByRole("button", { name: /Try the local demo account/ }).click();
    await page.getByRole("button", { name: reconcile, exact: true }).waitFor();
    await page.getByRole("button", { name: action, exact: true }).waitFor();
    assert.ok(await page.getByRole("button", { name: action, exact: true }).isDisabled());
    await page.getByRole("button", { name: reconcile, exact: true }).click();
    await page.getByRole("status").filter({ hasText: /confirmed/i }).waitFor();
    assert.equal(await page.evaluate((k) => localStorage.getItem(k), key), null);
    console.log(`${tab}: unresolved receipt survives reload, blocks writes, reconciles to actual receipt`);
  }
  await writeFile(".local/trading/browser/recovery.json", JSON.stringify({ result: "passed", faultInjection: "browser pending-hash storage; actual confirmed local receipts",
    sections: ["Spot", "Perps"], checkedAt: new Date().toISOString() }, null, 2) + "\n");
} finally { await browser.close(); }
