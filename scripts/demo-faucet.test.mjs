import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeAbiParameters, encodeEventTopics } from "viem";
import {
  confirmsDemoFunding,
  demoFaucetAbi,
} from "../src/lib/setsuna/demo-faucet.ts";

const faucet = "0x1111111111111111111111111111111111111111";
const recipient = "0x2222222222222222222222222222222222222222";
const other = "0x3333333333333333333333333333333333333333";
const log = {
  address: faucet,
  topics: encodeEventTopics({
    abi: demoFaucetAbi,
    eventName: "DemoFundsClaimed",
    args: { recipient },
  }),
  data: encodeAbiParameters([{ type: "uint256" }], [1791540000n]),
};
test("funding recovery confirms only the configured faucet and current recipient", () => {
  const receipt = { status: "success", logs: [log] };
  assert(confirmsDemoFunding(receipt, faucet, recipient));
  assert.equal(confirmsDemoFunding(receipt, faucet, other), false);
  assert.equal(
    confirmsDemoFunding({ ...receipt, status: "reverted" }, faucet, recipient),
    false,
  );
  assert.equal(
    confirmsDemoFunding(
      { ...receipt, logs: [{ ...log, address: other }] },
      faucet,
      recipient,
    ),
    false,
  );
  assert.equal(
    confirmsDemoFunding({ ...receipt, logs: [] }, faucet, recipient),
    false,
  );
  assert.equal(
    confirmsDemoFunding(
      { ...receipt, logs: [{ ...log, data: "0x" }] },
      faucet,
      recipient,
    ),
    false,
  );
});
