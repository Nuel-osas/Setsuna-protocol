import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  encodeAbiParameters,
  encodeEventTopics,
  keccak256,
  parseAbiParameters,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monad } from "viem/chains";
import {
  assetPolicy,
  MONAD_WMON,
  chooseAction,
  executeAction,
  inspectVault,
  MONAD_USDC,
  reconcilePending,
  ReconciliationRequired,
} from "./earn-keeper-core.mjs";

const abi = JSON.parse(
  await readFile(
    new URL("../contracts/abi/SetsunaEarnVault.json", import.meta.url),
    "utf8",
  ),
);
const address = "0x0000000000000000000000000000000000000011";
// Public fixture key, used exclusively for local signing of an unbroadcast transaction.
const account = privateKeyToAccount(`0x${"1".padStart(64, "0")}`);
const observation = { timestamp: 100n, blockNumber: 10n, rates: [1n, 2n] };
const plan = {
  grossMovement: 10n,
  annualIncomeBefore: 100n,
  annualIncomeAfter: 1200n,
  repairsLimits: false,
};

function fixture() {
  const order = [];
  let state;
  let raw;
  const receipt = {
    status: "success",
    blockNumber: 20n,
    gasUsed: 40_000n,
    logs: [
      {
        address,
        topics: encodeEventTopics({ abi, eventName: "RatesObserved" }),
        data: encodeAbiParameters(
          parseAbiParameters("uint256,uint256,uint256"),
          [100n, 1n, 2n],
        ),
      },
    ],
  };
  const client = {
    getGasPrice: async () => 1n,
    simulateContract: async () => {
      order.push("simulate");
      return { result: plan };
    },
    estimateGas: async () => 50_000n,
    getTransactionCount: async () => 7,
    sendRawTransaction: async ({ serializedTransaction }) => {
      order.push("broadcast");
      raw = serializedTransaction;
      assert.equal(state.pending.hash, keccak256(raw));
      assert.equal(state.pending.nonce, 7);
      return keccak256(raw);
    },
    waitForTransactionReceipt: async () => receipt,
    getTransactionReceipt: async () => receipt,
  };
  const wallet = {
    account,
    chain: monad,
    signTransaction: async (request) => {
      order.push("sign");
      return account.signTransaction(request);
    },
  };
  const persist = async (next) => {
    order.push(next.pending ? "persist-pending" : "persist-receipt");
    state = next;
  };
  return {
    client,
    wallet,
    persist,
    order,
    receipt,
    getState: () => state,
    getRaw: () => raw,
  };
}
const execute = (f, extra = {}) =>
  executeAction({
    ...f,
    address,
    abi,
    action: "observeRates",
    chainId: 143,
    maxGasPrice: 2n,
    ...extra,
  });

test("valid rebalance takes priority over an observation that is also due", () => {
  assert.equal(
    chooseAction({
      plan,
      latest: observation,
      timestamp: 1000n,
      observationInterval: 300n,
      minimumGain: 1000n,
    }),
    "rebalance",
  );
});

test("stale/cooldown plan records a due observation; no spam before interval", () => {
  assert.equal(
    chooseAction({
      latest: observation,
      timestamp: 1000n,
      observationInterval: 300n,
      minimumGain: 1000n,
    }),
    "observeRates",
  );
  assert.equal(
    chooseAction({
      latest: observation,
      timestamp: 200n,
      observationInterval: 300n,
      minimumGain: 1000n,
    }),
    null,
  );
});

test("unprofitable normal move is skipped, risk repair can proceed", () => {
  const args = {
    plan: { ...plan, annualIncomeAfter: 99n },
    latest: observation,
    timestamp: 200n,
    observationInterval: 300n,
    minimumGain: 1000n,
  };
  assert.equal(chooseAction(args), null);
  assert.equal(
    chooseAction({ ...args, plan: { ...args.plan, repairsLimits: true } }),
    "rebalance",
  );
});

test("all reads use one block and only known readiness errors are tolerated", async () => {
  const seen = [];
  const vals = {
    initialized: true,
    asset: MONAD_USDC,
    observations: [observation, observation],
    OBSERVATION_INTERVAL: 300n,
    MIN_ANNUAL_GAIN: 1000n,
  };
  const client = {
    getBlock: async () => ({ number: 50n, timestamp: 1000n }),
    readContract: async ({ functionName, blockNumber }) => {
      seen.push(blockNumber);
      if (functionName === "previewRebalance")
        throw { walk: () => ({ data: { errorName: "CooldownActive" } }) };
      return vals[functionName];
    },
  };
  assert.equal(
    (await inspectVault({ client, address, abi })).action,
    "observeRates",
  );
  assert.deepEqual(seen, Array(6).fill(50n));
  client.readContract = async () => {
    throw new Error("RPC unavailable");
  };
  await assert.rejects(
    inspectVault({ client, address, abi }),
    /RPC unavailable/,
  );
});

