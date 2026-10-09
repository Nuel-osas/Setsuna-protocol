// Read-only Monad lending screen. Never sends transactions or loads wallet keys.
// Default block matches NativeEarnMarketsFork.t.sol; --latest refreshes discovery.
import { createPublicClient, http, parseAbi, formatUnits, keccak256 } from "viem";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const PIN = 111560409n;
const PIN_HASH = "0xc8a3dcf05b4b35daf91e0abc74bc91ebc2ec45830d93a8f2b6451cff8214a84b";
const USDC = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
const REGISTRY = "0x1310f352f1389969Ece6741671c4B919523912fF";
const TOWN_POOL = "0xdb4E67F878289A820046f46f6304fd6Ee1449281";
const TOWN_SPOKE = "0xA457235B68606a7921b7c525D92e9592e793b4C0";
const FLOOR = 250000n * 10n ** 6n;
const PROBE = "0x0000000000000000000000000000000000000001";
const client = createPublicClient({ transport: http(process.env.MONAD_RPC_URL ?? "https://rpc-mainnet.monadinfra.com", { timeout: 20000, retryCount: 1 }) });
if (await client.getChainId() !== 143) throw new Error("Expected Monad chain 143");
const block = await client.getBlock(process.argv.includes("--latest") ? {} : { blockNumber: PIN });
if (block.number === PIN && block.hash !== PIN_HASH) throw new Error("Unexpected source block hash");
const read = (address, signature, args = []) => client.readContract({
  address, abi: parseAbi([signature]), functionName: signature.match(/function (\w+)/)[1], args, blockNumber: block.number,
});
const codeHash = async (address) => {
  const code = await client.getCode({ address, blockNumber: block.number });
  if (!code || code === "0x") throw new Error(`No contract at ${address}`);
  return keccak256(code);
};
const report = {
  scope: "Read-only discovery; size/rate screen is not production approval or a withdrawal guarantee",
  chainId: 143, blockNumber: block.number, blockHash: block.hash, parentHash: block.parentHash,
  timestamp: block.timestamp, sourceTime: new Date(Number(block.timestamp) * 1000).toISOString(),
  usdc: USDC, minimumMarketAssets: FLOOR, decimals: await read(USDC, "function decimals() view returns (uint8)"),
  curvance: { registry: REGISTRY, registryCodeHash: await codeHash(REGISTRY), markets: [], errors: [] },
  townsquare: { pool: TOWN_POOL, spoke: TOWN_SPOKE, errors: [] },
  sources: [
    "https://github.com/curvance/curvance-contracts/blob/develop/script/DeployOptimizerAnvil.s.sol",
    "https://github.com/curvance/curvance-contracts/blob/develop/contracts/interfaces/IDynamicIRM.sol",
    "https://app.curvance.com/transparency",
    "https://app.townsq.xyz/",
    "https://github.com/TowneSquare/TownSqVault",
  ],
};
if (report.decimals !== 6) throw new Error("Unexpected USDC decimals");
const managers = await read(REGISTRY, "function marketManagers() view returns (address[])");
report.curvance.managers = managers;
console.log(`Monad block ${block.number}; ${managers.length} Curvance market managers`);
for (const manager of managers) {
  try {
    const addresses = await read(manager, "function queryTokensListed() view returns (address[])");
    const tokens = await Promise.all(addresses.map(async address => ({
      address,
      asset: await read(address, "function asset() view returns (address)"),
      name: await read(address, "function name() view returns (string)"),
    })));
    for (const token of tokens.filter(t => t.asset.toLowerCase() === USDC.toLowerCase())) {
      const fields = {
        totalAssets: "function totalAssets() view returns (uint256)",
        assetsHeld: "function assetsHeld() view returns (uint256)",
        debt: "function marketOutstandingDebt() view returns (uint256)",
        feeBps: "function interestFee() view returns (uint16)",
        irm: "function IRM() view returns (address)",
        centralRegistry: "function centralRegistry() view returns (address)",
      };
      const market = { ...token, manager, codeHash: await codeHash(token.address), collateral: tokens.filter(t => t.address !== token.address) };
      for (const [key, signature] of Object.entries(fields)) market[key] = await read(token.address, signature);
      if (market.centralRegistry.toLowerCase() !== REGISTRY.toLowerCase()) throw new Error("Registry mismatch");
      market.maxDeposit = await read(token.address, "function maxDeposit(address) view returns (uint256)", [PROBE]);
      market.actionsPaused = await read(manager, "function actionsPaused(address) view returns (bool,bool,bool)", [token.address]);
      market.redeemPausedRaw = await read(manager, "function redeemPaused() view returns (uint8)");
      market.supplyRatePerSecondWad = await read(market.irm, "function supplyRate(uint256,uint256,uint256) view returns (uint256)", [market.assetsHeld, market.debt, market.feeBps]);
      market.indicativeBaseAprWad = market.supplyRatePerSecondWad * 31536000n;
      market.tenPercentCashLimit = market.assetsHeld / 10n;
      market.passesPreliminaryScreen = market.totalAssets >= FLOOR && market.maxDeposit > 0n && !market.actionsPaused[0]
        && market.redeemPausedRaw === 1 && market.assetsHeld > 0n && market.indicativeBaseAprWad > 0n && market.indicativeBaseAprWad <= 10n ** 18n;
      // supplyRate() is documented as frontend-only; do not copy it into an onchain allocator.
      market.rateCaveat = "Indicative frontend quote; pending accrual/model adjustment and reward vesting require adapter-specific handling";
      report.curvance.markets.push(market);
      console.log(`${token.address}: ${formatUnits(market.totalAssets, 6)} USDC supplied; screen=${market.passesPreliminaryScreen}`);
    }
  } catch (error) {
    report.curvance.errors.push({ manager, error: error.shortMessage ?? error.message });
  }
}

