// Reads Monad mainnet and simulates prepared transactions with eth_call. Sends nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicClient, decodeFunctionData, http, parseUnits } from "viem";
import { createSetsuna, monad, monGatewayAbi, vaultAbi, VAULTS } from "../src/index.js";

const setsuna = createSetsuna();
const chain = createPublicClient({ chain: monad, transport: http("https://rpc2.monad.xyz") });
// Setsuna's deployer holds a launch position in both vaults, so it can stand in for a depositor.
const HOLDER = "0x6915aEf0947F4daD61aeF39Fe0f546A03190c92C";

test("both vaults read healthy, and their allocations plus idle cash add up to net assets", async () => {
  const vaults = await setsuna.getVaults();
  assert.deepEqual(vaults.map((v) => v.id), ["setsUSDC", "setsMON"]);
  for (const v of vaults) {
    assert.equal(v.healthy, true);
    assert.equal(v.allocations.length, VAULTS[v.id].venues.length);
    const placed = v.allocations.reduce((s, a) => s + BigInt(a.assets.raw), 0n) + BigInt(v.idle.assets.raw);
    const nav = BigInt(v.netAssets.raw);
    // Accounting caches positions, so allow a hair of drift from accrued interest.
    assert.ok(placed >= (nav * 999n) / 1000n && placed <= (nav * 1001n) / 1000n, `${v.id}: ${placed} vs ${nav}`);
    assert.ok(Number(v.sharePrice.formatted) >= 1, `${v.id} share price ${v.sharePrice.formatted}`);
    assert.equal(v.performanceFeePct, 2);
    assert.ok(v.netAprPct <= v.baseAprPct);
  }
});

test("markets list every venue with a rate", async () => {
  const markets = await setsuna.getMarkets();
  assert.equal(markets.length, 7);
  assert.ok(markets.every((m) => m.aprPct >= 0 && m.aprPct < 100));
});

test("rules match the deployed constants", async () => {
  const r = await setsuna.getRules("setsUSDC");
  assert.equal(r.parameters.cashBufferPct, 10);
  assert.equal(r.parameters.marketCapPct, 60);
  assert.equal(r.parameters.marketCashCapPct, 10);
  assert.equal(r.parameters.moveLimitPct, 10);
  assert.equal(r.parameters.cooldownMinutes, 10);
  assert.equal(r.parameters.performanceFeePct, 2);
  const m = await setsuna.getRules("setsMON");
  assert.equal(m.parameters.marketCashCapPct, null);
  assert.ok(m.rules.some((line) => line.includes("cannot move funds")));
});

test("a position shows shares, their value and the wallet", async () => {
  const p = await setsuna.getPosition(HOLDER);
  const usdc = p.vaults.find((v) => v.vault === "setsUSDC")!;
  assert.ok(Number(usdc.assets.formatted) > 1);
  assert.ok(Number(p.wallet.MON.formatted) > 0);
});

test("a deposit over the cap is refused with a reason", async () => {
  const q = await setsuna.quoteDeposit("setsUSDC", "1000000");
  assert.equal(q.ok, false);
  assert.match(q.problems.join(" "), /at most .* USDC more before its cap/);
  await assert.rejects(setsuna.prepareDeposit("setsUSDC", "1000000", HOLDER), /cap/);
});

test("a prepared MON deposit simulates on mainnet and mints at least the minimum", async () => {
  const prepared = await setsuna.prepareDeposit("setsMON", "1", HOLDER);
  assert.equal(prepared.transactions.length, 1);
  const tx = prepared.transactions[0];
  assert.equal(tx.to, VAULTS.setsMON.gateway);
  assert.equal(tx.value, parseUnits("1", 18).toString());
  const decoded = decodeFunctionData({ abi: monGatewayAbi, data: tx.data });
  assert.equal(decoded.functionName, "depositMON");
  const { data } = await chain.call({ account: HOLDER, to: tx.to, data: tx.data, value: BigInt(tx.value) });
  const minted = BigInt(data!);
  assert.ok(minted >= BigInt(prepared.minimum.raw), `minted ${minted} < minimum ${prepared.minimum.raw}`);
});

test("a prepared setsUSDC withdrawal of everything simulates and returns at least the minimum", async () => {
  const prepared = await setsuna.prepareWithdraw("setsUSDC", HOLDER, { all: true });
  assert.equal(prepared.transactions.length, 1);
  const tx = prepared.transactions[0];
  const decoded = decodeFunctionData({ abi: vaultAbi, data: tx.data });
  assert.equal(decoded.functionName, "redeemWithMinAssets");
  const { data } = await chain.call({ account: HOLDER, to: tx.to, data: tx.data });
  assert.ok(BigInt(data!) >= BigInt(prepared.minimum.raw));
});

test("a prepared setsMON withdrawal approves the gateway first, then redeems to native MON", async () => {
  const prepared = await setsuna.prepareWithdraw("setsMON", HOLDER, { amount: "1" });
  const last = prepared.transactions.at(-1)!;
  assert.equal(last.to, VAULTS.setsMON.gateway);
  assert.equal(decodeFunctionData({ abi: monGatewayAbi, data: last.data }).functionName, "redeemMON");
  if (prepared.transactions.length === 2) {
    const approve = decodeFunctionData({ abi: vaultAbi, data: prepared.transactions[0].data });
    assert.equal(approve.functionName, "approve");
    assert.equal((approve.args as readonly unknown[])[1], BigInt(prepared.expected.shares.raw));
  }
});

test("bad input is rejected in plain words", async () => {
  await assert.rejects(setsuna.getPosition("not-an-address"), /is not an address/);
  await assert.rejects(setsuna.quoteDeposit("setsBTC" as never, "1"), /Unknown vault/);
  await assert.rejects(setsuna.quoteDeposit("setsUSDC", "0"), /positive amount/);
});
