import { BaseError, ContractFunctionRevertedError } from "viem";

export const earnDecisionErrors = [
  "error UnhealthyAccounting()",
  "error RatesNotReady()",
  "error RateChanged(uint256 destination)",
  "error CooldownActive()",
  "error NoMovement()",
  "error NoImprovement()",
] as const;

export type EarnPlan = {
  nav: bigint;
  positions: readonly bigint[];
  target: readonly bigint[];
  withdrawals: readonly bigint[];
  deposits: readonly bigint[];
  rates: readonly bigint[];
  annualIncomeBefore: bigint;
  annualIncomeAfter: bigint;
  grossMovement: bigint;
  repairsLimits: boolean;
};

export type EarnDecisionSnapshot = {
  healthy: boolean;
  block: bigint;
  timestamp: bigint;
  idle: bigint;
  nav: bigint;
  lastRebalance: bigint;
  cooldown: bigint;
  minAnnualGain: bigint;
  rates: readonly bigint[];
  observations: readonly {
    timestamp: bigint;
    blockNumber: bigint;
    rates: readonly bigint[];
  }[];
  plan?: EarnPlan;
  planReason: string;
};

export function earnPlanFailure(error: unknown): string {
  if (error instanceof BaseError) {
    const cause = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (cause instanceof ContractFunctionRevertedError && cause.data?.errorName)
      return cause.data.errorName;
  }
  return "PlanUnavailable";
}

/** Explains the contract preview, without inventing a plan on RPC failure. */
export function earnDecision(s?: EarnDecisionSnapshot) {
  const hold = (title: string, detail: string) => ({
    canRebalance: false,
    title,
    detail,
  });
  if (!s)
    return hold(
      "Waiting for vault data",
      "The decision will appear after the vault can be read.",
    );
  if (!s.healthy)
    return hold(
      "Waiting for reliable balances",
      "The vault cannot value every position. Rebalancing is unavailable.",
    );
  if (!s.plan) {
    if (s.planReason === "CooldownActive") {
      const remaining = s.lastRebalance + s.cooldown - s.timestamp;
      return hold(
        "Waiting for the cooldown",
        remaining > BigInt(0)
          ? `At this block, ${remaining.toString()} seconds remain before another rebalance can be considered.`
          : "The contract reports an active cooldown. Refresh to read the next decision.",
      );
    }
    if (s.planReason === "RatesNotReady")
      return hold(
        "Waiting for rate observations",
        "The contract needs two spaced, fresh observations and a later block before it can plan a move.",
      );
    if (s.planReason === "RateChanged")
      return hold(
        "Rate change exceeds the rule",
        "The contract rejected the rate inputs. It will consider a new plan when the observations satisfy its limits.",
      );
    return hold(
      "Allocation preview unavailable",
      "The contract preview could not be read. No next move is assumed; refresh before continuing.",
    );
  }
  if (s.plan.grossMovement === BigInt(0))
    return hold(
      "No permitted move right now",
      "The current targets and available liquidity leave no amount to move within the vault’s limits.",
    );
  if (
    !s.plan.repairsLimits &&
    s.plan.annualIncomeAfter < s.plan.annualIncomeBefore + s.minAnnualGain
  )
    return hold(
      "Projected gain is too small",
      "The plan does not meet the minimum annual income improvement and is not a limit-repair plan. The vault keeps its current allocation.",
    );
  return {
    canRebalance: true,
    title: s.plan.repairsLimits
      ? "A limit-repair plan is available"
      : "An income-improving plan is available",
    detail: s.plan.repairsLimits
      ? "The plan addresses a cash-buffer or destination-limit breach. It may reduce projected income; execution checks the limits again."
      : "The proposed move meets the contract’s minimum projected annual income improvement. Execution recalculates the plan and checks it again.",
  };
}
