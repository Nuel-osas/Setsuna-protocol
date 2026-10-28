import { parseAbi } from "viem";

/** The parts of the Setsuna vaults the SDK reads or calls. Both vault types share these. */
export const vaultAbi = parseAbi([
  "function asset() view returns (address)",
  "function totalAssets() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
  "function previewDeposit(uint256 assets) view returns (uint256)",
  "function previewRedeem(uint256 shares) view returns (uint256)",
  "function previewWithdraw(uint256 assets) view returns (uint256)",
  "function maxDeposit(address receiver) view returns (uint256)",
  "function maxRedeem(address owner) view returns (uint256)",
  "function maxWithdraw(address owner) view returns (uint256)",
  "function accounting() view returns (uint256 nav, bool healthy)",
  "function depositCap() view returns (uint256)",
  "function depositsPaused() view returns (bool)",
  "function performanceFeeBps() view returns (uint256)",
  "function guardian() view returns (address)",
  "function lastRebalanceAt() view returns (uint256)",
  "function minimumMarketSupply() view returns (uint256)",
  "function disabled(uint256) view returns (bool)",
  "function BUFFER_BPS() view returns (uint256)",
  "function DESTINATION_CAP_BPS() view returns (uint256)",
  "function MOVE_BPS() view returns (uint256)",
  "function COOLDOWN() view returns (uint256)",
  "function OBSERVATION_INTERVAL() view returns (uint256)",
  "function MAX_OBSERVATION_AGE() view returns (uint256)",
  "function MAX_RATE_CHANGE_BPS() view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function depositWithMinShares(uint256 assets, address receiver, uint256 minShares, uint256 deadline) returns (uint256)",
  "function redeemWithMinAssets(uint256 shares, address receiver, address owner, uint256 minAssets, uint256 deadline) returns (uint256)",
]);

/** Only setsUSDC caps each venue by a share of that market's cash. */
export const multiVaultAbi = parseAbi(["function MARKET_CASH_CAP_BPS() view returns (uint256)"]);

export const adapterAbi = parseAbi([
  "function totalAssets() view returns (uint256)",
  "function supplyApr(int256 liquidityDelta) view returns (uint256)",
  "function availableLiquidity() view returns (uint256)",
  "function depositCapacity() view returns (uint256)",
  "function marketSupply() view returns (uint256)",
]);

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

export const monGatewayAbi = parseAbi([
  "function depositMON(address receiver, uint256 minShares, uint256 deadline) payable returns (uint256)",
  "function redeemMON(uint256 shares, address receiver, uint256 minAssets, uint256 deadline) returns (uint256)",
]);

/** setsAUSD: AUSD savings in setsUSDC through a Curve stable pool, with permit on its shares. */
export const ausdWrapperAbi = parseAbi([
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function nonces(address) view returns (uint256)",
  "function totalAssets() view returns (uint256)",
  "function maxDeposit(address) view returns (uint256)",
  "function maxRedeem(address owner) view returns (uint256)",
  "function convertToShares(uint256 assets) view returns (uint256)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
  "function previewDeposit(uint256 assets) view returns (uint256)",
  "function previewRedeem(uint256 shares) view returns (uint256)",
  "function depositWithMinShares(uint256 assets, address receiver, uint256 minShares) returns (uint256)",
  "function redeemWithMinAssets(uint256 shares, address receiver, address owner, uint256 minAssets) returns (uint256)",
  "function unwrap(uint256 shares, address receiver, address owner)",
  "function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)",
  "function MIN_OUT_BPS() view returns (uint256)",
]);

export const curveStablePoolAbi = parseAbi(["function get_dy(int128 i, int128 j, uint256 dx) view returns (uint256)"]);
