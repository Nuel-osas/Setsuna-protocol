/**
 * Perpl mainnet observations from gate G6.
 * Source: docs/research/g6-topups-7d-2026-09-28.json (read-only eth_getLogs,
 * blocks 106,771,593 to 108,773,683, about 7 days ending 28 Sep 2026).
 * Figures are observations, not projections. Change them only by re-running
 * scripts/research/g6_analyze.py.
 */
export const evidence = {
  window: "7 days to 28 Sep 2026",
  blocks: "106,771,593 → 108,773,683",
  eventsRead: 706_441,
  activeAccounts: 584,
  liquidations: 81,
  liquidatedAccounts: 56,
  repeatLiquidated: 12,
  worstRepeat: 7,
  collateralAtStake: 14_814,
  medianAtStake: 41,
  manualTopUpAccounts: 64,
  manualTopUpShare: 11,
  manualTopUps: 590,
  medianTopUp: 86.4,
  topUpVolume: 191_315,
  topUpConcentration: 43,
} as const;
