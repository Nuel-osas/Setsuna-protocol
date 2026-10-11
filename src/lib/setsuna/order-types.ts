export type OrderKind = "market" | "limit" | "fok";

/** Perpl includes order locks in its account balance. They are not free to withdraw. */
export function perpsBalances(balance: bigint, locked: bigint) {
  return {
    balance,
    locked,
    free: balance > locked ? balance - locked : BigInt(0),
  };
}

export function slippageBasisPoints(percent: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(percent))
    throw new Error("Use up to two decimal places for slippage.");
  const [whole, fraction = ""] = percent.split(".");
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (bps < 1 || bps > 500)
    throw new Error("Slippage must be between 0.01% and 5%.");
  return bps;
}

/** Bound the worst executable price, rounding inward so the limit never exceeds tolerance. */
export function marketPriceBound(
  reference: bigint,
  buying: boolean,
  slippageBps: number,
) {
  if (
    reference <= BigInt(0) ||
    !Number.isInteger(slippageBps) ||
    slippageBps < 1 ||
    slippageBps > 500
  )
    throw new Error("Slippage must be between 0.01% and 5%.");
  const scale = BigInt(10_000);
  const numerator =
    reference * BigInt(10_000 + (buying ? slippageBps : -slippageBps));
  const bound = buying
    ? numerator / scale
    : (numerator + scale - BigInt(1)) / scale;
  if (bound <= BigInt(0)) throw new Error("Market price is unavailable.");
  return bound;
}
