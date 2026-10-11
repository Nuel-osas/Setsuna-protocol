import type { Address } from "viem";
export type Deployment = {
  mode: "local" | "demo" | "preview" | "mainnet";
  chainId: number;
  name: string;
  rpc: string;
  factory?: Address;
  account?: Address;
  owner?: Address;
  collateral: Address;
  exchange: Address;
  perpId: number;
  startBlock?: string;
  faucet?: Address;
  explorer?: string;
  spot?: {
    gateway: Address;
    ordersFactory?: Address;
    market: Address;
    usdc: Address;
    startBlock: string;
  };
  perplFixture?: {
    mode: "FIXED_HISTORICAL_MARK";
    markPNS: string;
    oracleGuardDisabledOnFork: true;
  };
  earnUSDC?: {
    vault: Address;
    asset: Address;
    adapters:
      | [Address, Address, Address, Address]
      | [Address, Address, Address, Address, Address];
    forkBlock: string;
    startBlock: string;
  };
  /** Spot and Perps on Monad mainnet, beside an Earn fork deployment. */
  trading?: Deployment;
  /** Capped setsUSDC and setsMON on Monad mainnet; the fork stays for test funds. */
  earnMainnet?: Deployment;
  earnMON?: {
    vault: Address;
    gateway: Address;
    asset: Address;
    adapters: [Address, Address];
    forkBlock: string;
    startBlock: string;
  };
};
export type Policy = {
  config: {
    capCNS: bigint;
    minTopUpCNS: bigint;
    feeMaxCNS: bigint;
    triggerBufferBps: number;
    targetBufferBps: number;
    feeBps: number;
    maxMarkAgeSec: number;
  };
  usedCNS: bigint;
  active: boolean;
  binding: string;
};
export type Quote = {
  status: number;
  policyId: bigint;
  amountCNS: bigint;
  feeCNS: bigint;
  /** Setsuna's fixed share of a top-up; zero on accounts created before the fee. */
  protocolFeeCNS?: bigint;
  spendableCNS: bigint;
  maintenanceCNS: bigint;
  equityCNS: bigint;
  triggerEquityCNS: bigint;
  targetEquityCNS: bigint;
  markTimestamp: bigint;
};
export type Position = {
  positionType: number;
  lotLNS: bigint;
  depositCNS: bigint;
  pricePNS: bigint;
  deltaPnlCNS: bigint;
  premiumPnlCNS: bigint;
};
export type Market = {
  symbol: string;
  priceDecimals: bigint;
  lotDecimals: bigint;
  markPNS: bigint;
  markTimestamp: bigint;
  basePricePNS?: bigint;
  maxBidPriceONS?: bigint;
  minAskPriceONS?: bigint;
};
export type PerpsOrder = {
  orderId: number;
  accountId: number;
  orderType: number;
  priceONS: number;
  lotLNS: bigint;
  leverageHdths: number;
};
export type Activity = {
  hash: string;
  name: string;
  block: bigint;
  detail: string;
};
export type Snapshot = {
  readAt?: number;
  orderTypesVersion?: bigint;
  openOrders?: PerpsOrder[];
  account?: Address;
  walletBalance: bigint;
  reserve: bigint;
  accountId: bigint;
  policyId: bigint;
  policy?: Policy;
  quote?: Quote;
  position?: Position;
  market?: Market;
  freeTrading?: bigint;
  tradingBalance?: bigint;
  lockedTrading?: bigint;
  activity: Activity[];
  historyUnavailable: boolean;
  block: bigint;
};
