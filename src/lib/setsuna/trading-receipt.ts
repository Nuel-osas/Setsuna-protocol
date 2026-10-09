import {
  decodeEventLog,
  formatUnits,
  parseAbi,
  type Address,
  type TransactionReceipt,
} from "viem";
import { perplEvents } from "./perpl-events.ts";

const submittedABI = parseAbi([
  "event OrderSubmitted(uint256 indexed positionNonce, uint8 orderType, uint256 lotLNS)",
]);

export type TradeOutcome = {
  status: "filled" | "unfilled" | "unverified" | "reverted";
  lots?: bigint;
  pricePNS?: bigint;
  feeCNS?: bigint;
  side?: number;
};

/** Match this account's single FOK request, not maker fills elsewhere in the receipt. */
export function tradeOutcome(
  receipt: Pick<TransactionReceipt, "status" | "logs">,
  account: Address,
  exchange: Address,
  accountId: bigint,
  perpId: bigint,
): TradeOutcome {
  if (receipt.status !== "success") return { status: "reverted" };
  const events = receipt.logs.flatMap((log) => {
    try {
      const isAccount = log.address.toLowerCase() === account.toLowerCase();
      if (!isAccount && log.address.toLowerCase() !== exchange.toLowerCase())
        return [];
      const decoded = decodeEventLog({
        abi: isAccount ? submittedABI : perplEvents,
        data: log.data,
        topics: log.topics,
      });
      return [
        {
          name: decoded.eventName,
          args: decoded.args as unknown as Record<
            string,
            bigint | number | boolean
          >,
          isAccount,
        },
      ];
    } catch {
      return [];
    }
  });
  const requests = events.filter(
    (e) => !e.isAccount && e.name.startsWith("OrderRequest"),
  );
  const submitted = events.filter(
    (e) => e.isAccount && e.name === "OrderSubmitted",
  );
  if (requests.length !== 1 || submitted.length !== 1)
    return { status: "unverified" };
  const req = requests[0].args;
  if (
    req.accountId !== accountId ||
    req.perpId !== perpId ||
    req.fillOrKill !== true ||
    req.lotLNS !== submitted[0].args.lotLNS ||
    req.orderType !== submitted[0].args.orderType
  )
    return { status: "unverified" };
  const fills = events.filter(
    (e) => !e.isAccount && e.name.startsWith("TakerOrderFilled"),
  );
  if (!fills.length)
    return { status: "unfilled", lots: BigInt(0), side: Number(req.orderType) };
  const lots = fills.reduce(
    (sum, e) => sum + BigInt(e.args.lotLNS as bigint),
    BigInt(0),
  );
  if (lots !== req.lotLNS || lots <= BigInt(0)) return { status: "unverified" };
  const weighted = fills.reduce(
    (sum, e) =>
      sum +
      BigInt(e.args.entryPricePNS as bigint) * BigInt(e.args.lotLNS as bigint),
    BigInt(0),
  );
  return {
    status: "filled",
    lots,
    side: Number(req.orderType),
    pricePNS: weighted / lots,
    feeCNS: fills.reduce(
      (sum, e) =>
        sum +
        BigInt(e.args.feeCNS as bigint) +
        BigInt((e.args.builderFeeCNS as bigint) ?? 0),
      BigInt(0),
    ),
  };
}

export function tradeDescription(
  result: TradeOutcome,
  lotDecimals = 5,
  priceDecimals = 1,
) {
  if (result.status === "unfilled")
    return "No fill. No position was opened or closed. Any previous protection was revoked; re-arm it if needed.";
  if (result.status === "reverted")
    return "Order reverted. No trade was applied.";
  if (result.status === "unverified")
    return "Fill could not be verified. Check your position and transaction before placing another order.";
  const action = ["Long", "Short", "Close long", "Close short"][result.side!];
  return `${action} filled: ${formatUnits(result.lots!, lotDecimals)} BTC at $${formatUnits(result.pricePNS!, priceDecimals)} · ${formatUnits(result.feeCNS!, 6)} AUSD fee.`;
}
