// Saves every Deposit, Withdraw and Transfer log of the Earn vaults into the app, so the server
// history route only scans the blocks since this snapshot. Read-only; no key.
// Usage: node scripts/earn-log-snapshot.mjs   (re-run every few weeks, then redeploy)
import { writeFileSync } from "node:fs";
import { createPublicClient, fallback, http, parseAbi, toEventSelector } from "viem";

const VAULTS = {
  USDC: { vault: "0x0a531817EEFB7b1FFD7c511c0817F58ac343CC67", start: 112600483n },
  MON: { vault: "0x408A8C85a3e15446885ADCc954575e7a918dFd33", start: 112600487n },
};
const EVENTS = parseAbi([
  "event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)",
  "event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);
const TOPICS = EVENTS.map((e) => toEventSelector(e));
const SPAN = 10_000n;
const client = createPublicClient({
  transport: fallback(["https://rpc2.monad.xyz", "https://rpc1.monad.xyz", "https://rpc.monad.xyz", "https://rpc3.monad.xyz"].map((u) => http(u, { retryCount: 3, timeout: 20_000 }))),
});
const head = await client.getBlockNumber();
const out = {};
for (const [asset, { vault, start }] of Object.entries(VAULTS)) {
  const ranges = [];
  for (let f = start; f <= head; f += SPAN) ranges.push([f, f + SPAN - 1n > head ? head : f + SPAN - 1n]);
  const found = new Array(ranges.length);
  let next = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    for (let i = next++; i < ranges.length; i = next++) {
      const [fromBlock, toBlock] = ranges[i];
      const logs = await client.request({ method: "eth_getLogs", params: [{ address: vault, topics: [TOPICS], fromBlock: `0x${fromBlock.toString(16)}`, toBlock: `0x${toBlock.toString(16)}` }] });
      found[i] = logs.map((l) => ({ address: l.address, blockNumber: String(BigInt(l.blockNumber)), blockHash: l.blockHash, logIndex: Number(l.logIndex), transactionHash: l.transactionHash, transactionIndex: Number(l.transactionIndex), topics: l.topics, data: l.data }));
    }
  }));
  out[asset] = { vault, from: String(start), to: String(head), logs: found.flat() };
  console.log(asset, out[asset].logs.length, "logs up to block", String(head));
}
writeFileSync(new URL("../src/lib/setsuna/data/earn-logs.json", import.meta.url), JSON.stringify(out));
