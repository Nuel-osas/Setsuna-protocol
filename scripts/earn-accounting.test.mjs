import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcileEarn } from "../src/lib/setsuna/earn-accounting.ts";
const owner = "0x123",
  zero = "0x0000000000000000000000000000000000000000";
const deposit = { kind: "deposit", assets: 1000n, shares: 500n };
test("earnings combine realised withdrawals and current underlying value", () => {
  const result = reconcileEarn(
    [deposit, { kind: "withdraw", assets: 450n, shares: 200n }],
    owner,
    300n,
    650n,
    true,
  );
  assert.equal(result.earnings, 100n);
  assert.equal(result.deposited, 1000n);
  assert.equal(result.withdrawn, 450n);
});
test("losses remain negative; fully exited positions retain realised earnings", () => {
  assert.equal(
    reconcileEarn([deposit], owner, 500n, 990n, true).earnings,
    -10n,
  );
  assert.equal(
    reconcileEarn(
      [deposit, { kind: "withdraw", assets: 1050n, shares: 500n }],
      owner,
      0n,
      0n,
      true,
    ).earnings,
    50n,
  );
});
test("external transfers hide earnings even when balances net to zero", () => {
  const flows = [
    deposit,
    { kind: "transfer", from: owner, to: "0xabc", shares: 10n },
    { kind: "transfer", from: "0xabc", to: owner, shares: 10n },
  ];
  assert.equal(
    reconcileEarn(flows, owner, 500n, 1050n, true).earnings,
    undefined,
  );
  assert.match(
    reconcileEarn(flows, owner, 500n, 1050n, true).reason,
    /Transferred/,
  );
});
test("mint, burn, self and zero transfers are not unknown cost-basis events", () => {
  const flows = [
    deposit,
    { kind: "transfer", from: zero, to: owner, shares: 500n },
    { kind: "transfer", from: owner, to: owner, shares: 1n },
    { kind: "transfer", from: owner, to: "0xabc", shares: 0n },
  ];
  assert.equal(reconcileEarn(flows, owner, 500n, 1050n, true).earnings, 50n);
});
test("partial or mismatched history and unknown NAV do not produce false profit", () => {
  assert.equal(
    reconcileEarn([deposit], owner, 500n, 1100n, false).earnings,
    undefined,
  );
  assert.equal(
    reconcileEarn([deposit], owner, 500n, 1100n, false).deposited,
    undefined,
  );
  assert.equal(
    reconcileEarn([deposit], owner, 499n, 1100n, true).earnings,
    undefined,
  );
  assert.equal(
    reconcileEarn([deposit], owner, 500n, undefined, true).earnings,
    undefined,
  );
});
