// The whole sponsored bridge as an app runs it: SDK quote, build, wallet signature, Setsuna's relayer
// (the real server) burning on a local fork of Monad mainnet. Throwaway keys; nothing touches mainnet.
// Run with RUN_FORK=1 (needs anvil and relayer/node_modules).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, pad, parseAbi, parseEther, toHex, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { BRIDGE, createSetsuna, monad } from "../src/index.js";

const skip = !process.env.RUN_FORK;
const FORK = 8547;
const RELAY = 8791;
const POOL = "0x942644106B073E30D72c2C5D7529D5C296ea91ab"; // holds USDC on the fork
const AUSD_HOLDER = "0xf33286E3222D1c829dACeac48c0Ec651F6452470";
const fork = createPublicClient({ chain: monad, transport: http(`http://127.0.0.1:${FORK}`) });
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function totalSupply() view returns (uint256)"]);
const user = privateKeyToAccount(generatePrivateKey());
const setsuna = createSetsuna({ rpcUrl: `http://127.0.0.1:${FORK}`, relayerUrl: `http://127.0.0.1:${RELAY}` });
const children: ChildProcess[] = [];

async function waitFor(check: () => Promise<boolean>, what: string) {
  for (let i = 0; i < 60; i++) {
    if (await check().catch(() => false)) return;
    await sleep(500);
  }
  throw new Error(`${what} did not start`);
}
async function fund(token: Address, from: Address, value: bigint) {
  await fork.request({ method: "anvil_impersonateAccount" as never, params: [from] as never });
  await fork.request({ method: "anvil_setBalance" as never, params: [from, toHex(parseEther("1"))] as never });
  const data = `0xa9059cbb${pad(user.address).slice(2)}${pad(toHex(value)).slice(2)}` as const;
  const hash = await fork.request({ method: "eth_sendTransaction", params: [{ from, to: token, data }] });
  await fork.waitForTransactionReceipt({ hash });
}

before(async () => {
  if (skip) return;
  children.push(spawn("anvil", ["--fork-url", process.env.MONAD_RPC_URL ?? "https://rpc2.monad.xyz", "--port", String(FORK), "--silent"], { stdio: "inherit" }));
  await waitFor(async () => (await fork.getChainId()) === 143, "anvil");
  const relayerKey = generatePrivateKey();
  await fork.request({ method: "anvil_setBalance" as never, params: [privateKeyToAccount(relayerKey).address, toHex(parseEther("10"))] as never });
  await fund(BRIDGE.usdc, POOL, 50_000_000n);
  await fund(BRIDGE.ausd as Address, AUSD_HOLDER, 50_000_000n);
  children.push(
    spawn(process.execPath, ["server.mjs"], {
      cwd: fileURLToPath(new URL("../../../relayer/", import.meta.url)),
      env: { ...process.env, RPC_URL: `http://127.0.0.1:${FORK}`, SETSUNA_RELAYER_PRIVATE_KEY: relayerKey, PORT: String(RELAY), STATS_REPORT_URL: "http://127.0.0.1:9/disabled" },
      stdio: ["ignore", "ignore", "inherit"],
    }),
  );
  await waitFor(async () => (await fetch(`http://127.0.0.1:${RELAY}/health`)).ok, "relayer");
});
after(() => children.forEach((c) => c.kill("SIGTERM")));

test("AUSD out of Monad, gas sponsored: quote, sign once, submit, burned", { skip }, async () => {
  const before = await setsuna.bridge.balances(user.address);
  assert.equal(before.AUSD.raw, "50000000");
  const quote = await setsuna.bridge.quote({ token: "AUSD", amount: "20", destinationDomain: 6 });
  assert.equal(quote.ok, true, quote.problems.join(" "));
  const request = setsuna.bridge.buildSponsored({ owner: user.address, recipient: user.address, quote });
  const signature = await user.signTypedData(request.typedData as never);
  const supply = await fork.readContract({ address: BRIDGE.usdc, abi: erc20, functionName: "totalSupply" });
  const sent = await setsuna.bridge.submitSponsored({ ...request, signature, app: "fork-test" });
  assert.match(sent.burnTx, /^0x[0-9a-f]{64}$/);
  assert.ok(sent.burned && BigInt(sent.burned.raw) >= BigInt(quote.minUsdcOut.raw));
  assert.equal(await fork.readContract({ address: BRIDGE.usdc, abi: erc20, functionName: "totalSupply" }), supply - BigInt(sent.burned!.raw));
  assert.equal((await setsuna.bridge.balances(user.address)).AUSD.raw, "30000000");
  assert.equal(await fork.getBalance({ address: user.address }), 0n); // never needed MON
});

test("USDC to Solana: the mint recipient is the wallet's USDC token account", { skip }, async () => {
  const quote = await setsuna.bridge.quote({ token: "USDC", amount: "5", destinationDomain: 5 });
  const request = setsuna.bridge.buildSponsored({ owner: user.address, recipient: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", quote });
  assert.equal(request.transfer.mintRecipient, "0xd3ea8cf5acaca8cd05207512175c43cef54a5dd99ede20a16b55253738f397dc");
  const sent = await setsuna.bridge.submitSponsored({ ...request, signature: await user.signTypedData(request.typedData as never) });
  assert.equal(sent.burned?.raw, "5000000");
});

test("a signature can't be reused, and a tampered transfer is refused", { skip }, async () => {
  const quote = await setsuna.bridge.quote({ token: "USDC", amount: "2", destinationDomain: 3 });
  const request = setsuna.bridge.buildSponsored({ owner: user.address, recipient: user.address, quote });
  const signature = await user.signTypedData(request.typedData as never);
  await assert.rejects(
    setsuna.bridge.submitSponsored({ ...request, transfer: { ...request.transfer, mintRecipient: pad("0x000000000000000000000000000000000000bAd1") }, signature }),
    /signature doesn't match/,
  );
  await setsuna.bridge.submitSponsored({ ...request, signature });
  await assert.rejects(setsuna.bridge.submitSponsored({ ...request, signature }), /already been used|doesn't match/);
});
