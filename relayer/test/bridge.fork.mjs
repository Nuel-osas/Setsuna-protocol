// Sponsored bridging through the real relayer, on a local fork of Monad mainnet.
// Starts anvil and the relayer with throwaway keys, funds a test wallet, then checks what the
// relayer sends and what it refuses. Nothing touches mainnet. Run: npm run test:fork
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import assert from "node:assert/strict";
import { createPublicClient, defineChain, http, keccak256, pad, parseAbi, parseEther, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const FORK = 8546;
const RELAY = 8790;
const SPONSOR = "0xeabF1Aa629a686C9E5862b316F954bF2C0b68DBe";
const USDC = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
const AUSD = "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a";
const POOL = "0x942644106B073E30D72c2C5D7529D5C296ea91ab"; // holds USDC on the fork
const AUSD_HOLDER = "0xf33286E3222D1c829dACeac48c0Ec651F6452470";
const SAVER = "0x4cbf5688cc98BCb76CcAB602AFc7b6fD57863cC3";
const BASE = 6;
const SUI = 8;
const DOMAINS = { USDC: { name: "USDC", version: "2" }, AUSD: { name: "Agora Dollar", version: "1" } };

const T =
  "(address owner,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 salt,uint32 destinationDomain,bytes32 mintRecipient,uint256 maxFee,uint32 minFinalityThreshold,bool forward,uint256 minUsdcOut)";
const sponsorAbi = parseAbi([`function authorizationNonce(address token, ${T} t) view returns (bytes32)`]);
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function totalSupply() view returns (uint256)"]);

const monad = defineChain({ id: 143, name: "Monad fork", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [`http://127.0.0.1:${FORK}`] } } });
const pub = createPublicClient({ chain: monad, transport: http() });
const rpc = (method, params) => pub.request({ method, params });

const children = [];
const stop = () => children.forEach((c) => c.kill("SIGTERM"));
process.on("exit", stop);

async function waitFor(check, what) {
  for (let i = 0; i < 60; i++) {
    if (await check().catch(() => false)) return;
    await sleep(500);
  }
  throw new Error(`${what} did not start`);
}

async function fund(token, from, to, value) {
  await rpc("anvil_impersonateAccount", [from]);
  await rpc("anvil_setBalance", [from, toHex(parseEther("1"))]);
  const data = `0xa9059cbb${pad(to).slice(2)}${pad(toHex(value)).slice(2)}`;
  const hash = await rpc("eth_sendTransaction", [{ from, to: token, data }]);
  await pub.waitForTransactionReceipt({ hash });
}

let forwardQuote;
async function quote(domain) {
  const res = await fetch(`https://iris-api.circle.com/v2/burn/USDC/fees/15/${domain}?forward=true`);
  const j = await res.json();
  // As the SDK quotes it: Circle's fee plus 5%.
  return (BigInt(Math.ceil(j.find((x) => x.finalityThreshold === 2000).forwardFee.med)) * 105n + 99n) / 100n;
}

const user = privateKeyToAccount(generatePrivateKey());
let saltN = 0;
async function signed(token, overrides = {}, tamper = {}) {
  const block = await pub.getBlock();
  const t = {
    owner: user.address,
    value: 5_000_000n,
    validAfter: 0n,
    validBefore: block.timestamp + 600n,
    salt: keccak256(toHex(`fork-${saltN++}`)),
    destinationDomain: BASE,
    mintRecipient: pad(user.address),
    maxFee: forwardQuote,
    minFinalityThreshold: 2000,
    forward: true,
    minUsdcOut: token === "AUSD" ? 4_980_000n : 0n,
    ...overrides,
  };
  const tokenAddress = token === "AUSD" ? AUSD : USDC;
  const nonce = await pub.readContract({ address: SPONSOR, abi: sponsorAbi, functionName: "authorizationNonce", args: [tokenAddress, t] });
  const signature = await user.signTypedData({
    domain: { ...DOMAINS[token], chainId: 143, verifyingContract: tokenAddress },
    types: { ReceiveWithAuthorization: ["from:address", "to:address", "value:uint256", "validAfter:uint256", "validBefore:uint256", "nonce:bytes32"].map((x) => ({ name: x.split(":")[0], type: x.split(":")[1] })) },
    primaryType: "ReceiveWithAuthorization",
    message: { from: t.owner, to: SPONSOR, value: t.value, validAfter: t.validAfter, validBefore: t.validBefore, nonce },
  });
  return { token, transfer: { ...t, ...tamper }, signature, app: "fork-test" };
}

async function post(body) {
  const res = await fetch(`http://127.0.0.1:${RELAY}/v1/bridge`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
  });
  return { status: res.status, body: await res.json() };
}