test("signed hash and nonce are persisted before any broadcast; receipt verified", async () => {
  const f = fixture();
  const report = await execute(f);
  assert.equal(report.action, "confirmed");
  assert.deepEqual(f.order, [
    "simulate",
    "sign",
    "persist-pending",
    "broadcast",
    "persist-receipt",
  ]);
  assert.equal(f.getState().pending, null);
  assert.equal(f.getState().lastReceipt.hash, keccak256(f.getRaw()));
});

test("disk failure prevents broadcasting signed work", async () => {
  const f = fixture();
  f.persist = async () => {
    throw new Error("disk full");
  };
  await assert.rejects(execute(f), /disk full/);
  assert.equal(f.order.includes("broadcast"), false);
});

test("uncertain broadcast retains pending hash and prevents restart resubmission", async () => {
  const f = fixture();
  f.client.sendRawTransaction = async () => {
    throw new Error("response lost");
  };
  await assert.rejects(execute(f), ReconciliationRequired);
  const state = f.getState();
  assert.ok(state.pending.hash);
  f.client.getTransactionReceipt = async () => {
    throw new Error("not found");
  };
  await assert.rejects(
    reconcilePending({
      ...f,
      state,
      abi,
      chainId: 143,
      signer: account.address,
    }),
    ReconciliationRequired,
  );
  assert.equal(f.getState(), state);
});

test("a restart reconciles a mined transaction without broadcasting again", async () => {
  const f = fixture();
  f.client.waitForTransactionReceipt = async () => {
    throw new Error("timeout");
  };
  await assert.rejects(execute(f), ReconciliationRequired);
  const report = await reconcilePending({
    ...f,
    state: f.getState(),
    abi,
    chainId: 143,
    signer: account.address,
  });
  assert.equal(report.action, "confirmed");
  assert.equal(f.order.filter((x) => x === "broadcast").length, 1);
  assert.equal(f.getState().pending, null);
});

test("high gas price, high gas estimate and failed simulation cannot broadcast", async () => {
  for (const mode of ["price", "estimate", "simulation"]) {
    const f = fixture();
    if (mode === "price") f.client.getGasPrice = async () => 3n;
    if (mode === "estimate") f.client.estimateGas = async () => 2_000_000n;
    if (mode === "simulation") {
      f.client.simulateContract = async () => {
        throw new Error("contract reverted");
      };
      await assert.rejects(execute(f), /contract reverted/);
    } else assert.match((await execute(f)).action, /gas-/);
    assert.equal(f.order.includes("broadcast"), false);
  }
});

test("reverted receipt is recorded; success without expected event needs reconciliation", async () => {
  const f = fixture();
  f.receipt.status = "reverted";
  assert.equal((await execute(f)).action, "reverted");
  const missing = fixture();
  missing.receipt.logs = [];
  await assert.rejects(execute(missing), ReconciliationRequired);
  assert.ok(missing.getState().pending);
});

test("keeper gain floor is rechecked on the simulated plan", async () => {
  const f = fixture();
  assert.equal(
    (await execute(f, { action: "rebalance", minimumGain: 2000n })).action,
    "gain-below-minimum",
  );
  assert.equal(f.order.includes("broadcast"), false);
});

test("MON gain uses 18 decimals; USDC keeps 6 and never cross-matches assets", async () => {
  assert.equal(assetPolicy("MON").minimumGain, 1_000_000_000_000_000n);
  assert.equal(assetPolicy("USDC").minimumGain, 1000n);
  assert.throws(() => assetPolicy("MON", "-1"));
  assert.throws(() => assetPolicy("USDC", "0.0000001"));
  assert.throws(() => assetPolicy("AUSD"));
  const vals = {
    initialized: true,
    asset: MONAD_WMON,
    observations: [observation, observation],
    OBSERVATION_INTERVAL: 300n,
    MIN_ANNUAL_GAIN: assetPolicy("MON").minimumGain,
    previewRebalance: { ...plan, annualIncomeAfter: 1_000_000n },
  };
  const client = {
    getBlock: async () => ({ number: 50n, timestamp: 200n }),
    readContract: async ({ functionName }) => vals[functionName],
  };
  await assert.rejects(inspectVault({ client, address, abi }), /USDC vault/);
  const report = await inspectVault({
    client,
    address,
    abi,
    assetSymbol: "MON",
  });
  assert.equal(report.assetSymbol, "MON");
  assert.equal(report.action, null); // A micro-USDC-sized gain must not trigger a MON rebalance.
  vals.previewRebalance.annualIncomeAfter =
    assetPolicy("MON").minimumGain + 100n;
  assert.equal(
    (await inspectVault({ client, address, abi, assetSymbol: "MON" })).action,
    "rebalance",
  );
  vals.asset = MONAD_USDC;
  await assert.rejects(
    inspectVault({ client, address, abi, assetSymbol: "MON" }),
    /MON vault/,
  );
});
