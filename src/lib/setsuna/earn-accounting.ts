/** Lifetime asset flows are only a yield measure when no external share transfers exist. */
export type EarnFlow = {
  kind: "deposit" | "withdraw" | "transfer";
  assets?: bigint;
  shares: bigint;
  from?: string;
  to?: string;
};
export function reconcileEarn(
  flows: EarnFlow[],
  owner: string,
  shares: bigint,
  worth: bigint | undefined,
  complete: boolean,
) {
  let deposited = BigInt(0),
    withdrawn = BigInt(0),
    netShares = BigInt(0);
  let transferred = false;
  const zero = "0x0000000000000000000000000000000000000000";
  for (const flow of flows) {
    if (flow.kind === "deposit") {
      deposited += flow.assets!;
      netShares += flow.shares;
    }
    if (flow.kind === "withdraw") {
      withdrawn += flow.assets!;
      netShares -= flow.shares;
    }
    if (flow.kind === "transfer" && flow.shares > BigInt(0)) {
      const from = flow.from?.toLowerCase(),
        to = flow.to?.toLowerCase();
      if (
        from !== zero &&
        to !== zero &&
        from !== to &&
        (from === owner.toLowerCase() || to === owner.toLowerCase())
      )
        transferred = true;
    }
  }
  const reason = !complete
    ? "Full transaction history is unavailable."
    : transferred
      ? "Transferred shares need a cost basis before earnings can be calculated."
      : netShares !== shares
        ? "Transaction history does not reconcile with this share balance."
        : worth === undefined
          ? "The position’s current value is unavailable."
          : undefined;
  return {
    deposited: complete ? deposited : undefined,
    withdrawn: complete ? withdrawn : undefined,
    earnings: reason ? undefined : worth! + withdrawn - deposited,
    reason,
  };
}
