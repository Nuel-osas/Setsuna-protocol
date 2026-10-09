import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeBook } from "../src/lib/setsuna/market-view.ts";

const packed = (...words) =>
  `0x${words.map((n) => BigInt(n).toString(16).padStart(64, "0")).join("")}`;
test("resting levels use market precisions, sort by side and accumulate base size", () => {
  const result = decodeBook(
    packed(
      42,
      3400000,
      20000000000,
      3420000,
      30000000000,
      0,
      3600000,
      40000000000,
      3500000,
      50000000000,
    ),
    100000000n,
    10000000000n,
  );
  assert.equal(result.block, 42n);
  assert.deepEqual(result.bids, [
    { price: 0.0342, size: 3, total: 3 },
    { price: 0.034, size: 2, total: 5 },
  ]);
  assert.deepEqual(result.asks, [
    { price: 0.035, size: 5, total: 5 },
    { price: 0.036, size: 4, total: 9 },
  ]);
});
test("empty and one-sided books never invent a price level", () => {
  assert.deepEqual(decodeBook(packed(42, 0), 100n, 100n), {
    block: 42n,
    bids: [],
    asks: [],
  });
  assert.deepEqual(decodeBook(packed(42, 0, 350, 200, 0), 100n, 100n).asks, [
    { price: 3.5, size: 2, total: 2 },
  ]);
});
test("malformed data and non-positive precisions fail instead of becoming market data", () => {
  for (const data of ["0x", packed(42, 350), packed(42, 350, 200), "0x123"])
    assert.throws(() => decodeBook(data, 100n, 100n));
  assert.throws(() => decodeBook(packed(42, 0), 0n, 100n));
  assert.throws(() => decodeBook(packed(42, 0), 100n, -1n));
});
