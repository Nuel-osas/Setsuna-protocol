import {
  type Abi,
  type Address,
  erc20Abi,
  zeroAddress,
  decodeEventLog,
  formatUnits,
} from "viem";
import accountJson from "../../../contracts/abi/SetsunaAccount.json";
import factoryJson from "../../../contracts/abi/SetsunaFactory.json";
import exchangeJson from "../../../contracts/abi/IPerplExchange.json";
import type {
  Deployment,
  Snapshot,
  Policy,
  Quote,
  Position,
  Market,
} from "./types";
import { clientFor } from "@/components/setsuna/WalletProvider";
import { ausd } from "./format";
import {
  tradeOutcome,
  tradeDescription,
  type TradeOutcome,
} from "./trading-receipt";
const tradeCache = new Map<string, TradeOutcome>();
export const accountAbi = accountJson as Abi;
export const factoryAbi = factoryJson as Abi;
export const exchangeAbi = exchangeJson as Abi;
export const statuses = [
  "Top-up eligible",
  "Policy inactive",
  "No open position",
  "Position changed",
  "Open orders detected",
  "Venue unavailable",
  "Invalid mark price",
  "Stale mark price",
  "Above trigger",
  "Below minimum top-up",
  "Insufficient budget",
  "Reserve unavailable",
];
export async function readSnapshot(
  d: Deployment,
  owner: Address,
): Promise<Snapshot> {
  const c = clientFor(d);
  if ((await c.getChainId()) !== d.chainId)
    throw new Error(
      "The RPC is connected to a different network. Refresh before continuing.",
    );
  const block = await c.getBlockNumber({ cacheTime: 0 });
  const read = (
    address: Address,
    abi: Abi,
    functionName: string,
    args: readonly unknown[] = [],
  ) => c.readContract({ address, abi, functionName, args, blockNumber: block });
  const walletBalance = (await read(d.collateral, erc20Abi, "balanceOf", [
    owner,
  ])) as bigint;
  const base: Snapshot = {
    walletBalance,
    reserve: BigInt(0),
    accountId: BigInt(0),
    policyId: BigInt(0),
    activity: [],
    historyUnavailable: false,
    block,
  };
  if (!d.factory) return base;
  if (!(await c.getCode({ address: d.factory, blockNumber: block })))
    throw new Error(
      "Deployment is unavailable on this node. Restart the local demo and reload.",
    );
  const account = (await read(d.factory, factoryAbi, "accountOf", [
    owner,
  ])) as Address;
  if (account === zeroAddress) return base;
  const [
    actualOwner,
    collateral,
    exchange,
    perpId,
    reserve,
    accountId,
    policyId,
    quote,
  ] = await Promise.all(
    [
      "owner",
      "collateral",
      "exchange",
      "perpId",
      "reserveCNS",
      "accountId",
      "currentPolicyId",
      "previewTopUp",
    ].map((name) => read(account, accountAbi, name)),
  );
  if (
    String(actualOwner).toLowerCase() !== owner.toLowerCase() ||
    String(collateral).toLowerCase() !== d.collateral.toLowerCase() ||
    String(exchange).toLowerCase() !== d.exchange.toLowerCase() ||
    perpId !== BigInt(d.perpId)
  )
    throw new Error(
      "Account configuration differs from this deployment. Actions are unavailable.",
    );
  Object.assign(base, { account, reserve, accountId, policyId, quote });
  if (base.policyId > BigInt(0))
    base.policy = (await read(account, accountAbi, "getPolicy", [
      base.policyId,
    ])) as Policy;
  if (base.accountId > BigInt(0)) {
    const [position, market, info] = await Promise.all([
      read(d.exchange, exchangeAbi, "getPositionV2", [
        BigInt(d.perpId),
        base.accountId,
      ]),
      read(d.exchange, exchangeAbi, "getPerpetualInfo", [BigInt(d.perpId)]),
      read(d.exchange, exchangeAbi, "getAccountById", [base.accountId]),
    ]);
    base.position = (position as [Position, bigint, boolean])[0];
    base.market = market as Market;
    base.freeTrading = (info as { balanceCNS: bigint }).balanceCNS;
  }
  try {
    const from = d.startBlock
      ? BigInt(d.startBlock)
      : block > BigInt(1000)
        ? block - BigInt(1000)
        : BigInt(0);
    const logs = await c.getLogs({
      address: account,
      fromBlock: from,
      toBlock: block,
    });
    base.activity = logs
      .flatMap((log) => {
        try {
          const decoded = decodeEventLog({
            abi: accountAbi,
            data: log.data,
            topics: log.topics,
          });
          const args = decoded.args as unknown as Record<string, unknown>;
          if (!decoded.eventName) return [];
          const labels: Record<string, string> = {
            Initialized: "Trading account initialized",
            ReserveFunded: "Reserve funded",
            ReserveWithdrawn: "Reserve withdrawn",
            TradingDeposited: "Trading collateral deposited",
            TradingWithdrawn: "Trading collateral withdrawn",
            PolicyArmed: "Protection policy armed",
            PolicyRevoked: "Protection policy revoked",
            CapChanged: "Policy cap updated",
            ToppedUp: "Margin top-up executed",
            Refused: "Top-up refused",
            OrderSubmitted: "Order submitted",
          };
          let detail =
            args.amountCNS !== undefined
              ? `${ausd(args.amountCNS as bigint, 6)} AUSD`
              : args.policyId !== undefined
                ? `Policy #${args.policyId}`
                : "Confirmed onchain";
          if (decoded.eventName === "ToppedUp")
            detail += ` + ${ausd(args.feeCNS as bigint, 6)} AUSD fee`;
          if (decoded.eventName === "Refused")
            detail = statuses[Number(args.reason)] ?? "Policy check failed";
          if (decoded.eventName === "OrderSubmitted")
            detail = `Requested ${formatUnits(args.lotLNS as bigint, Number(base.market?.lotDecimals ?? 5))} BTC · fill not implied`;
          return [
            {
              hash: log.transactionHash!,
              name: labels[decoded.eventName] ?? decoded.eventName,
              block: log.blockNumber!,
              detail,
            },
          ];
        } catch {
          return [];
        }
      })
      .reverse()
      .slice(0, 20);
    await Promise.all(
      base.activity
        .filter((a) => a.name === "Order submitted")
        .map(async (a) => {
          try {
            const log = logs.find((l) => l.transactionHash === a.hash);
            const key = `${d.rpc}:${account}:${a.hash}:${log?.blockHash}`;
            let result = tradeCache.get(key);
            if (!result) {
              const receipt = await c.getTransactionReceipt({
                hash: a.hash as `0x${string}`,
              });
              if (receipt.blockHash !== log?.blockHash) return;
              result = tradeOutcome(
                receipt,
                account,
                d.exchange,
                base.accountId,
                BigInt(d.perpId),
              );
              if (tradeCache.size >= 128)
                tradeCache.delete(tradeCache.keys().next().value!);
              tradeCache.set(key, result);
            }
            a.name =
              result.status === "filled"
                ? "Order filled"
                : result.status === "unfilled"
                  ? "Order not filled"
                  : "Order submitted";
            a.detail = tradeDescription(
              result,
              Number(base.market?.lotDecimals ?? 5),
              Number(base.market?.priceDecimals ?? 1),
            );
          } catch {
            /* Keep the explicitly unverified submission if the receipt cannot be read. */
          }
        }),
    );
  } catch {
    base.historyUnavailable = true;
  }
  return base;
}
