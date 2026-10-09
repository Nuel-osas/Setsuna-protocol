import {
  erc20Abi,
  erc4626Abi,
  formatUnits,
  parseAbi,
  type Address,
} from "viem";
import { clientFor } from "@/components/setsuna/WalletProvider";
import { readSnapshot } from "./contracts";
import { spotABI } from "./spot";
import type { Deployment } from "./types";
import type { EarnHolding, PortfolioRead } from "./portfolio-math";

export type PortfolioAsset = "MON" | "USDC" | "AUSD";
export type PortfolioActivity = {
  key: string;
  hash: string;
  block: bigint;
  section: "Earn" | "Spot" | "Perps";
  label: string;
  detail: string;
};
export type PortfolioEarn = EarnHolding & {
  activity: PortfolioActivity[];
  historyUnavailable: boolean;
};
const vaultAbi = parseAbi([
  "function accounting() view returns(uint256 nav, bool healthy)",
]);
const adapterAbi = parseAbi([
  "function totalAssets() view returns(uint256)",
  "function supplyApr(int256) view returns(uint256)",
]);
const absent = { status: "not-configured" } as const;
async function attempt<T>(read: () => Promise<T>): Promise<PortfolioRead<T>> {
  try {
    return { status: "ready", data: await read() };
  } catch {
    return { status: "unavailable" };
  }
}

