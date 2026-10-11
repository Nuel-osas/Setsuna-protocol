import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { mainnetDeployment } from "../src/lib/setsuna/mainnet-deployment.ts";
import { venues } from "../src/lib/setsuna/venues.ts";
import { keeperNetwork } from "./earn-keeper-network.mjs";

function mockEnv(t, key, value) {
  const old = process.env[key];
  process.env[key] = value;
  t.after(() => {
    if (old === undefined) delete process.env[key];
    else process.env[key] = old;
  });
}

const address = (n) => `0x${n.toString(16).padStart(40, "0")}`;
const earn = {
  chainId: 143,
  asset: venues.usdc,
  monAsset: venues.wmon,
  deployedAtBlock: 112553267,
  vault: address(1),
  monVault: address(2),
  monGateway: address(3),
  adapters: [4, 5, 6, 7, 8].map(address),
  monAdapters: [9, 10].map(address),
};
const trading = {
  chainId: 143,
  spotMarket: venues.market,
  usdc: venues.usdc,
  exchange: venues.exchange,
  collateral: venues.collateral,
  deployedAtBlock: 112443702,
  perplFactory: address(11),
  spotGateway: address(12),
  spotOrdersFactory: address(13),
};

test("Earn and trading retain their mainnet contracts and contain no fork fields", () => {
  const d = mainnetDeployment(JSON.stringify(earn), JSON.stringify(trading));
  assert.equal(d.chainId, 143);
  assert.equal(d.mode, "mainnet");
  assert.equal(d.earnUSDC.vault, earn.vault);
  assert.equal(d.earnMON.vault, earn.monVault);
  assert.equal(d.factory, trading.perplFactory);
  assert.equal(d.spot.ordersFactory, trading.spotOrdersFactory);
  assert.equal(d.trading.rpc, "https://rpc2.monad.xyz");
  assert.equal(d.earnMainnet.rpc, "https://rpc2.monad.xyz");
  assert.doesNotMatch(
    JSON.stringify(d),
    /forkBlock|perplFixture|faucet|31337|api\/rpc/,
  );
});

test("missing or invalid mainnet configuration exposes no signing contracts", (t) => {
  mockEnv(
    t,
    "SETSUNA_DEMO_MANIFEST",
    JSON.stringify({ mode: "HOSTED_FORK_ONLY", chainId: 31337 }),
  );
  mockEnv(t, "SETSUNA_DEMO_RPC_URL", "http://127.0.0.1:8545");
  mockEnv(t, "SETSUNA_LOCAL_USDC", "5");
  for (const [a, b] of [
    ["", ""],
    ["{", "{"],
    [
      JSON.stringify({ ...earn, chainId: 31337 }),
      JSON.stringify({ ...trading, chainId: 31337 }),
    ],
  ]) {
    const d = mainnetDeployment(a, b);
    assert.equal(d.mode, "preview");
    assert.equal(d.chainId, 143);
    for (const key of ["factory", "spot", "earnMON", "earnUSDC", "faucet"])
      assert.equal(d[key], undefined);
  }
});

test("invalid configuration disables only the affected product", () => {
  const earnOnly = mainnetDeployment(JSON.stringify(earn), "{");
  assert.ok(earnOnly.earnMON && earnOnly.earnUSDC);
  assert.equal(earnOnly.factory, undefined);
  const tradeOnly = mainnetDeployment(
    JSON.stringify({ ...earn, asset: venues.collateral }),
    JSON.stringify(trading),
  );
  assert.ok(tradeOnly.factory && tradeOnly.spot);
  assert.equal(tradeOnly.earnUSDC, undefined);
  assert.equal(tradeOnly.earnMON, undefined);
});

test("retired local RPC override cannot redirect mainnet trading", (t) => {
  mockEnv(t, "SETSUNA_MAINNET_TRADING_RPC", "http://127.0.0.1:8545");
  const d = mainnetDeployment("", JSON.stringify(trading));
  assert.equal(d.rpc, "https://rpc2.monad.xyz");
});

test("keeper rejects demo manifests and non-mainnet chain IDs before execution", async (t) => {
  let chainId = "0x7a69";
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const call = JSON.parse(body);
    assert.equal(call.method, "eth_chainId");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, result: chainId }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  const rpc = `http://127.0.0.1:${server.address().port}`;
  await assert.rejects(keeperNetwork({ rpc }), /chain ID 143/);
  await assert.rejects(
    keeperNetwork({ rpc, manifest: {} }),
    /no longer supported/,
  );
  chainId = "0x8f";
  const network = await keeperNetwork({ rpc });
  assert.equal(network.chain.id, 143);
});
