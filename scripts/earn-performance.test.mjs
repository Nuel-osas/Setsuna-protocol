import assert from "node:assert/strict";
import { test } from "node:test";
import {
  downsample,
  replayAccounting,
  sharePrice,
} from "../src/lib/setsuna/earn-history.ts";

const Z = "0x0000000000000000000000000000000000000000";
const U = "0x00000000000000000000000000000000000000aa";
const unit = 10n ** 24n; // setsMON: 18 asset decimals + 6 offset

test("share price matches OpenZeppelin convertToAssets with a 6-decimal offset", () => {
  // Hosted setsMON at the head on 11 October: convertToAssets(1e24).
  assert.equal(
    sharePrice(10002250100710831588n, 5n * 10n ** 24n, unit),
    2000450020142166317n,
  );
  assert.equal(
    sharePrice(0n, 0n, unit),
    10n ** 18n,
    "1 setsMON = 1 MON when empty",
  );
});

test("deposit NAV pairs with pre-mint supply; withdraw NAV with post-burn supply", () => {
  const points = replayAccounting(
    [
      { block: 1n, index: 3, from: Z, to: U, value: 10n * unit },
      { block: 3n, index: 1, from: U, to: Z, value: 4n * unit },
    ],
    [
      // deposit: AccountingUpdated precedes the mint in the same transaction
      { block: 1n, index: 1, assets: 0n },
      { block: 2n, index: 0, assets: 11n * 10n ** 18n },
      // withdraw: AccountingUpdated follows the burn
      { block: 3n, index: 4, assets: 66n * 10n ** 17n },
    ],
    unit,
  );
  assert.deepEqual(
    points.map((p) => p.block),
    [2n, 3n],
    "No price while the vault has no shares",
  );
  assert.equal(points[0].price, sharePrice(11n * 10n ** 18n, 10n * unit, unit));
  assert.equal(points[1].price, sharePrice(66n * 10n ** 17n, 6n * unit, unit));
  assert.ok(points[1].price === points[0].price, "A withdrawal is not yield");
});

test("an emptied vault starts a new period instead of charting a unit rescale", () => {
  // The 8 October hosted sequence: full exit leaves 1 wei, the next 10 MON mints 5 setsMON.
  const points = replayAccounting(
    [
      { block: 506n, index: 4, from: Z, to: U, value: 10n * unit },
      { block: 510n, index: 9, from: U, to: Z, value: 10n * unit },
      { block: 524n, index: 4, from: Z, to: U, value: 5n * unit },
    ],
    [
      { block: 507n, index: 14, assets: 10n ** 19n - 1n },
      { block: 524n, index: 2, assets: 1n },
      { block: 555n, index: 0, assets: 10n ** 19n + 1n },
    ],
    unit,
  );
  assert.deepEqual(
    points.map((p) => p.block),
    [555n],
  );
  assert.ok(points[0].price > 19n * 10n ** 17n);
});

test("downsampling keeps the first and last points and bounds the count", () => {
  const items = Array.from({ length: 100 }, (_, i) => i);
  const picked = downsample(items, 12);
  assert.equal(picked.length, 12);
  assert.equal(picked[0], 0);
  assert.equal(picked.at(-1), 99);
  assert.deepEqual(downsample([1, 2], 12), [1, 2]);
});
