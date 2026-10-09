/**
 * Earn: the setsUSDC destinations and the allocation rule.
 *
 * Every destination here passed a deposit, 7-day accrual and full-withdrawal
 * round trip on a Monad mainnet fork: Aave V3 and Morpho WBTC/USDC by Codex
 * (docs/research/earn-markets-2026-10-02.md), Euler, Neverland and Morpho
 * aHYPER/USDC by Claude (docs/research/earn-markets-2-2026-10-02.md).
 * Rates are BASE supply APR read from chain: no reward incentives, no curator
 * layer. This is the separate mainnet research view. Executable demo holdings
 * and the contract's allocation preview are read in usdc.ts from its fork.
 */
export const USDC = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603" as const;

export type Destination = {
  key: string;
  kind: "aave" | "euler" | "morpho";
  source: `0x${string}`; // data provider (aave), vault (euler) or market id (morpho)
  name: string;
  protocol: string;
  detail: string;
  address: `0x${string}`; // entry contract, for the explorer link
};

export const destinations: Destination[] = [
  { key: "aave", kind: "aave", source: "0xB65A68B98274ef7D9a60E0C0747dD1BEc3D32fad", name: "USDC reserve", protocol: "Aave V3", detail: "Direct supply", address: "0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef" },
  { key: "euler", kind: "euler", source: "0x1905EDDF5943ef6C92Ccf1469bd40fC2cB4A77b0", name: "eUSDC-12", protocol: "Euler", detail: "Governed vault · 10% Euler fee", address: "0x1905EDDF5943ef6C92Ccf1469bd40fC2cB4A77b0" },
  { key: "morpho-ahyper", kind: "morpho", source: "0x9e8441e7af65860feac831ebc117473e3033321abf528ebc8fbde1eeaaa3a626", name: "aHYPER/USDC market", protocol: "Morpho Blue", detail: "Collateral: Hyperithm delta-neutral vault shares · 77% LLTV", address: "0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee" },
  { key: "neverland", kind: "aave", source: "0xfd0b6b6F736376F7B99ee989c749007c7757fDba", name: "USDC reserve", protocol: "Neverland", detail: "Aave V3 fork · direct supply", address: "0x80F00661b13CC5F6ccd3885bE7b4C9c67545D585" },
  { key: "morpho-wbtc", kind: "morpho", source: "0xe35c5abc6418b6319b014e07aa3c86163a870a957284128f03cf7a9e414f8899", name: "WBTC/USDC market", protocol: "Morpho Blue", detail: "Collateral: WBTC · 86% LLTV", address: "0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee" },
];

export const policy = {
  bufferPct: 10, // minimum kept as cash for withdrawals
  capPct: 60, // most of the pool any one destination may hold
  minSupplyUsd: 250_000, // destinations smaller than this are not eligible
};

export type LiveDestination = Destination & {
  supplyUsd: number; // total supplied to the destination
  cashUsd: number; // withdrawable now (supplied minus borrowed)
  apr: number; // base supply APR, fraction
  eligible: boolean;
  reason?: string;
  weight: number; // fraction of the whole pool
};

export type EarnSnapshot = {
  source: string;
  basis: string;
  fetchedAt: string;
  block?: string;
  destinations: LiveDestination[];
  bufferPct: number;
  idlePct: number; // actual idle share after caps, >= bufferPct
  blendedApr: number;
  error?: string;
};

/** Deterministic targets: proportional to rate, capped per destination; whatever cannot be placed stays idle. */
export function allocate(rows: Omit<LiveDestination, "eligible" | "weight" | "reason">[]) {
  const investable = 1 - policy.bufferPct / 100;
  const cap = policy.capPct / 100;
  const out: LiveDestination[] = rows.map((r) => {
    const reason = !(r.apr > 0)
      ? "No positive supply rate"
      : r.supplyUsd < policy.minSupplyUsd
        ? `Below the $${(policy.minSupplyUsd / 1000).toFixed(0)}K minimum size`
        : undefined;
    return { ...r, eligible: !reason, reason, weight: 0 };
  });
  let remaining = investable;
  let open = out.filter((r) => r.eligible);
  for (let i = 0; i < 8 && open.length && remaining > 1e-9; i++) {
    const total = open.reduce((s, r) => s + r.apr, 0);
    if (total <= 0) break;
    const next: LiveDestination[] = [];
    let used = 0;
    for (const r of open) {
      const take = Math.min((remaining * r.apr) / total, cap - r.weight);
      r.weight += take;
      used += take;
      if (r.weight < cap - 1e-9) next.push(r);
    }
    remaining -= used;
    if (next.length === open.length) break;
    open = next;
  }
  const placed = out.reduce((s, r) => s + r.weight, 0);
  return { rows: out, blended: out.reduce((s, r) => s + r.weight * r.apr, 0), idle: 1 - placed };
}
