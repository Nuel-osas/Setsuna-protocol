import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BaseError,
  ContractFunctionRevertedError,
  encodeErrorResult,
  parseAbi,
} from "viem";
import {
  earnDecision,
  earnDecisionErrors,
  earnPlanFailure,
} from "../src/lib/setsuna/earn-decision.ts";

const state = () => ({
  healthy: true,
  block: 20n,
  timestamp: 2000n,
  idle: 100000000n,
  nav: 100000000n,
  lastRebalance: 1900n,
  cooldown: 600n,
  minAnnualGain: 1000n,
  rates: [40000000000000000n, 30000000000000000n],
  observations: [
    {
      timestamp: 1600n,
      blockNumber: 10n,
      rates: [40000000000000000n, 30000000000000000n],
    },
    {
      timestamp: 1900n,
      blockNumber: 15n,
      rates: [40000000000000000n, 30000000000000000n],
    },
  ],
  planReason: "",
  plan: {
    nav: 100000000n,
    positions: [0n, 0n],
    target: [60000000n, 30000000n],
    withdrawals: [0n, 0n],
    deposits: [10000000n, 0n],
    rates: [40000000000000000n, 30000000000000000n],
    annualIncomeBefore: 0n,
    annualIncomeAfter: 400000n,
    grossMovement: 10000000n,
    repairsLimits: false,
  },
});

test("only a known healthy preview can enable rebalance", () => {
  assert.equal(earnDecision().canRebalance, false);
  assert.equal(
    earnDecision({ ...state(), healthy: false }).canRebalance,
    false,
  );
  const unavailable = earnDecision({
    ...state(),
    plan: undefined,
    planReason: "PlanUnavailable",
  });
  assert.equal(unavailable.canRebalance, false);
  assert.equal(unavailable.title, "Allocation preview unavailable");
  assert.doesNotMatch(unavailable.detail, /observations|cooldown/);
});
test("cooldown explanation uses chain time and never overrides a contract refusal", () => {
  const s = { ...state(), plan: undefined, planReason: "CooldownActive" };
  assert.match(earnDecision(s).detail, /500 seconds/);
  assert.equal(earnDecision({ ...s, timestamp: 3000n }).canRebalance, false);
});
test("freshness and rate-change reverts remain distinct", () => {
  for (const [planReason, title] of [
    ["RatesNotReady", "Waiting for rate observations"],
    ["RateChanged", "Rate change exceeds the rule"],
  ]) {
    const result = earnDecision({ ...state(), plan: undefined, planReason });
    assert.equal(result.title, title);
    assert.equal(result.canRebalance, false);
  }
});
test("a zero-movement plan cannot run even when repairing a limit", () => {
  const s = state();
  s.plan.grossMovement = 0n;
  s.plan.repairsLimits = true;
  assert.equal(earnDecision(s).canRebalance, false);
});
test("minimum gain is inclusive and uses the vault's asset units", () => {
  for (const minimum of [1000n, 1000000000000000n]) {
    const s = state();
    s.minAnnualGain = minimum;
    s.plan.annualIncomeBefore = 600n;
    s.plan.annualIncomeAfter = 600n + minimum - 1n;
    assert.equal(earnDecision(s).canRebalance, false);
    s.plan.annualIncomeAfter++;
    assert.equal(earnDecision(s).canRebalance, true);
  }
});
test("limit repair can reduce projected income but must be explained", () => {
  const s = state();
  s.plan.repairsLimits = true;
  s.plan.annualIncomeBefore = 400000n;
  s.plan.annualIncomeAfter = 100000n;
  assert.equal(earnDecision(s).canRebalance, true);
  assert.match(earnDecision(s).detail, /may reduce projected income/);
});
test("actual custom-error bytes decode, while a transport failure stays unknown", () => {
  const abi = parseAbi(earnDecisionErrors);
  for (const errorName of ["CooldownActive", "RatesNotReady", "RateChanged"]) {
    const args = errorName === "RateChanged" ? [1n] : [];
    const cause = new ContractFunctionRevertedError({
      abi,
      functionName: "previewRebalance",
      data: encodeErrorResult({ abi, errorName, args }),
    });
    assert.equal(
      earnPlanFailure(new BaseError("Call failed", { cause })),
      errorName,
    );
  }
  assert.equal(earnPlanFailure(new Error("timeout")), "PlanUnavailable");
});