async function main() {
  const anvil = spawn("anvil", ["--fork-url", process.env.MONAD_RPC_URL ?? "https://rpc2.monad.xyz", "--port", String(FORK), "--silent"], { stdio: "inherit" });
  children.push(anvil);
  await waitFor(() => pub.getChainId().then((id) => id === 143), "anvil");

  const relayerKey = generatePrivateKey();
  await rpc("anvil_setBalance", [privateKeyToAccount(relayerKey).address, toHex(parseEther("10"))]);
  await fund(USDC, POOL, user.address, 50_000_000n);
  await fund(AUSD, AUSD_HOLDER, user.address, 50_000_000n);
  forwardQuote = await quote(BASE);

  const relayer = spawn(process.execPath, ["server.mjs"], {
    env: { ...process.env, RPC_URL: `http://127.0.0.1:${FORK}`, SETSUNA_RELAYER_PRIVATE_KEY: relayerKey, PORT: String(RELAY), STATS_REPORT_URL: "http://127.0.0.1:9/disabled" },
    stdio: ["ignore", "ignore", "inherit"],
  });
  children.push(relayer);
  await waitFor(() => fetch(`http://127.0.0.1:${RELAY}/health`).then((r) => r.ok), "relayer");

  const results = [];
  const check = async (name, fn) => {
    try {
      await fn();
      results.push(`ok   ${name}`);
    } catch (e) {
      results.push(`FAIL ${name}: ${e.message}`);
    }
  };

  const health = await (await fetch(`http://127.0.0.1:${RELAY}/health`)).json();
  await check("health lists the bridge", () => {
    assert.equal(health.bridgeSponsor, SPONSOR);
    assert.ok(health.endpoints.includes("POST /v1/bridge"));
  });

  let usdcBody;
  await check("USDC to Base is burned, the user pays no MON", async () => {
    const supply = await pub.readContract({ address: USDC, abi: erc20, functionName: "totalSupply" });
    usdcBody = await signed("USDC");
    const r = await post(usdcBody);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.burned, "5000000");
    assert.equal(r.body.sourceDomain, 15);
    assert.equal(await pub.readContract({ address: USDC, abi: erc20, functionName: "totalSupply" }), supply - 5_000_000n);
    assert.equal(await pub.getBalance({ address: user.address }), 0n);
  });

  await check("AUSD is swapped and burned", async () => {
    const r = await post(await signed("AUSD"));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(BigInt(r.body.burned) >= 4_990_000n, r.body.burned);
  });

  await check("a replayed signature is refused", async () => {
    const r = await post(usdcBody);
    assert.equal(r.status, 400);
    assert.match(r.body.error, /already been used|doesn't match/);
  });

  await check("a changed recipient is refused before anything is sent", async () => {
    const r = await post(await signed("USDC", {}, { mintRecipient: pad("0x000000000000000000000000000000000000bAd1") }));
    assert.equal(r.status, 400);
    assert.match(r.body.error, /signature doesn't match/);
  });

  await check("a fee ceiling below Circle's delivery fee is refused", async () => {
    const r = await post(await signed("USDC", { maxFee: (forwardQuote * 80n) / 100n }));
    assert.equal(r.status, 400);
    assert.match(r.body.error, /below Circle's delivery fee/);
  });

  await check("a fee ceiling far above Circle's delivery fee is refused", async () => {
    const r = await post(await signed("USDC", { maxFee: forwardQuote * 3n + 100_000n }));
    assert.equal(r.status, 400);
    assert.match(r.body.error, /far above/);
  });

  await check("forwarding to a chain Circle doesn't deliver to is refused", async () => {
    const r = await post(await signed("USDC", { destinationDomain: SUI }));
    assert.equal(r.status, 400);
    assert.match(r.body.error, /doesn't deliver/);
  });

  await check("forwarding to a chain Circle quotes but doesn't list (Cronos) is refused", async () => {
    const r = await post(await signed("USDC", { destinationDomain: 32 }));
    assert.equal(r.status, 400);
    assert.match(r.body.error, /doesn't deliver/);
  });

  await check("without forwarding, Sui is accepted (the recipient claims there)", async () => {
    const r = await post(await signed("USDC", { destinationDomain: SUI, forward: false, maxFee: 0n }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
  });

  await check("less than 1 USDC is refused", async () => {
    const r = await post(await signed("USDC", { value: 999_999n }));
    assert.equal(r.status, 400);
    assert.match(r.body.error, /start at 1/);
  });

  await check("more than the wallet holds is refused with a plain reason", async () => {
    const r = await post(await signed("USDC", { value: 1_000_000_000n }));
    assert.equal(r.status, 400);
    assert.match(r.body.error, /less than the/);
  });

  await check("sponsored AUSD saves still work alongside bridging", async () => {
    const block = await pub.getBlock();
    const nonce = keccak256(toHex("fork-save"));
    const message = { from: user.address, to: SAVER, value: 2_000_000n, validAfter: 0n, validBefore: block.timestamp + 600n, nonce };
    const signature = await user.signTypedData({
      domain: { ...DOMAINS.AUSD, chainId: 143, verifyingContract: AUSD },
      types: { ReceiveWithAuthorization: ["from:address", "to:address", "value:uint256", "validAfter:uint256", "validBefore:uint256", "nonce:bytes32"].map((x) => ({ name: x.split(":")[0], type: x.split(":")[1] })) },
      primaryType: "ReceiveWithAuthorization",
      message,
    });
    const res = await fetch(`http://127.0.0.1:${RELAY}/v1/ausd/save`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ owner: user.address, value: "2000000", validAfter: "0", validBefore: String(message.validBefore), nonce, signature }),
    });
    const out = await res.json();
    assert.equal(res.status, 200, JSON.stringify(out));
    assert.ok(out.txHash && !("logs" in out));
  });

  await check("Monad as the destination is refused", async () => {
    const r = await post(await signed("USDC", { destinationDomain: 15 }));
    assert.equal(r.status, 400);
  });

  console.log(results.join("\n"));
  stop();
  process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  stop();
  process.exit(1);
});
