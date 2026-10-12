import assert from "node:assert/strict";
import { test } from "node:test";
import { chartSamples, sampleBlocks } from "../src/lib/setsuna/earn-history.ts";

const point = (block, price) => ({
  block,
  timestamp: Number(block),
  price,
  assets: price,
});
const sample = (block, supply, price = 10n ** 18n, healthy = true) => ({
  healthy,
  supply,
  point: point(block, price),
});

test("sample blocks span start to head evenly and always include both ends", () => {
  const blocks = sampleBlocks(112_600_487n, 112_811_615n, 13);
  assert.equal(blocks.length, 13);
  assert.equal(blocks[0], 112_600_487n);
  assert.equal(blocks.at(-1), 112_811_615n);
  assert.ok(blocks.every((b, i) => i === 0 || b > blocks[i - 1]));
});

test("a vault younger than the sample count does not repeat blocks", () => {
  assert.deepEqual(sampleBlocks(10n, 13n, 13), [10n, 11n, 12n, 13n]);
  assert.deepEqual(sampleBlocks(10n, 10n, 13), [10n]);
});

test("unreadable and unhealthy samples are counted, not charted", () => {
  const { points, missing } = chartSamples([
    sample(1n, 5n),
    undefined,
    sample(3n, 5n, 10n ** 18n, false),
    sample(4n, 5n),
  ]);
  assert.deepEqual(
    points.map((p) => p.block),
    [1n, 4n],
  );
  assert.equal(missing, 2);
});

test("an emptied vault starts a new period instead of charting a unit rescale", () => {
  // Full exit leaves dust; the next deposit mints at a different unit price.
  const { points } = chartSamples([
    sample(506n, 10n, 10n ** 18n),
    sample(510n, 0n),
    sample(524n, 5n, 2n * 10n ** 18n),
    sample(555n, 5n, 2n * 10n ** 18n + 1n),
  ]);
  assert.deepEqual(
    points.map((p) => p.block),
    [524n, 555n],
  );
});