export async function readPortfolio(d: Deployment, owner: Address) {
  const client = clientFor(d);
  if ((await client.getChainId()) !== d.chainId)
    throw new Error("Portfolio network mismatch");
  const block = await client.getBlock();
  const at = { blockNumber: block.number };
  const floor =
    block.number > BigInt(2000) ? block.number - BigInt(2000) : BigInt(0);
  const from = (start?: string) =>
    start && BigInt(start) > floor ? BigInt(start) : floor;
  const balance = (token?: Address) =>
    token
      ? attempt(() =>
          client.readContract({
            address: token,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [owner],
            ...at,
          }),
        )
      : Promise.resolve(absent);

  async function readEarn(
    asset: "MON" | "USDC",
  ): Promise<PortfolioRead<PortfolioEarn>> {
    const m = asset === "MON" ? d.earnMON : d.earnUSDC;
    if (!m) return absent;
    return attempt(async () => {
      const [underlying, accounting, shares] = await Promise.all([
        client.readContract({
          address: m.vault,
          abi: erc4626Abi,
          functionName: "asset",
          ...at,
        }),
        client.readContract({
          address: m.vault,
          abi: vaultAbi,
          functionName: "accounting",
          ...at,
        }),
        client.readContract({
          address: m.vault,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [owner],
          ...at,
        }),
      ]);
      if (underlying.toLowerCase() !== m.asset.toLowerCase())
        throw new Error("Unexpected vault asset");
      const healthy = accounting[1];
      const [worth, available, apr, history] = await Promise.all([
        healthy
          ? client.readContract({
              address: m.vault,
              abi: erc4626Abi,
              functionName: "convertToAssets",
              args: [shares],
              ...at,
            })
          : undefined,
        healthy
          ? client.readContract({
              address: m.vault,
              abi: erc4626Abi,
              functionName: "maxWithdraw",
              args: [owner],
              ...at,
            })
          : undefined,
        healthy
          ? (async () => {
              if (accounting[0] === BigInt(0)) return BigInt(0);
              const income = await Promise.all(
                m.adapters.map(async (address) => {
                  const [position, rate] = await Promise.all([
                    client.readContract({
                      address,
                      abi: adapterAbi,
                      functionName: "totalAssets",
                      ...at,
                    }),
                    client.readContract({
                      address,
                      abi: adapterAbi,
                      functionName: "supplyApr",
                      args: [BigInt(0)],
                      ...at,
                    }),
                  ]);
                  return (position * rate) / BigInt(10) ** BigInt(18);
                }),
              );
              return (
                (income.reduce((sum, value) => sum + value, BigInt(0)) *
                  BigInt(10) ** BigInt(18)) /
                accounting[0]
              );
            })().catch(() => undefined)
          : undefined,
        attempt(async () => {
          // Filter by this owner before limiting: other depositors' events are never shown.
          const [deposits, withdrawals] = await Promise.all([
            client.getContractEvents({
              address: m.vault,
              abi: erc4626Abi,
              eventName: "Deposit",
              args: { receiver: owner },
              fromBlock: from(m.startBlock),
              toBlock: block.number,
            }),
            client.getContractEvents({
              address: m.vault,
              abi: erc4626Abi,
              eventName: "Withdraw",
              args: { owner },
              fromBlock: from(m.startBlock),
              toBlock: block.number,
            }),
          ]);
          return [...deposits, ...withdrawals].map((event) => ({
            key: `${event.transactionHash}-${event.logIndex}`,
            hash: event.transactionHash!,
            block: event.blockNumber!,
            section: "Earn" as const,
            label:
              event.eventName === "Deposit"
                ? `${asset} deposited`
                : `${asset} withdrawn`,
            detail: `${formatUnits(event.args.assets ?? BigInt(0), asset === "MON" ? 18 : 6)} ${asset}`,
          }));
        }),
      ]);
      return {
        shares,
        healthy,
        worth,
        available,
        apr,
        activity: history.status === "ready" ? history.data : [],
        historyUnavailable: history.status !== "ready",
      };
    });
  }

  const [monWallet, usdcWallet, ausdWallet, monEarn, usdcEarn, perps, spot] =
    await Promise.all([
      attempt(() => client.getBalance({ address: owner, ...at })),
      balance(d.earnUSDC?.asset ?? d.spot?.usdc),
      balance(d.collateral),
      readEarn("MON"),
      readEarn("USDC"),
      d.factory
        ? attempt(() => readSnapshot(d, owner, block.number, floor))
        : Promise.resolve(absent),
      d.spot
        ? attempt(async () => {
            const events = await client.getContractEvents({
              address: d.spot!.gateway,
              abi: spotABI,
              eventName: "Swapped",
              args: { owner },
              fromBlock: from(d.spot!.startBlock),
              toBlock: block.number,
            });
            return events.map((event) => ({
              key: `${event.transactionHash}-${event.logIndex}`,
              hash: event.transactionHash!,
              block: event.blockNumber!,
              section: "Spot" as const,
              label: event.args.monToUSDC ? "MON → USDC" : "USDC → MON",
              detail: `${formatUnits(event.args.amountIn ?? BigInt(0), event.args.monToUSDC ? 18 : 6)} ${event.args.monToUSDC ? "MON" : "USDC"} → ${formatUnits(event.args.amountOut ?? BigInt(0), event.args.monToUSDC ? 6 : 18)} ${event.args.monToUSDC ? "USDC" : "MON"}`,
            }));
          })
        : Promise.resolve(absent),
    ]);
  const earn = { MON: monEarn, USDC: usdcEarn };
  const activity = [
    ...Object.values(earn).flatMap((value) =>
      value.status === "ready" ? value.data.activity : [],
    ),
    ...(spot.status === "ready" ? spot.data : []),
    ...(perps.status === "ready"
      ? perps.data.activity
          .filter((value) => value.block >= floor)
          .map((value, index) => ({
            key: `perps-${value.hash}-${index}`,
            hash: value.hash,
            block: value.block,
            section: "Perps" as const,
            label: value.name,
            detail: value.detail,
          }))
      : []),
  ]
    .sort((a, b) =>
      a.block === b.block
        ? b.key.localeCompare(a.key)
        : a.block > b.block
          ? -1
          : 1,
    )
    .slice(0, 24);
  const historyUnavailable =
    Object.values(earn).some(
      (value) =>
        value.status === "unavailable" ||
        (value.status === "ready" && value.data.historyUnavailable),
    ) ||
    spot.status === "unavailable" ||
    perps.status === "unavailable" ||
    (perps.status === "ready" && perps.data.historyUnavailable);
  return {
    block: block.number,
    timestamp: block.timestamp,
    wallet: { MON: monWallet, USDC: usdcWallet, AUSD: ausdWallet },
    earn,
    perps,
    activity,
    historyUnavailable,
  };
}
export type PortfolioSnapshot = Awaited<ReturnType<typeof readPortfolio>>;
