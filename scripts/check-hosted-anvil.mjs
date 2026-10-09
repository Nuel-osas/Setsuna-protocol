import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { openSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  http,
  parseAbi,
  parseEther,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const { values } = parseArgs({
  options: { dir: { type: "string", default: ".local/railway-anvil-proof" } },
});
const dir = resolve(values.dir);
const config = JSON.parse(readFileSync(`${dir}/config.json`, "utf8"));
const base = `http://127.0.0.1:${config.PORT}`;
const rpc = `${base}/${config.SETSUNA_GATEWAY_TOKEN}`;
const fundingRPC = `${base}/faucet/${config.SETSUNA_FAUCET_TOKEN}`;
const client = createPublicClient({
  transport: http(rpc, { timeout: 15000, retryCount: 0 }),
});
const account = privateKeyToAccount(generatePrivateKey());
const wallet = createWalletClient({
  account,
  transport: http(rpc, { timeout: 15000, retryCount: 0 }),
});
const faucetABI = parseAbi(["function claim(address)"]);
const vaultABI = parseAbi([
  "function deposit(uint256,address) returns(uint256)",
  "function redeem(uint256,address,address) returns(uint256)",
  "function balanceOf(address) view returns(uint256)",
]);
const txs = [];
const call = async (url, method, params = []) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(20000),
  });
  return { status: response.status, body: await response.json() };
};
const healthy = async () => {
  for (let i = 0; i < 180; i++) {
    try {
      if (
        (await fetch(`${base}/health`, { signal: AbortSignal.timeout(1000) }))
          .ok
      )
        return;
    } catch {}
    await delay(500);
  }
  throw new Error("Hosted demo health timeout");
};
const confirmed = async (hash) => {
  const receipt = await client.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, "success");
  txs.push(hash);
  return receipt;
};
await healthy();
const { manifest: m } = await (await fetch(rpc)).json();
assert.equal(m.chainId, 31337);
assert.equal(m.earnUSDC.adapters.length, 5);
assert.equal((await fetch(`${base}/incorrect-token`)).status, 404);
for (const method of [
  "anvil_reset",
  "anvil_impersonateAccount",
  "anvil_setStorageAt",
  "eth_sendTransaction",
  "debug_traceCall",
])
  assert.equal(
    (await call(rpc, method, [])).status,
    403,
    `Public method leaked: ${method}`,
  );
assert.equal((await call(fundingRPC, "anvil_setBalance", [])).status, 403);
assert.equal(
  (
    await call(fundingRPC, "eth_sendTransaction", [
      {
        from: m.faucetDeployment.dispatcher,
        to: account.address,
        value: "0x1",
      },
    ])
  ).status,
  403,
);
const claim = await call(fundingRPC, "eth_sendTransaction", [
  {
    from: m.faucetDeployment.dispatcher,
    to: m.faucet,
    data: encodeFunctionData({
      abi: faucetABI,
      functionName: "claim",
      args: [account.address],
    }),
    gas: "0x7a120",
  },
]);
assert.equal(claim.status, 200);
assert.ok(claim.body.result, JSON.stringify(claim.body));
await confirmed(claim.body.result);
assert.equal(
  await client.getBalance({ address: account.address }),
  parseEther("101"),
);
const token = m.earnUSDC.asset,
  vault = m.earnUSDC.vault;
assert.equal(
  await client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  }),
  1000000000n,
);
await confirmed(
  await wallet.writeContract({
    address: token,
    abi: erc20Abi,
    functionName: "approve",
    args: [vault, 25000000n],
    chain: null,
  }),
);
const depositHash = await wallet.writeContract({
  address: vault,
  abi: vaultABI,
  functionName: "deposit",
  args: [25000000n, account.address],
  chain: null,
  gas: 1500000n,
});
const depositReceipt = await confirmed(depositHash);
const depositTimestamp = (
  await client.getBlock({ blockNumber: depositReceipt.blockNumber })
).timestamp;
const shares = await client.readContract({
  address: vault,
  abi: vaultABI,
  functionName: "balanceOf",
  args: [account.address],
});
assert.ok(shares > 0n);
const nonce = await client.getTransactionCount({ address: account.address });
const balance = await client.readContract({
  address: token,
  abi: erc20Abi,
  functionName: "balanceOf",
  args: [account.address],
});
// Kill the entire owned process group immediately after an acknowledged deposit.
const service = JSON.parse(readFileSync(`${dir}/service.json`, "utf8"));
process.kill(-service.pid, "SIGKILL");
for (let i = 0; i < 50; i++) {
  try {
    await fetch(`${base}/health`, { signal: AbortSignal.timeout(500) });
  } catch {
    break;
  }
  await delay(100);
}
const log = openSync(`${dir}/service.log`, "a", 0o600);
const child = spawn(
  service.node,
  ["scripts/start-anvil-demo.mjs", "--execute"],
  {
    cwd: service.cwd ?? process.cwd(),
    env: { ...process.env, ...config },
    stdio: ["ignore", log, log],
    detached: true,
  },
);
child.unref();
writeFileSync(
  `${dir}/service.json`,
  JSON.stringify({ ...service, pid: child.pid }),
  { mode: 0o600 },
);
await healthy();
assert.ok(
  (await client.getBlock()).timestamp >= depositTimestamp,
  "Fork clock regressed after restart",
);
const after = (await (await fetch(rpc)).json()).manifest;
assert.equal(after.vault, m.vault);
assert.equal(after.earnUSDC.vault, vault);
assert.equal(after.faucet, m.faucet);
assert.equal(
  await client.readContract({
    address: vault,
    abi: vaultABI,
    functionName: "balanceOf",
    args: [account.address],
  }),
  shares,
);
assert.equal(
  await client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  }),
  balance,
);
assert.equal(
  await client.getTransactionCount({ address: account.address }),
  nonce,
);
assert.equal(
  (await client.getTransactionReceipt({ hash: depositHash })).blockHash,
  depositReceipt.blockHash,
);
assert.ok(
  (
    await client.getLogs({
      address: vault,
      fromBlock: depositReceipt.blockNumber,
      toBlock: depositReceipt.blockNumber,
    })
  ).length > 0,
);
await confirmed(
  await wallet.writeContract({
    address: vault,
    abi: vaultABI,
    functionName: "redeem",
    args: [shares, account.address, account.address],
    chain: null,
    gas: 2000000n,
  }),
);
assert.equal(
  await client.readContract({
    address: vault,
    abi: vaultABI,
    functionName: "balanceOf",
    args: [account.address],
  }),
  0n,
);
assert.ok(
  (await client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  })) >= 999999990n,
);
assert.equal((await fetch(`${base}/tx/${depositHash}`)).status, 200);
const result = {
  author: "Codex",
  recordedAt: new Date().toISOString(),
  environment: "isolated local hosted-service proof",
  checks: [
    "private-RPC-token",
    "administrator-method-rejection",
    "bounded-faucet-only",
    "real-USDC-deposit",
    "hard-process-group-crash",
    "same-contracts-after-restart",
    "monotonic-clock-recovery",
    "shares-and-balances-preserved",
    "nonce-preserved",
    "receipt-and-events-preserved",
    "full-USDC-redemption",
    "public-receipt-page",
  ],
  transactions: txs,
  cloudDeployed: false,
};
writeFileSync(`${dir}/result.json`, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