const town = report.townsquare;
try {
  town.poolCodeHash = await codeHash(TOWN_POOL);
  town.spokeCodeHash = await codeHash(TOWN_SPOKE);
  town.deposit = await read(TOWN_POOL, "function getDepositData() view returns ((uint16 optimalUtilisationRatio,uint256 totalAmount,uint256 interestRate,uint256 interestIndex))");
  town.variableBorrow = await read(TOWN_POOL, "function getVariableBorrowData() view returns ((uint32 vr0,uint32 vr1,uint32 vr2,uint256 totalAmount,uint256 interestRate,uint256 interestIndex))");
  town.stableBorrow = await read(TOWN_POOL, "function getStableBorrowData() view returns ((uint32 sr0,uint32 sr1,uint32 sr2,uint32 sr3,uint16 optimalStableToTotalDebtRatio,uint16 increaseBorrowBalanceUtilisationRatio,uint16 increaseBorrowBalanceDepositInterestRate,uint16 decreaseBorrowBalanceDelta,uint256 totalAmount,uint256 interestRate,uint256 averageInterestRate))");
  town.config = await read(TOWN_POOL, "function getConfigData() view returns ((bool deprecated,bool stableBorrowSupported,bool canMintTsToken,bool flashLoanSupported))");
  town.caps = await read(TOWN_POOL, "function getCapsData() view returns ((uint64 deposit,uint64 borrow,uint64 stableBorrowPercentage))");
  town.lastUpdateTimestamp = await read(TOWN_POOL, "function getLastUpdateTimestamp() view returns (uint256)");
  town.poolId = await read(TOWN_POOL, "function getPoolId() view returns (uint8)");
  town.asset = await read(TOWN_SPOKE, "function token() view returns (address)");
  if (town.asset.toLowerCase() !== USDC.toLowerCase() || town.poolId !== 10) throw new Error("TownSquare USDC identity mismatch");
  town.poolUSDC = await read(USDC, "function balanceOf(address) view returns (uint256)", [TOWN_POOL]);
  town.spokeUSDC = await read(USDC, "function balanceOf(address) view returns (uint256)", [TOWN_SPOKE]);
  const borrowed = town.variableBorrow.totalAmount + town.stableBorrow.totalAmount;
  town.accountingCash = town.deposit.totalAmount > borrowed ? town.deposit.totalAmount - borrowed : 0n;
  town.meetsSizeFloor = town.deposit.totalAmount >= FLOOR;
  town.note = "Direct USDC lending pool only; stored totals and rate at lastUpdateTimestamp, not a survey of managed-yield vaults or proof of exit capacity";
  console.log(`TownSquare: ${formatUnits(town.deposit.totalAmount, 6)} USDC supplied; size floor=${town.meetsSizeFloor}`);
} catch (error) { town.errors.push(error.shortMessage ?? error.message); }
report.complete = report.curvance.errors.length === 0 && town.errors.length === 0;
const outArg = process.argv.find(arg => arg.startsWith("--out="));
const output = resolve(outArg ? outArg.slice(6) : ".local/native-market-screen/screen.json");
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report, (_, value) => typeof value === "bigint" ? value.toString() : value, 2)}\n`);
console.log(`Saved ${output}; complete=${report.complete}`);
if (!report.complete) { console.error(JSON.stringify({ curvance: report.curvance.errors, townsquare: town.errors })); process.exitCode = 1; }
