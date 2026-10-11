import { parseAbi, zeroAddress, type Address } from "viem";
import { amount } from "./format.ts";

export const kuruMargin = "0x2A68ba1833cDf93fa9Da1EEbd7F46242aD8E90c5" as const;
export const spotOrdersABI = parseAbi([
  "function accountOf(address) view returns(address)",
  "function createAccount() returns(address)",
  "function market() view returns(address)",
  "function margin() view returns(address)",
  "function usdc() view returns(address)",
  "function owner() view returns(address)",
  "function getOpenOrders() view returns(uint40[] ids, (address ownerAddress,uint96 size,uint40 prev,uint40 next,uint40 flippedId,uint32 price,uint32 flippedPrice,bool isBuy)[] orders)",
  "function placeLimit(bool isBuy,uint32 price,uint96 size,bool postOnly,uint256 maxWalletFunding,uint256 deadline) payable",
  "function cancelOrder(uint40 id)",
  "function withdraw(address token,uint256 amount)",
  "function getBalance(address user,address token) view returns(uint256)",
]);
export type SpotLimitOrder = {
  id: number;
  size: bigint;
  price: number;
  isBuy: boolean;
  ownerAddress: Address;
};
export type SpotOrderSnapshot = {
  account?: Address;
  availableMON: bigint;
  availableUSDC: bigint;
  orders: SpotLimitOrder[];
  timestamp: bigint;
};
const ceil = (n: bigint, d: bigint) => (n + d - BigInt(1)) / d;
export function spotLimitAmounts(
  sizeText: string,
  priceText: string,
  isBuy: boolean,
  params: readonly [
    number,
    bigint,
    Address,
    bigint,
    Address,
    bigint,
    number,
    bigint,
    bigint,
    bigint,
    bigint,
  ],
  available: bigint,
) {
  const [pp, sp, base, bd, , qd, tick, min, max] = params;
  if (
    base !== zeroAddress ||
    bd !== BigInt(18) ||
    qd !== BigInt(6) ||
    pp <= 0 ||
    sp <= BigInt(0) ||
    tick <= 0
  )
    throw new Error("Unsupported Spot market configuration.");
  const mon = amount(sizeText, 18),
    quote = amount(priceText, 18);
  const scale = BigInt(10) ** BigInt(18);
  if ((mon * sp) % scale || (quote * BigInt(pp)) % scale)
    throw new Error("Price or size exceeds the market's precision.");
  const size = (mon * sp) / scale,
    price = (quote * BigInt(pp)) / scale;
  if (size < min || size > max)
    throw new Error(
      `Size must be between ${Number(min) / Number(sp)} and ${Number(max) / Number(sp)} MON.`,
    );
  if (
    price <= BigInt(0) ||
    price >= BigInt(2) ** BigInt(32) ||
    price % BigInt(tick)
  )
    throw new Error(`Price must be a multiple of ${tick / pp} USDC.`);
  const required = isBuy
    ? ceil(price * size * BigInt(1e6), BigInt(pp) * sp)
    : mon;
  const funding = required > available ? required - available : BigInt(0);
  return { size, price: Number(price), required, funding, mon };
}
