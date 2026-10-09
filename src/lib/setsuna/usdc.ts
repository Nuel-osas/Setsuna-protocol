import { erc20Abi, parseAbi, type Address } from "viem";
import type { Deployment } from "./types";
import { clientFor } from "@/components/setsuna/WalletProvider";
import { earnDecisionErrors, earnPlanFailure } from "./earn-decision";

export const usdcVaultAbi = parseAbi([
  ...earnDecisionErrors,
  "function MIN_ANNUAL_GAIN() view returns(uint256)",
  "function COOLDOWN() view returns(uint256)",
  "function depositWithMinShares(uint256 assets,address receiver,uint256 minShares,uint256 deadline) returns(uint256)",
  "function redeemWithMinAssets(uint256 shares,address receiver,address owner,uint256 minAssets,uint256 deadline) returns(uint256)",
  "function disabled(uint256) view returns(bool)",
  "function minimumMarketSupply() view returns(uint256)",
  "function previewRebalance() view returns((uint256 nav, uint256[] positions, uint256[] target, uint256[] withdrawals, uint256[] deposits, uint256[] rates, uint256 annualIncomeBefore, uint256 annualIncomeAfter, uint256 grossMovement, bool repairsLimits))",
  "function accounting() view returns(uint256 nav, bool healthy)",
  "function balanceOf(address) view returns(uint256)",
  "function convertToAssets(uint256) view returns(uint256)",
  "function maxDeposit(address) view returns(uint256)",
  "function maxRedeem(address) view returns(uint256)",
  "function maxWithdraw(address) view returns(uint256)",
  "function previewDeposit(uint256) view returns(uint256)",
  "function previewRedeem(uint256) view returns(uint256)",
  "function observations() view returns((uint256 timestamp, uint256 blockNumber, uint256[] rates) previous, (uint256 timestamp, uint256 blockNumber, uint256[] rates) latest)",
  "function lastRebalanceAt() view returns(uint256)",
  "function observeRates()",
  "function rebalance() returns((uint256 nav, uint256[] positions, uint256[] target, uint256[] withdrawals, uint256[] deposits, uint256[] rates, uint256 annualIncomeBefore, uint256 annualIncomeAfter, uint256 grossMovement, bool repairsLimits))",
  "event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)",
  "event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)",
  "event Rebalanced(address indexed caller, uint256[] withdrawals, uint256[] deposits, uint256 annualIncomeBefore, uint256 annualIncomeAfter, bool repairsLimits)",
  "event RatesObserved(uint256 timestamp, uint256[] rates)",
]);
const adapterAbi = parseAbi([
  "function totalAssets() view returns(uint256)",
  "function availableLiquidity() view returns(uint256)",
  "function marketLiquidity() view returns(uint256)",
  "function marketSupply() view returns(uint256)",
  "function depositCapacity() view returns(uint256)",
  "function supplyApr(int256) view returns(uint256)",
]);

