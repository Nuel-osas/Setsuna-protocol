import { test } from "node:test";
import assert from "node:assert/strict";
import { demoConfig, validRPCPayload } from "../src/lib/setsuna/demo-config.ts";
const address = "0x1111111111111111111111111111111111111111";
const manifest = {
  mode: "HOSTED_FORK_ONLY",
  syntheticFunding: true,
  forkChainId: 143,
  chainId: 31337,
  startBlock: "100",
  forkBlock: "99",
  perplFactory: address,
  spotGateway: address,
  vault: address,
  gateway: address,
  neverland: address,
  euler: address,
  privateKey: "never-forward-this",
  rpc: "never-forward-this",
};
test("hosted config publishes only reviewed fields and its restricted RPC", () => {
  const d = demoConfig(
    JSON.stringify(manifest),
    "https://setsuna.example/api/rpc/",
  );
  assert.equal(d.mode, "demo");
  assert.equal(d.rpc, "https://setsuna.example/api/rpc/");
  assert.equal(JSON.stringify(d).includes("never-forward-this"), false);
});
test("live chains, invalid contracts, and non-demo manifests fail closed", () => {
  for (const patch of [
    { chainId: 143 },
    { chainId: 1 },
    { chainId: 10143 },
    { syntheticFunding: false },
    { mode: "MAINNET" },
    { perplFactory: "0x" },
    { forkBlock: "-1" },
    { gateway: "0x0000000000000000000000000000000000000000" },
  ])
    assert.throws(() =>
      demoConfig(
        JSON.stringify({ ...manifest, ...patch }),
        "https://setsuna.example/api/rpc/",
      ),
    );
});
test("public RPC cannot impersonate accounts or mutate fork state with administrator methods", () => {
  const r = (method) => ({ jsonrpc: "2.0", id: 1, method, params: [] });
  for (const method of [
    "eth_sendTransaction",
    "eth_sign",
    "personal_unlockAccount",
    "tenderly_setBalance",
    "tenderly_setStorageAt",
    "anvil_setBalance",
    "evm_revert",
    "eth_accounts",
  ])
    assert.equal(validRPCPayload(r(method)), false, method);
  assert.equal(validRPCPayload(r("eth_call")), true);
  assert.equal(validRPCPayload(r("eth_sendRawTransaction")), true);
  assert.equal(
    validRPCPayload([r("eth_chainId"), r("eth_sendTransaction")]),
    false,
  );
  assert.equal(
    validRPCPayload(Array.from({ length: 21 }, () => r("eth_chainId"))),
    false,
  );
  assert.equal(validRPCPayload([]), false);
});
test("wallet clients may omit params for JSON-RPC calls with no arguments", () => {
  assert.equal(
    validRPCPayload({ jsonrpc: "2.0", id: 1, method: "eth_chainId" }),
    true,
  );
  assert.equal(
    validRPCPayload({ jsonrpc: "2.0", id: 2, method: "eth_gasPrice" }),
    true,
  );
  assert.equal(
    validRPCPayload({ jsonrpc: "2.0", id: 3, method: "eth_accounts" }),
    false,
  );
  assert.equal(
    validRPCPayload({
      jsonrpc: "2.0",
      id: 4,
      method: "eth_chainId",
      params: null,
    }),
    false,
  );
});

// Both immutable deployments remain valid; a partial or duplicated fifth adapter does not.
const { parseUSDCEarn, validateUSDCEarn } =
  await import("../src/lib/setsuna/usdc-deployment.ts");
const usdcFixture = {
  vault: address,
  asset: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
  adapters: [2, 3, 4, 5, 6].map((n) => "0x" + String(n).repeat(40)),
  forkBlock: "111560409",
  startBlock: "111560412",
};
test("combined manifest keeps both Earn vaults on the same source fork and strips private fields", () => {
  const combined = {
    ...manifest,
    forkBlock: usdcFixture.forkBlock,
    earnUSDC: { ...usdcFixture, privateKey: "never-forward-this" },
  };
  const d = demoConfig(
    JSON.stringify(combined),
    "https://setsuna.example/api/rpc/",
  );
  assert.equal(d.earnUSDC.adapters.length, 5);
  assert.equal(d.earnUSDC.forkBlock, d.earnMON.forkBlock);
  assert.equal(JSON.stringify(d).includes("never-forward-this"), false);
  assert.throws(() =>
    demoConfig(JSON.stringify({ ...combined, forkBlock: "110418863" }), d.rpc),
  );
});

const { demoForkProfiles, reviewedDemoFork } =
  await import("./demo-fork-profiles.mjs");
test("price fixtures require a reviewed source block/hash and synthetic demo chain", () => {
  for (const p of Object.values(demoForkProfiles)) {
    const m = {
      chainId: 31337,
      syntheticFunding: true,
      forkBlock: String(p.block),
      forkHash: p.hash,
    };
    assert.equal(reviewedDemoFork(m), p);
    for (const patch of [
      { chainId: 143 },
      { syntheticFunding: false },
      { forkBlock: "1" },
      { forkHash: "0x" + "00".repeat(32) },
    ])
      assert.throws(() => reviewedDemoFork({ ...m, ...patch }));
  }
});
test("USDC accepts four and five distinct adapters, rejects invalid counts and duplicates", () => {
  for (const n of [4, 5])
    assert.equal(
      parseUSDCEarn({
        ...usdcFixture,
        adapters: usdcFixture.adapters.slice(0, n),
      }).adapters.length,
      n,
    );
  for (const adapters of [
    usdcFixture.adapters.slice(0, 3),
    [...usdcFixture.adapters, "0x" + "7".repeat(40)],
    [...usdcFixture.adapters.slice(0, 4), usdcFixture.adapters[0]],
  ])
    assert.throws(() => parseUSDCEarn({ ...usdcFixture, adapters }));
});
test("USDC validates every adapter including the fifth and rejects count mismatch", async () => {
  let count = 5n,
    broken = false;
  const client = {
    async readContract({ address: at, functionName, args }) {
      if (functionName === "asset") return usdcFixture.asset;
      if (functionName === "initialized") return true;
      if (functionName === "destinationCount") return count;
      if (functionName === "adapters")
        return usdcFixture.adapters[Number(args[0])];
      if (functionName === "vault")
        return broken && at === usdcFixture.adapters[4]
          ? usdcFixture.adapters[0]
          : usdcFixture.vault;
      throw new Error("unexpected read");
    },
  };
  await validateUSDCEarn(client, usdcFixture);
  count = 4n;
  await assert.rejects(validateUSDCEarn(client, usdcFixture));
  count = 5n;
  broken = true;
  await assert.rejects(validateUSDCEarn(client, usdcFixture));
});
