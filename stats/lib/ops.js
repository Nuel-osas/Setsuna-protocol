// Operations: the keepers' own health report and each vault's upkeep, read live so the stats page
// shows when a keeper stalls, runs low on gas or a vault stops rebalancing.
import { parseAbi } from "viem";

const KEEPERS_HEALTH = process.env.KEEPERS_HEALTH_URL ?? "https://setsuna-workers-production.up.railway.app/health";

const common = [
  "function accounting() view returns (uint256 nav, bool healthy)",
  "function lastRebalanceAt() view returns (uint256)",
  "function asset() view returns (address)",
];
// setsUSDC (five markets) stores rates as a dynamic array; setsMON (two markets) as uint256[2].
const multiAbi = parseAbi([...common, "function observations() view returns ((uint256 timestamp, uint256 blockNumber, uint256[] rates) previous, (uint256 timestamp, uint256 blockNumber, uint256[] rates) latest)"]);
const pairAbi = parseAbi([...common, "function observations() view returns ((uint256 timestamp, uint256 blockNumber, uint256[2] rates) previous, (uint256 timestamp, uint256 blockNumber, uint256[2] rates) latest)"]);
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);

const VAULTS = [
  { name: "setsUSDC", address: "0x0a531817EEFB7b1FFD7c511c0817F58ac343CC67", decimals: 6, unit: "USDC", abi: multiAbi },
  { name: "setsMON", address: "0x408A8C85a3e15446885ADCc954575e7a918dFd33", decimals: 18, unit: "MON", abi: pairAbi },
];

/** The keeper service's /health, or {reachable: false}. Never throws. */
export async function keeperHealth() {
  try {
    const res = await fetch(KEEPERS_HEALTH, { signal: AbortSignal.timeout(5000), headers: { accept: "application/json" } });
    const body = await res.json();
    return { reachable: true, ready: !!body.ready, keepers: body.keepers ?? [], checkedAt: new Date().toISOString() };
  } catch {
    return { reachable: false, ready: false, keepers: [], checkedAt: new Date().toISOString() };
  }
}

/** Each vault's size, cash share, last rebalance and age of its latest rate reading. */
export async function vaultUpkeep(client) {
  return Promise.all(
    VAULTS.map(async (v) => {
      try {
        const [[nav], last, [, latest], asset] = await Promise.all([
          client.readContract({ address: v.address, abi: v.abi, functionName: "accounting" }),
          client.readContract({ address: v.address, abi: v.abi, functionName: "lastRebalanceAt" }),
          client.readContract({ address: v.address, abi: v.abi, functionName: "observations" }),
          client.readContract({ address: v.address, abi: v.abi, functionName: "asset" }),
        ]);
        const cash = await client.readContract({ address: asset, abi: erc20, functionName: "balanceOf", args: [v.address] });
        const size = Number(nav) / 10 ** v.decimals;
        return {
          name: v.name,
          unit: v.unit,
          size: Math.round(size * 1e4) / 1e4,
          cashPct: nav > 0n ? Math.round((Number(cash) / Number(nav)) * 1000) / 10 : null,
          lastRebalanceAt: last > 0n ? new Date(Number(last) * 1000).toISOString() : null,
          ratesReadAt: latest.timestamp > 0n ? new Date(Number(latest.timestamp) * 1000).toISOString() : null,
        };
      } catch {
        return { name: v.name, unit: v.unit, unavailable: true };
      }
    }),
  );
}
