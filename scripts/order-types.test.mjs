import { test } from "node:test";
import assert from "node:assert/strict";
import { zeroAddress } from "viem";
import {
  marketPriceBound,
  perpsBalances,
  slippageBasisPoints,
} from "../src/lib/setsuna/order-types.ts";
test("Perps order locks reduce free collateral without inventing extra account value", () => {
  assert.deepEqual(perpsBalances(100n, 25n), {
    balance: 100n,
    locked: 25n,
    free: 75n,
  });
  assert.deepEqual(perpsBalances(100n, 120n), {
    balance: 100n,
    locked: 120n,
    free: 0n,
  });
});
import { spotLimitAmounts } from "../src/lib/setsuna/spot-orders.ts";
const params = [
  100_000_000,
  10_000_000_000n,
  zeroAddress,
  18n,
  "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
  6n,
  100,
  2_000_000_000_000n,
  2_000_000_000_000_000_000n,
  0n,
  0n,
];
test("market bounds never exceed the selected tolerance, including sub-tick rounding", () => {
  assert.equal(marketPriceBound(1001n, true, 50), 1006n);
  assert.equal(marketPriceBound(1001n, false, 50), 996n);
  assert.equal(marketPriceBound(1n, false, 50), 1n);
  for (const bps of [0, 501, NaN, 1.2])
    assert.throws(() => marketPriceBound(100n, true, bps));
  assert.throws(() => marketPriceBound(0n, true, 50));
  assert.equal(slippageBasisPoints("0.29"), 29);
  assert.equal(slippageBasisPoints("5"), 500);
  for (const input of ["0", "5.01", "0.001", "1e-2", "", "-1"])
    assert.throws(() => slippageBasisPoints(input));
});
test("Kuru limit units preserve price and size and use free balance before wallet funding", () => {
  const buy = spotLimitAmounts("200", "0.035", true, params, 2_000_000n);
  assert.equal(buy.size, 2_000_000_000_000n);
  assert.equal(buy.price, 3_500_000);
  assert.equal(buy.required, 7_000_000n);
  assert.equal(buy.funding, 5_000_000n);
  assert.equal(
    spotLimitAmounts("200", "0.035", true, params, 10_000_000n).funding,
    0n,
  );
  assert.equal(
    spotLimitAmounts("200", "0.035", false, params, 50n * 10n ** 18n).funding,
    150n * 10n ** 18n,
  );
  assert.equal(
    spotLimitAmounts("200.0000000001", "0.035", true, params, 0n).required,
    7_000_001n,
  );
});
test("invalid precision, minimum size and price ticks are refused without rounding orders", () => {
  for (const [size, price] of [
    ["100", "0.03"],
    ["200", "0.0350001"],
    ["200.00000000001", "0.03"],
    ["200", "50"],
    ["-1", "0.03"],
  ])
    assert.throws(() => spotLimitAmounts(size, price, true, params, 0n));
});
