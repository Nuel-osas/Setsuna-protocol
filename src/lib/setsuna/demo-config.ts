import { isAddress, type Address } from "viem";
import type { Deployment } from "./types";
import { parseUSDCEarn } from "./usdc-deployment.ts";

export const venues = {
  exchange: "0x34B6552d57a35a1D042CcAe1951BD1C370112a6F",
  collateral: "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a",
  market: "0x065C9d28E428A0db40191a54d33d5b7c71a9C394",
  usdc: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
  wmon: "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A",
} as const;
function address(value: unknown): Address {
  if (
    typeof value !== "string" ||
    !isAddress(value) ||
    /^0x0{40}$/i.test(value)
  )
    throw new Error("Invalid deployment address");
  return value;
}
function block(value: unknown): string {
  if (typeof value !== "string" || !/^\d+$/.test(value))
    throw new Error("Invalid deployment block");
  return value;
}
/** Parse only public deployment fields. Never forward arbitrary manifest keys or RPC secrets. */
export function demoConfig(raw: string, publicRPC: string): Deployment {
  const m = JSON.parse(raw);
  if (
    m.mode !== "HOSTED_FORK_ONLY" ||
    m.syntheticFunding !== true ||
    m.forkChainId !== 143 ||
    !Number.isSafeInteger(m.chainId) ||
    m.chainId < 10000 ||
    m.chainId === 10143
  )
    throw new Error("A distinct demo chain ID is required");
  const startBlock = block(m.startBlock),
    forkBlock = block(m.forkBlock);
  const earnUSDC = m.earnUSDC ? parseUSDCEarn(m.earnUSDC) : undefined;
  if (earnUSDC && earnUSDC.forkBlock !== forkBlock)
    throw new Error("Earn vaults must use the same source fork");
  let explorer: string | undefined;
  if (m.explorer) {
    const url = new URL(m.explorer);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error("Invalid public explorer");
    explorer = url.href.replace(/\/$/, "");
  }
  return {
    mode: "demo",
    chainId: m.chainId,
    name: "Setsuna demo · test funds",
    rpc: publicRPC,
    collateral: venues.collateral,
    exchange: venues.exchange,
    perpId: 1,
    factory: address(m.perplFactory),
    ...(earnUSDC ? { earnUSDC } : {}),
    startBlock,
    ...(m.faucet ? { faucet: address(m.faucet) } : {}),
    ...(explorer ? { explorer } : {}),
    spot: {
      gateway: address(m.spotGateway),
      market: venues.market,
      usdc: venues.usdc,
      startBlock,
    },
    earnMON: {
      vault: address(m.vault),
      gateway: address(m.gateway),
      asset: venues.wmon,
      adapters: [address(m.neverland), address(m.euler)],
      forkBlock,
      startBlock,
    },
    ...(m.perplFixture?.mode === "FIXED_HISTORICAL_MARK" &&
    m.perplFixture?.oracleGuardDisabledOnFork === true
      ? {
          perplFixture: {
            mode: "FIXED_HISTORICAL_MARK",
            oracleGuardDisabledOnFork: true,
            markPNS: block(m.perplFixture.markPNS),
          },
        }
      : {}),
  };
}
const allowed = new Set([
  "eth_chainId",
  "net_version",
  "eth_blockNumber",
  "eth_getBalance",
  "eth_getCode",
  "eth_call",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "eth_getTransactionByHash",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getLogs",
  "eth_sendRawTransaction",
]);
export function validRPCPayload(input: unknown) {
  const entries = Array.isArray(input) ? input : [input];
  if (!entries.length || entries.length > 20) return false;
  return entries.every(
    (r) =>
      r &&
      typeof r === "object" &&
      r.jsonrpc === "2.0" &&
      allowed.has(r.method) &&
      (r.params === undefined || Array.isArray(r.params)) &&
      (typeof r.id === "number" || typeof r.id === "string"),
  );
}
