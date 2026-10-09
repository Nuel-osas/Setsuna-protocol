import type { Snapshot } from "./types";

export type PortfolioRead<T> =
  | { status: "ready"; data: T }
  | { status: "unavailable" }
  | { status: "not-configured" };

export type EarnHolding = {
  shares: bigint;
  healthy: boolean;
  worth?: bigint;
  available?: bigint;
  apr?: bigint;
};

/** Unknown holdings must never be presented as zero in an account total. */
export function earnTotal(
  wallet: PortfolioRead<bigint>,
  earn: PortfolioRead<EarnHolding>,
) {
  if (wallet.status !== "ready" || earn.status === "unavailable")
    return undefined;
  if (earn.status === "not-configured") return wallet.data;
  if (!earn.data.healthy || earn.data.worth === undefined) return undefined;
  return wallet.data + earn.data.worth;
}

export function positionEquity(snapshot: Snapshot) {
  const p = snapshot.position;
  // Settled positions are already reflected in the trading balance.
  return p && p.lotLNS > BigInt(0)
    ? p.depositCNS + p.deltaPnlCNS + p.premiumPnlCNS
    : BigInt(0);
}

export function ausdTotal(
  wallet: PortfolioRead<bigint>,
  perps: PortfolioRead<Snapshot>,
) {
  if (wallet.status !== "ready" || perps.status === "unavailable")
    return undefined;
  if (perps.status === "not-configured") return wallet.data;
  const p = perps.data;
  if (p.accountId > BigInt(0) && (p.freeTrading === undefined || !p.position))
    return undefined;
  return (
    wallet.data + p.reserve + (p.freeTrading ?? BigInt(0)) + positionEquity(p)
  );
}
