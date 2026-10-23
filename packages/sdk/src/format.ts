import { formatUnits } from "viem";

/** An on-chain amount, exact and readable. `raw` is the integer as a string so it survives JSON. */
export interface Amount {
  raw: string;
  formatted: string;
  decimals: number;
}

export function amount(raw: bigint, decimals: number): Amount {
  return { raw: raw.toString(), formatted: formatUnits(raw, decimals), decimals };
}

/** A rate the contracts express in 1e18 units (1e18 = 100%), as a percentage with 4 decimals. */
export function percentFrom1e18(rate: bigint): number {
  return Number((rate * 1_000_000n) / 10n ** 18n) / 10_000;
}

/** A share of a total, as a percentage with 2 decimals. */
export function percentOf(part: bigint, whole: bigint): number {
  return whole === 0n ? 0 : Number((part * 1_000_000n) / whole) / 10_000;
}

export const bpsToPercent = (bps: bigint | number) => Number(bps) / 100;

export const iso = (unixSeconds: bigint) => (unixSeconds === 0n ? null : new Date(Number(unixSeconds) * 1000).toISOString());
