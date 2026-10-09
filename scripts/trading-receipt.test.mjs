import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeAbiParameters, encodeEventTopics, parseAbi } from "viem";
import { perplEvents } from "../src/lib/setsuna/perpl-events.ts";
import { message } from "../src/lib/setsuna/format.ts";
import {
  tradeOutcome,
  tradeDescription,
} from "../src/lib/setsuna/trading-receipt.ts";

const account = "0x1111111111111111111111111111111111111111";
const exchange = "0x2222222222222222222222222222222222222222";
const foreign = "0x3333333333333333333333333333333333333333";
const submitted = parseAbi([
  "event OrderSubmitted(uint256 indexed positionNonce, uint8 orderType, uint256 lotLNS)",
]);
const log = (abi, eventName, address, args) => {
  const event = abi.find((e) => e.name === eventName);
  return {
    address,
    topics: encodeEventTopics({ abi, eventName, args }),
    data: encodeAbiParameters(
      event.inputs.filter((i) => !i.indexed),
      event.inputs.filter((i) => !i.indexed).map((i) => args[i.name]),
    ),
  };
};
const request = (patch = {}) =>
  log(perplEvents, "OrderRequestV2", exchange, {
    perpId: 1n,
    accountId: 12n,
    orderDescId: 0n,
    orderId: 0n,
    orderType: 0,
    pricePNS: 853000n,
    lotLNS: 100n,
    expiryBlock: 0n,
    postOnly: false,
    fillOrKill: true,
    immediateOrCancel: false,
    maxMatches: 30n,
    leverageHdths: 1000n,
    lastExecutionBlock: 0n,
    amountCNS: 0n,
    maxNegPnlCollatBPS: 100n,
    gasLeft: 100000n,
    extension: "0x",
    ...patch,
  });
const submit = log(submitted, "OrderSubmitted", account, {
  positionNonce: 1n,
  orderType: 0,
  lotLNS: 100n,
});
const fill = (address = exchange, lots = 100n) =>
  log(perplEvents, "TakerOrderFilledV2", address, {
    entryPricePNS: 852190n,
    collatPricePNS: 852190n,
    pnlPricePNS: 852190n,
    lotLNS: lots,
    feeCNS: 29000n,
    amountCNS: -8500000n,
    balanceCNS: 90000000n,
    builderId: 0n,
    builderFeeCNS: 0n,
  });
const outcome = (logs, status = "success") =>
  tradeOutcome({ logs, status }, account, exchange, 12n, 1n);
test("actual venue taker fill is scoped to account and request", () => {
  const result = outcome([request(), fill(), submit]);
  assert.equal(result.status, "filled");
  assert.equal(result.lots, 100n);
  assert.match(
    tradeDescription(result),
    /Long filled: 0.001 BTC at \$85219 · 0.029 AUSD fee/,
  );
});
test("a successful submission without a taker fill reports no fill", () => {
  const result = outcome([request(), submit]);
  assert.equal(result.status, "unfilled");
  assert.match(tradeDescription(result), /protection was revoked/);
});
test("foreign emitters cannot claim a fill", () => {
  assert.equal(outcome([request(), fill(foreign), submit]).status, "unfilled");
});
test("wrong account, market, missing submission and ambiguous requests remain unverified", () => {
  for (const logs of [
    [request({ accountId: 99n }), fill(), submit],
    [request({ perpId: 2n }), fill(), submit],
    [request(), fill()],
    [request(), request(), fill(), submit],
    [request(), fill(exchange, 50n), submit],
    [fill(), submit],
  ])
    assert.equal(outcome(logs).status, "unverified");
});
test("reverted receipt cannot report filled", () => {
  assert.equal(
    outcome([request(), fill(), submit], "reverted").status,
    "reverted",
  );
});
test("Perpl no-liquidity revert has a readable message", () => {
  assert.equal(
    message({
      shortMessage:
        "Execution reverted with reason: custom error 0x578f7fed: \u0000",
    }),
    "Order cannot fill completely at this limit. Try a different price or size.",
  );
});