export async function readUSDC(d: Deployment, account?: Address) {
  const m = d.earnUSDC;
  if (!m) throw new Error("setsUSDC demo unavailable");
  const c = clientFor(d);
  if ((await c.getChainId()) !== d.chainId)
    throw new Error("Network changed. Refresh the app.");
  const block = await c.getBlock();
  const at = { blockNumber: block.number };
  const owner = account ?? "0x0000000000000000000000000000000000000000";
  const [
    accounting,
    idle,
    observations,
    lastRebalance,
    minAnnualGain,
    cooldown,
    maxDeposit,
    shares,
    maxRedeem,
    available,
    walletBalance,
    shareValue,
    positions,
    rates,
  ] = await Promise.all([
    c.readContract({
      address: m.vault,
      abi: usdcVaultAbi,
      functionName: "accounting",
      ...at,
    }),
    c.readContract({
      address: m.asset,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [m.vault],
      ...at,
    }),
    c.readContract({
      address: m.vault,
      abi: usdcVaultAbi,
      functionName: "observations",
      ...at,
    }),
    c.readContract({
      address: m.vault,
      abi: usdcVaultAbi,
      functionName: "lastRebalanceAt",
      ...at,
    }),
    c.readContract({
      address: m.vault,
      abi: usdcVaultAbi,
      functionName: "MIN_ANNUAL_GAIN",
      ...at,
    }),
    c.readContract({
      address: m.vault,
      abi: usdcVaultAbi,
      functionName: "COOLDOWN",
      ...at,
    }),
    c.readContract({
      address: m.vault,
      abi: usdcVaultAbi,
      functionName: "maxDeposit",
      args: [owner],
      ...at,
    }),
    c.readContract({
      address: m.vault,
      abi: usdcVaultAbi,
      functionName: "balanceOf",
      args: [owner],
      ...at,
    }),
    c.readContract({
      address: m.vault,
      abi: usdcVaultAbi,
      functionName: "maxRedeem",
      args: [owner],
      ...at,
    }),
    c.readContract({
      address: m.vault,
      abi: usdcVaultAbi,
      functionName: "maxWithdraw",
      args: [owner],
      ...at,
    }),
    account
      ? c.readContract({
          address: m.asset,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [account],
          ...at,
        })
      : Promise.resolve(undefined),
    c.readContract({
      address: m.vault,
      abi: usdcVaultAbi,
      functionName: "convertToAssets",
      args: [BigInt(10) ** BigInt(12)],
      ...at,
    }),
    Promise.all(
      m.adapters.map((address) =>
        c.readContract({
          address,
          abi: adapterAbi,
          functionName: "totalAssets",
          ...at,
        }),
      ),
    ),
    Promise.all(
      m.adapters.map((address) =>
        c
          .readContract({
            address,
            abi: adapterAbi,
            functionName: "supplyApr",
            args: [BigInt(0)],
            ...at,
          })
          .catch(() => BigInt(0)),
      ),
    ),
  ]);
  const liquidity = await Promise.all(
    m.adapters.map(async (address, i) => {
      const read = (
        functionName:
          | "availableLiquidity"
          | "marketLiquidity"
          | "marketSupply"
          | "depositCapacity",
      ) =>
        c
          .readContract({ address, abi: adapterAbi, functionName, ...at })
          .catch(() => undefined);
      const [available, marketCash, supply, capacity, disabled] =
        await Promise.all([
          read("availableLiquidity"),
          read("marketLiquidity"),
          read("marketSupply"),
          read("depositCapacity"),
          c.readContract({
            address: m.vault,
            abi: usdcVaultAbi,
            functionName: "disabled",
            args: [BigInt(i)],
            ...at,
          }),
        ]);
      const previous = observations[0].rates[i] ?? BigInt(0),
        latest = observations[1].rates[i] ?? BigInt(0);
      const values = [previous, latest, rates[i]];
      const low = values.reduce((a, b) => (a < b ? a : b)),
        high = values.reduce((a, b) => (a > b ? a : b));
      const reason = disabled
        ? "Disabled for new allocation"
        : supply === undefined ||
            marketCash === undefined ||
            capacity === undefined ||
            available === undefined
          ? "Market read unavailable"
          : supply < BigInt(250_000_000_000)
            ? "Below 250,000 USDC minimum"
            : capacity === BigInt(0)
              ? "Deposits unavailable"
              : marketCash < BigInt(10)
                ? "Insufficient market cash"
                : low === BigInt(0)
                  ? "Waiting for positive rate observations"
                  : high > BigInt(10) ** BigInt(18) ||
                      high - low > low / BigInt(10)
                    ? "Rate outside allowed range"
                    : "Eligible";
      return { available, marketCash, supply, capacity, reason };
    }),
  );
  let plan,
    planReason = "";
  try {
    plan = await c.readContract({
      address: m.vault,
      abi: usdcVaultAbi,
      functionName: "previewRebalance",
      ...at,
    });
  } catch (error) {
    planReason = earnPlanFailure(error);
  }
  const worth = await c.readContract({
    address: m.vault,
    abi: usdcVaultAbi,
    functionName: "convertToAssets",
    args: [shares],
    ...at,
  });
  const fromBlock =
    block.number - BigInt(m.startBlock) > BigInt(2000)
      ? block.number - BigInt(2000)
      : BigInt(m.startBlock);
  let historyUnavailable = false;
  const events = await c
    .getContractEvents({
      address: m.vault,
      abi: usdcVaultAbi,
      fromBlock,
      toBlock: block.number,
    })
    .catch(() => {
      historyUnavailable = true;
      return [];
    });
  const annualIncome = positions.reduce(
    (sum, p, i) => sum + (p * rates[i]) / BigInt(10) ** BigInt(18),
    BigInt(0),
  );
  return {
    block: block.number,
    timestamp: block.timestamp,
    nav: accounting[0],
    healthy: accounting[1],
    idle,
    observations,
    lastRebalance,
    minAnnualGain,
    cooldown,
    maxDeposit,
    shares,
    maxRedeem,
    available,
    walletBalance,
    shareValue,
    worth,
    positions,
    rates,
    liquidity,
    plan,
    planReason,
    blendedApr:
      accounting[0] > BigInt(0)
        ? (annualIncome * BigInt(10) ** BigInt(18)) / accounting[0]
        : BigInt(0),
    events: events.slice(-10).reverse(),
    historyUnavailable,
    owner,
  };
}
export type USDCSnapshot = Awaited<ReturnType<typeof readUSDC>>;
