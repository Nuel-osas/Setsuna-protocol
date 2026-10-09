import { erc20Abi, parseAbi, type Address } from "viem";
import type { Deployment } from "./types";
import { clientFor } from "@/components/setsuna/WalletProvider";
import { earnDecisionErrors, earnPlanFailure } from "./earn-decision";

export const monVaultAbi = parseAbi([
  ...earnDecisionErrors,
  "function MIN_ANNUAL_GAIN() view returns(uint256)",
  "function COOLDOWN() view returns(uint256)",
  "function previewRebalance() view returns((uint256 nav, uint256[2] positions, uint256[2] target, uint256[2] withdrawals, uint256[2] deposits, uint256[2] rates, uint256 annualIncomeBefore, uint256 annualIncomeAfter, uint256 grossMovement, bool repairsLimits))",
  "function accounting() view returns(uint256 nav, bool healthy)",
  "function balanceOf(address) view returns(uint256)",
  "function convertToAssets(uint256) view returns(uint256)",
  "function maxDeposit(address) view returns(uint256)",
  "function maxRedeem(address) view returns(uint256)",
  "function maxWithdraw(address) view returns(uint256)",
  "function previewDeposit(uint256) view returns(uint256)",
  "function previewRedeem(uint256) view returns(uint256)",
  "function observations() view returns((uint256 timestamp, uint256 blockNumber, uint256[2] rates) previous, (uint256 timestamp, uint256 blockNumber, uint256[2] rates) latest)",
  "function lastRebalanceAt() view returns(uint256)",
  "function observeRates()",
  "function rebalance() returns((uint256 nav, uint256[2] positions, uint256[2] target, uint256[2] withdrawals, uint256[2] deposits, uint256[2] rates, uint256 annualIncomeBefore, uint256 annualIncomeAfter, uint256 grossMovement, bool repairsLimits))",
  "event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)",
  "event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)",
  "event Rebalanced(address indexed caller, uint256[2] withdrawals, uint256[2] deposits, uint256 annualIncomeBefore, uint256 annualIncomeAfter, bool repairsLimits)",
  "event RatesObserved(uint256 timestamp, uint256 destination0Apr, uint256 destination1Apr)",
]);
export const monGatewayAbi = parseAbi([
  "function depositMON(address receiver, uint256 minShares, uint256 deadline) payable returns(uint256)",
  "function redeemMON(uint256 shares, address receiver, uint256 minAssets, uint256 deadline) returns(uint256)",
]);
const adapterAbi = parseAbi([
  "function totalAssets() view returns(uint256)",
  "function supplyApr(int256) view returns(uint256)",
]);

export async function readMON(d: Deployment, account?: Address) {
  const m = d.earnMON;
  if (!m) throw new Error("setsMON demo unavailable");
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
      abi: monVaultAbi,
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
      abi: monVaultAbi,
      functionName: "observations",
      ...at,
    }),
    c.readContract({
      address: m.vault,
      abi: monVaultAbi,
      functionName: "lastRebalanceAt",
      ...at,
    }),
    c.readContract({
      address: m.vault,
      abi: monVaultAbi,
      functionName: "MIN_ANNUAL_GAIN",
      ...at,
    }),
    c.readContract({
      address: m.vault,
      abi: monVaultAbi,
      functionName: "COOLDOWN",
      ...at,
    }),
    c.readContract({
      address: m.vault,
      abi: monVaultAbi,
      functionName: "maxDeposit",
      args: [owner],
      ...at,
    }),
    c.readContract({
      address: m.vault,
      abi: monVaultAbi,
      functionName: "balanceOf",
      args: [owner],
      ...at,
    }),
    c.readContract({
      address: m.vault,
      abi: monVaultAbi,
      functionName: "maxRedeem",
      args: [owner],
      ...at,
    }),
    c.readContract({
      address: m.vault,
      abi: monVaultAbi,
      functionName: "maxWithdraw",
      args: [owner],
      ...at,
    }),
    account
      ? c.getBalance({ address: account, ...at })
      : Promise.resolve(undefined),
    c.readContract({
      address: m.vault,
      abi: monVaultAbi,
      functionName: "convertToAssets",
      args: [BigInt(10) ** BigInt(24)],
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
        c.readContract({
          address,
          abi: adapterAbi,
          functionName: "supplyApr",
          args: [BigInt(0)],
          ...at,
        }),
      ),
    ),
  ]);
  let plan,
    planReason = "";
  try {
    plan = await c.readContract({
      address: m.vault,
      abi: monVaultAbi,
      functionName: "previewRebalance",
      ...at,
    });
  } catch (error) {
    planReason = earnPlanFailure(error);
  }
  const worth = await c.readContract({
    address: m.vault,
    abi: monVaultAbi,
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
      abi: monVaultAbi,
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
    plan,
    planReason,
    maxDeposit,
    shares,
    maxRedeem,
    available,
    walletBalance,
    shareValue,
    worth,
    positions,
    rates,
    blendedApr:
      accounting[0] > BigInt(0)
        ? (annualIncome * BigInt(10) ** BigInt(18)) / accounting[0]
        : BigInt(0),
    events: events.slice(-10).reverse(),
    historyUnavailable,
    owner,
  };
}
export type MONSnapshot = Awaited<ReturnType<typeof readMON>>;
