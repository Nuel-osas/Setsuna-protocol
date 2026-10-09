// Reviewed Monad snapshots. These profiles authorize synthetic-fund forks only.
export const demoForkProfiles = Object.freeze({
  trading: Object.freeze({
    block: 110418863n,
    hash: "0xed4f56748e560219f9926e46d78591ec746b5bca4497e65d0734062fbb46a97b",
    markPNS: 851905n,
    markTimestamp: "1791102515",
  }),
  unified: Object.freeze({
    block: 111560409n,
    hash: "0xc8a3dcf05b4b35daf91e0abc74bc91ebc2ec45830d93a8f2b6451cff8214a84b",
    markPNS: 829642n,
    markTimestamp: "1791447488",
  }),
});

export function reviewedDemoFork(manifest) {
  if (manifest.chainId !== 31337 || manifest.syntheticFunding !== true)
    throw new Error("A synthetic-fund chain 31337 manifest is required");
  const profile = Object.values(demoForkProfiles).find(
    (p) =>
      manifest.forkBlock === String(p.block) && manifest.forkHash === p.hash,
  );
  if (!profile) throw new Error("Unreviewed Monad source block or hash");
  return profile;
}
