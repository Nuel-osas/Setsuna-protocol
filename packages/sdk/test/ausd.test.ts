// setsAUSD against Monad mainnet: reads, quotes, prepared calls and the gasless signatures. Sends nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicClient, decodeFunctionData, hashDomain, http, parseAbi, parseSignature } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { AUSD_SAVINGS, ausdWrapperAbi, createSetsuna, monad } from "../src/index.js";

const setsuna = createSetsuna();
const chain = createPublicClient({ chain: monad, transport: http("https://rpc2.monad.xyz") });
// A large AUSD holder on Monad, standing in for a saver in read-only simulations.
const AUSD_HOLDER = "0xf33286E3222D1c829dACeac48c0Ec651F6452470";
const domainAbi = parseAbi(["function DOMAIN_SEPARATOR() view returns (bytes32)"]);

test("setsAUSD reads healthy: peg inside the floor, tiny swap cost, room under the cap", async () => {
  const s = await setsuna.ausd.getSavings();
  assert.equal(s.address, AUSD_SAVINGS.address);
  assert.equal(s.pegOk, true);
  assert.ok(s.roundTripCostPct >= 0 && s.roundTripCostPct < 0.1, `round trip ${s.roundTripCostPct}%`);
  assert.ok(Number(s.capRemaining.formatted) > 0);
  assert.ok(s.netAprPct > 0);
});

test("a deposit quote checks the wallet and previews shares", async () => {
  const noFunds = await setsuna.ausd.quoteDeposit("100", "0x000000000000000000000000000000000000dEaD");
  assert.equal(noFunds.ok, false);
  assert.match(noFunds.problems.join(" "), /holds 0 AUSD/);
  const q = await setsuna.ausd.quoteDeposit("100", AUSD_HOLDER);
  assert.equal(q.ok, true);
  assert.ok(Number(q.shares.formatted) > 99 && Number(q.shares.formatted) < 100.1, q.shares.formatted);
  const over = await setsuna.ausd.quoteDeposit("1000000");
  assert.equal(over.ok, false);
  assert.match(over.problems.join(" "), /before its cap/);
});

test("a prepared deposit approves exactly, then deposits with a minimum, and the approval simulates", async () => {
  const p = await setsuna.ausd.prepareDeposit("25", AUSD_HOLDER);
  assert.equal(p.transactions.length, 2);
  const [approve, save] = p.transactions;
  assert.equal(approve.to, AUSD_SAVINGS.asset);
  await chain.call({ account: AUSD_HOLDER, to: approve.to, data: approve.data });
  const call = decodeFunctionData({ abi: ausdWrapperAbi, data: save.data });
  assert.equal(call.functionName, "depositWithMinShares");
  assert.equal(call.args[0], 25_000_000n);
  assert.equal(save.to, AUSD_SAVINGS.address);
  assert.equal(call.args[1], AUSD_HOLDER);
  assert.equal(call.args[2], BigInt(p.minimum.raw));
  assert.ok(BigInt(p.minimum.raw) < BigInt(p.expected.shares.raw));
});

test("withdrawing from an empty position is explained, not prepared", async () => {
  await assert.rejects(setsuna.ausd.prepareWithdraw(AUSD_HOLDER, { all: true }), /nothing to withdraw/);
});

test("the gasless deposit signature uses AUSD's own EIP-712 domain", async () => {
  const saver = privateKeyToAccount(generatePrivateKey());
  const { typedData } = setsuna.ausd.buildGaslessDeposit({ owner: saver.address, to: AUSD_HOLDER, amount: "5" });
  const onchain = await chain.readContract({ address: AUSD_SAVINGS.asset, abi: domainAbi, functionName: "DOMAIN_SEPARATOR" });
  assert.equal(hashDomain({ domain: typedData.domain, types: { EIP712Domain: [
    { name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" },
  ] } }), onchain);
  assert.equal(typedData.message.value, 5_000_000n);
  assert.ok(typedData.message.validBefore > BigInt(Math.floor(Date.now() / 1000)));
});

test("the gasless withdrawal permit is accepted by setsAUSD on mainnet", async () => {
  const saver = privateKeyToAccount(generatePrivateKey());
  // permit needs no balance, so a fresh key's signature proves the domain, types and nonce are right.
  const nonce = await chain.readContract({ address: AUSD_SAVINGS.address, abi: ausdWrapperAbi, functionName: "nonces", args: [saver.address] });
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const typedData = {
    domain: { name: AUSD_SAVINGS.name, version: "1", chainId: 143, verifyingContract: AUSD_SAVINGS.address },
    types: { Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
    primaryType: "Permit" as const,
    message: { owner: saver.address, spender: AUSD_HOLDER, value: 1n, nonce, deadline },
  };
  const { v, r, s } = parseSignature(await saver.signTypedData(typedData));
  await chain.simulateContract({
    address: AUSD_SAVINGS.address, abi: ausdWrapperAbi, functionName: "permit",
    args: [saver.address, AUSD_HOLDER, 1n, deadline, Number(v), r, s], account: AUSD_HOLDER,
  });
  // And a stranger's signature is refused.
  const stranger = privateKeyToAccount(generatePrivateKey());
  const bad = parseSignature(await stranger.signTypedData(typedData));
  await assert.rejects(chain.simulateContract({
    address: AUSD_SAVINGS.address, abi: ausdWrapperAbi, functionName: "permit",
    args: [saver.address, AUSD_HOLDER, 1n, deadline, Number(bad.v), bad.r, bad.s], account: AUSD_HOLDER,
  }));
});
