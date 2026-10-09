import { NextResponse } from "next/server";
import { createPublicClient, http, parseAbi, type PublicClient } from "viem";
import { allocate, destinations, policy, USDC, type Destination, type EarnSnapshot } from "@/lib/setsuna/earn";

export const dynamic = "force-dynamic";

const RPC = process.env.MONAD_RPC_URL ?? "https://rpc.monad.xyz";
const MORPHO = "0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee" as const;
const YEAR = 31_536_000;
const TTL_MS = 60_000;

const aaveAbi = parseAbi([
  "function getReserveData(address) view returns (uint256 unbacked, uint256 accruedToTreasuryScaled, uint256 totalAToken, uint256 totalStableDebt, uint256 totalVariableDebt, uint256 liquidityRate, uint256 variableBorrowRate, uint256 stableBorrowRate, uint256 averageStableBorrowRate, uint256 liquidityIndex, uint256 variableBorrowIndex, uint40 lastUpdateTimestamp)",
]);
const eulerAbi = parseAbi([
  "function asset() view returns (address)",
  "function totalAssets() view returns (uint256)",
  "function totalBorrows() view returns (uint256)",
  "function cash() view returns (uint256)",
  "function interestRate() view returns (uint256)",
  "function interestFee() view returns (uint16)",
]);
const morphoAbi = parseAbi([
  "function market(bytes32) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)",
  "function idToMarketParams(bytes32) view returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)",
]);
const irmAbi = parseAbi([
  "function borrowRateView((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee) market) view returns (uint256)",
]);

let cache: { at: number; body: EarnSnapshot } | undefined;
const usdc = (v: bigint) => Number(v) / 1e6;
type Reading = { supplyUsd: number; cashUsd: number; apr: number };

async function read(c: PublicClient, d: Destination, blockNumber: bigint, now: number): Promise<Reading> {
  if (d.kind === "aave") {
    // Annual ray-scaled supply rate; reserve factor already reflected.
    const r = await c.readContract({ address: d.source, abi: aaveAbi, functionName: "getReserveData", args: [USDC], blockNumber });
    const supplied = usdc(r[2]);
    return { supplyUsd: supplied, cashUsd: Math.max(0, supplied - usdc(r[3] + r[4])), apr: Number(r[5]) / 1e27 };
  }
  if (d.kind === "euler") {
    // EVK: interestRate is the per-second borrow rate in ray; suppliers earn it × utilization × (1 − fee).
    const [asset, ta, tb, cash, ir, fee] = await Promise.all(
      (["asset", "totalAssets", "totalBorrows", "cash", "interestRate", "interestFee"] as const).map((fn) =>
        c.readContract({ address: d.source, abi: eulerAbi, functionName: fn, blockNumber }),
      ),
    );
    if (String(asset).toLowerCase() !== USDC.toLowerCase()) throw new Error(`${d.protocol} asset is not native USDC`);
    const supplied = usdc(ta as bigint);
    const util = supplied > 0 ? usdc(tb as bigint) / supplied : 0;
    return { supplyUsd: supplied, cashUsd: usdc(cash as bigint), apr: (Number(ir) / 1e27) * YEAR * util * (1 - Number(fee) / 1e4) };
  }
  // Morpho Blue: accrue to the block, then borrow APR × utilization × (1 − fee).
  const id = d.source;
  const [mkt, params] = await Promise.all([
    c.readContract({ address: MORPHO, abi: morphoAbi, functionName: "market", args: [id], blockNumber }),
    c.readContract({ address: MORPHO, abi: morphoAbi, functionName: "idToMarketParams", args: [id], blockNumber }),
  ]);
  if (params[0].toLowerCase() !== USDC.toLowerCase()) throw new Error(`${d.name} loan token is not native USDC`);
  const [tsa, tss, tba, tbs, last, fee] = mkt;
  const rate = await c.readContract({
    address: params[3],
    abi: irmAbi,
    functionName: "borrowRateView",
    args: [
      { loanToken: params[0], collateralToken: params[1], oracle: params[2], irm: params[3], lltv: params[4] },
      { totalSupplyAssets: tsa, totalSupplyShares: tss, totalBorrowAssets: tba, totalBorrowShares: tbs, lastUpdate: last, fee },
    ],
    blockNumber,
  });
  const r = Number(rate) / 1e18;
  const growth = Math.expm1(r * Math.max(0, now - Number(last)));
  const borrow = usdc(tba) * (1 + growth);
  const supply = usdc(tsa) + usdc(tba) * growth;
  return { supplyUsd: supply, cashUsd: Math.max(0, supply - borrow), apr: supply > 0 ? r * YEAR * (borrow / supply) * (1 - Number(fee) / 1e18) : 0 };
}

async function load(): Promise<EarnSnapshot> {
  const c = createPublicClient({ transport: http(RPC, { timeout: 12_000 }) }) as PublicClient;
  if ((await c.getChainId()) !== 143) throw new Error("RPC is not Monad mainnet");
  const block = await c.getBlock();
  const now = Number(block.timestamp);
  const rows = await Promise.all(destinations.map(async (d) => ({ ...d, ...(await read(c, d, block.number, now)) })));
  const { rows: allocated, blended, idle } = allocate(rows);
  return {
    source: "Aave V3, Euler, Morpho Blue and Neverland on Monad mainnet",
    basis: "Base supply APR. Excludes reward incentives.",
    fetchedAt: new Date(now * 1000).toISOString(),
    block: block.number.toString(),
    destinations: allocated,
    bufferPct: policy.bufferPct,
    idlePct: Math.round(idle * 1000) / 10,
    blendedApr: blended,
  };
}

export async function GET() {
  try {
    if (!cache || Date.now() - cache.at > TTL_MS) cache = { at: Date.now(), body: await load() };
    return NextResponse.json(cache.body, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (cache) return NextResponse.json({ ...cache.body, error: "Showing the last good reading; the chain read failed." });
    return NextResponse.json(
      { source: "Monad mainnet", basis: "Base supply APR", fetchedAt: new Date().toISOString(), destinations: [], bufferPct: policy.bufferPct, idlePct: 100, blendedApr: 0, error: String(e) } satisfies EarnSnapshot,
      { status: 502 },
    );
  }
}
