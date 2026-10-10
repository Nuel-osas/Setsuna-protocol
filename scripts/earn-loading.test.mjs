import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { encodeAbiParameters, toFunctionSelector } from "viem";
import { createReadCache } from "../src/lib/setsuna/read-cache.ts";
import { clientFor } from "../src/lib/setsuna/rpc-client.ts";
import {
  readEarnSummary,
  cachedEarnSummary,
  invalidateEarnSummary,
} from "../src/lib/setsuna/earn-summary.ts";

test("concurrent reads share work, expire, and isolate cache keys", async () => {
  let now = 100,
    loads = 0;
  const cache = createReadCache(10, 2, () => now);
  const load = async () => ++loads;
  assert.deepEqual(
    await Promise.all([cache.read("A", load), cache.read("A", load)]),
    [1, 1],
  );
  assert.equal(await cache.read("B", load), 2);
  assert.equal(await cache.read("A", load), 1);
  now += 10;
  assert.equal(cache.peek("A"), undefined);
  assert.equal(await cache.read("A", load), 3);
  await cache.read("C", load);
  assert.equal(cache.peek("B"), undefined, "Cache remains bounded");
});

test("failures are retried and invalidation prevents an old read overwriting new data", async () => {
  const cache = createReadCache(10_000);
  await assert.rejects(
    cache.read("A", async () => {
      throw new Error("offline");
    }),
    /offline/,
  );
  assert.equal(await cache.read("A", async () => "recovered"), "recovered");
  let resolveOld;
  const old = cache.read(
    "B",
    () =>
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
  );
  await Promise.resolve();
  cache.invalidate("B");
  assert.equal(await cache.read("B", async () => "fresh"), "fresh");
  resolveOld("stale");
  await old;
  assert.equal(cache.peek("B"), "fresh");
});

const address = (n) => `0x${n.toString(16).padStart(40, "0")}`;
async function rpcServer(t, handler) {
  const batches = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body);
    const calls = Array.isArray(payload) ? payload : [payload];
    batches.push(calls);
    const replies = calls
      .map((call) => ({ jsonrpc: "2.0", id: call.id, ...handler(call) }))
      .reverse();
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(Array.isArray(payload) ? replies : replies[0]));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  return { rpc: `http://127.0.0.1:${server.address().port}`, batches };
}
const deployment = (rpc) => ({
  rpc,
  chainId: 31337,
  name: "Test",
  mode: "local",
  collateral: address(50),
  exchange: address(51),
  perpId: 1,
  earnMON: {
    vault: address(1),
    gateway: address(2),
    asset: address(3),
    adapters: [address(4), address(5)],
    startBlock: "1",
    forkBlock: "1",
  },
});

test("transport splits batches at 20, matches unordered replies, and isolates per-call errors", async (t) => {
  const { rpc, batches } = await rpcServer(t, (call) =>
    call.params[0] === 21
      ? { error: { code: -32000, message: "One failed read" } }
      : { result: call.params[0] },
  );
  const d = deployment(rpc),
    client = clientFor(d);
  assert.equal(clientFor({ ...d }), client);
  assert.notEqual(clientFor({ ...d, chainId: 143 }), client);
  const replies = await Promise.allSettled(
    Array.from({ length: 45 }, (_, n) =>
      client.request({ method: "test_echo", params: [n] }),
    ),
  );
  assert.deepEqual(
    batches.map((batch) => batch.length),
    [20, 20, 5],
  );
  for (const [n, reply] of replies.entries()) {
    assert.equal(reply.status, n === 21 ? "rejected" : "fulfilled");
    if (reply.status === "fulfilled") assert.equal(reply.value, n);
  }
});

test("public figures use one block, preserve integer APR math, and invalidate after changes", async (t) => {
  const unit = 10n ** 18n;
  let failRate = false,
    nav = 100n * unit,
    healthy = true;
  const uint = (value) => ({
    result: encodeAbiParameters([{ type: "uint256" }], [value]),
  });
  const { rpc, batches } = await rpcServer(t, (call) => {
    if (call.method === "eth_chainId") return { result: "0x7a69" };
    if (call.method === "eth_getBlockByNumber")
      return {
        result: { number: "0x64", timestamp: "0x1234", transactions: [] },
      };
    assert.equal(call.method, "eth_call");
    assert.equal(
      call.params[1],
      "0x64",
      "All contract reads use the same block",
    );
    const { data, to } = call.params[0];
    const selector = data.slice(0, 10);
    if (selector === toFunctionSelector("accounting()"))
      return {
        result: encodeAbiParameters(
          [{ type: "uint256" }, { type: "bool" }],
          [nav, healthy],
        ),
      };
    if (selector === toFunctionSelector("convertToAssets(uint256)"))
      return uint(2n * unit);
    if (selector === toFunctionSelector("balanceOf(address)")) {
      assert.equal(
        data.slice(-40),
        address(1).slice(2),
        "No wallet balance read enters the public cache",
      );
      return uint(10n * unit);
    }
    if (selector === toFunctionSelector("totalAssets()"))
      return uint((to === address(4) ? 60n : 30n) * unit);
    if (selector === toFunctionSelector("supplyApr(int256)"))
      return failRate
        ? { error: { code: -32000, message: "Rate unavailable" } }
        : uint(((to === address(4) ? 5n : 10n) * unit) / 100n);
    throw new Error(`Unexpected selector ${selector}`);
  });
  const d = deployment(rpc);
  const [first, shared] = await Promise.all([
    readEarnSummary(d, "MON"),
    readEarnSummary(d, "MON"),
  ]);
  assert.equal(first, shared);
  assert.equal(first.block, 100n);
  assert.equal(first.nav, 100n * unit);
  assert.equal(
    first.blendedApr,
    (6n * unit) / 100n,
    "Weighted APR includes zero-yield cash",
  );
  assert.equal(first.shareValue, 2n * unit);
  const count = batches.length;
  await readEarnSummary(d, "MON");
  assert.equal(batches.length, count);
  assert.equal(
    cachedEarnSummary(
      { ...d, earnMON: { ...d.earnMON, vault: address(9) } },
      "MON",
    ),
    undefined,
  );
  assert.equal(
    cachedEarnSummary({ ...d, rpc: `${rpc}/other` }, "MON"),
    undefined,
  );
  assert.equal(cachedEarnSummary({ ...d, chainId: 143 }, "MON"), undefined);
  invalidateEarnSummary(d, "MON");
  failRate = true;
  await assert.rejects(readEarnSummary(d, "MON"));
  assert.equal(
    cachedEarnSummary(d, "MON"),
    undefined,
    "Never invent a zero rate after failure",
  );
  failRate = false;
  nav = 0n;
  healthy = false;
  const updated = await readEarnSummary(d, "MON");
  assert.equal(updated.nav, 0n);
  assert.equal(updated.blendedApr, 0n);
  assert.equal(updated.healthy, false, "Unhealthy accounting remains explicit");
});

test("a wrong network is rejected before any vault reads and is not cached", async (t) => {
  const { rpc, batches } = await rpcServer(t, (call) => ({
    result:
      call.method === "eth_chainId"
        ? "0x8f"
        : { number: "0x64", timestamp: "0x1234", transactions: [] },
  }));
  const d = deployment(rpc);
  await assert.rejects(readEarnSummary(d, "MON"), /Wrong network/);
  assert.equal(cachedEarnSummary(d, "MON"), undefined);
  assert.ok(batches.flat().every((call) => call.method !== "eth_call"));
});
