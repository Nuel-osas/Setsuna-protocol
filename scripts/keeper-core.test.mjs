import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { encodeAbiParameters, encodeEventTopics } from "viem";
import { checkAccount, PendingReceiptError } from "./keeper-core.mjs";

const abi = JSON.parse(await readFile(new URL("../contracts/abi/SetsunaAccount.json", import.meta.url), "utf8"));
const address = "0x1111111111111111111111111111111111111111";
const keeper = "0x2222222222222222222222222222222222222222";
const hash = `0x${"ab".repeat(32)}`;
function fixture({ status = 0, simulation = 0, logs = [], receiptStatus = "success", receiptError = false } = {}) {
  const calls = { sent: 0, simulations: 0 };
  const publicClient = {
    readContract: async () => ({ status, policyId: 1n, amountCNS: 12_000_000n, feeCNS: 120_000n }),
    getGasPrice: async () => 100n,
    simulateContract: async (request) => { calls.simulations++; return { request, result: simulation }; },
    waitForTransactionReceipt: async () => {
      if (receiptError) throw new Error("timeout");
      return { status: receiptStatus, logs, blockNumber: 42n, gasUsed: 150_000n };
    },
  };
  const walletClient = { account: { address: keeper }, writeContract: async () => { calls.sent++; return hash; } };
  return { calls, parameters: { publicClient, walletClient, address, abi, execute: true, maxGasPrice: 200n } };
}

test("read-only mode never simulates or signs even when a rescue is ready", async () => {
  const f = fixture();
  const result = await checkAccount({ ...f.parameters, execute: false });
  assert.equal(result.action, "observed"); assert.equal(f.calls.sent, 0); assert.equal(f.calls.simulations, 0);
});

test("non-ready state and a changed simulation never send", async () => {
  for (const setup of [{ status: 8 }, { simulation: 8 }]) {
    const f = fixture(setup); await checkAccount(f.parameters); assert.equal(f.calls.sent, 0);
  }
});

test("gas and fee ceilings are enforced before sending", async () => {
  const f = fixture();
  assert.equal((await checkAccount({ ...f.parameters, maxGasPrice: 99n })).action, "gas-above-ceiling");
  assert.equal((await checkAccount({ ...f.parameters, minFee: 120_001n })).action, "fee-below-minimum");
  assert.equal(f.calls.sent, 0);
});

test("successful refusal receipt is not reported as a rescue", async () => {
  const refusal = { address, topics: encodeEventTopics({ abi, eventName: "Refused", args: { policyId: 1n } }), data: encodeAbiParameters([{ type: "uint8" }], [8]) };
  const f = fixture({ logs: [refusal] });
  assert.equal((await checkAccount(f.parameters)).action, "refused-onchain");
  assert.equal(f.calls.sent, 1);
});

test("only this account's rescue event establishes a confirmed outcome", async () => {
  const event = { address, topics: encodeEventTopics({ abi, eventName: "ToppedUp", args: { policyId: 1n, rescuer: keeper } }),
    data: encodeAbiParameters(Array.from({ length: 4 }, () => ({ type: "uint256" })), [12_000_000n, 120_000n, 12_120_000n, 87_880_000n]) };
  assert.equal((await checkAccount(fixture({ logs: [event] }).parameters)).action, "rescued");
  assert.equal((await checkAccount(fixture({ logs: [{ ...event, address: keeper }] }).parameters)).action, "unconfirmed-outcome");
});

test("reverted transactions and unknown receipts do not become successful outcomes", async () => {
  assert.equal((await checkAccount(fixture({ receiptStatus: "reverted" }).parameters)).action, "reverted");
  await assert.rejects(checkAccount(fixture({ receiptError: true }).parameters), (error) => error instanceof PendingReceiptError && error.hash === hash);
});
