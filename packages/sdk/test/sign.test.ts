// Signing links, offline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SIGN_PAGE, signUrl } from "../src/index.js";

const OWNER = "0x6915aEf0947F4daD61aeF39Fe0f546A03190c92C";

test("a deposit link carries only the request", () => {
  const url = new URL(signUrl({ vault: "setsUSDC", action: "deposit", amount: "50", owner: OWNER }));
  assert.equal(`${url.origin}${url.pathname}`, SIGN_PAGE);
  assert.deepEqual(Object.fromEntries(url.searchParams), { vault: "setsUSDC", action: "deposit", amount: "50", owner: OWNER });
});

test("withdraw links take an amount, shares or everything", () => {
  assert.match(signUrl({ vault: "setsMON", action: "withdraw", all: true }), /\?vault=setsMON&action=withdraw&all=true$/);
  assert.match(signUrl({ vault: "setsMON", action: "withdraw", shares: "1.5" }), /&shares=1\.5$/);
  assert.match(signUrl({ vault: "setsUSDC", action: "withdraw", amount: "2" }), /&amount=2$/);
});

test("bad requests are refused before a link is made", () => {
  assert.throws(() => signUrl({ vault: "setsUSDC", action: "deposit", amount: "-1" }), /positive/);
  assert.throws(() => signUrl({ vault: "setsUSDC", action: "deposit", amount: "1e3" }), /positive/);
  assert.throws(() => signUrl({ vault: "setsUSDC", action: "deposit", amount: "1", owner: "0x123" }), /0x address/);
  assert.throws(() => signUrl({ vault: "setsETH" as "setsUSDC", action: "deposit", amount: "1" }), /Unknown vault/);
});

test("another signing page can be used", () => {
  assert.match(signUrl({ vault: "setsUSDC", action: "deposit", amount: "1" }, "http://localhost:4173/sign"), /^http:\/\/localhost:4173\/sign\?/);
});
