// Sponsored bridging: encodings checked offline, then against the deployed SetsunaBridgeSponsor,
// the tokens' EIP-712 domains and Circle's live fees on Monad mainnet. Sends nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicClient, hashDomain, http, parseAbi, recoverTypedDataAddress, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { BRIDGE, BRIDGE_CHAINS, bridgeAuthorizationNonce, bridgeChain, createSetsuna, mintRecipient, monad, solanaUsdcAccount } from "../src/index.js";

const setsuna = createSetsuna();
const chain = createPublicClient({ chain: monad, transport: http("https://rpc2.monad.xyz") });
const T =
  "(address owner,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 salt,uint32 destinationDomain,bytes32 mintRecipient,uint256 maxFee,uint32 minFinalityThreshold,bool forward,uint256 minUsdcOut)";
const sponsorAbi = parseAbi([`function authorizationNonce(address token, ${T} t) view returns (bytes32)`]);

test("the chain list is a usable picker: unique domains, no Monad, logos where published", () => {
  const domains = BRIDGE_CHAINS.map((c) => c.domain);
  assert.equal(new Set(domains).size, domains.length);
  assert.ok(!domains.includes(BRIDGE.domain));
  assert.ok(setsuna.bridge.chains().length >= 25);
  for (const c of BRIDGE_CHAINS) {
    if (c.icon) assert.match(c.icon, /^https:\/\/bridge\.setsuna\.finance\/icons\/[a-z_]+\.svg$/);
    if (c.gasInUSDC) assert.ok(c.ecosystem === "evm" || c.ecosystem === "solana", c.name);
  }
  assert.equal(bridgeChain(6).name, "Base");
  assert.throws(() => bridgeChain(15), /isn't a destination/);
});

test("recipients are encoded the way CCTP expects on each chain", () => {
  const evm = "0x9C05a6434a62Cc1390bdB090bb1e0Fd31a3AD262";
  assert.equal(mintRecipient(bridgeChain(6), evm), "0x0000000000000000000000009c05a6434a62cc1390bdb090bb1e0fd31a3ad262");
  assert.throws(() => mintRecipient(bridgeChain(6), "0x1234"), /not an address/);
  // Solana: the wallet's USDC token account, matching @solana/spl-token's getAssociatedTokenAddressSync.
  assert.equal(solanaUsdcAccount("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"), "0xd3ea8cf5acaca8cd05207512175c43cef54a5dd99ede20a16b55253738f397dc");
  assert.equal(mintRecipient(bridgeChain(5), "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1"), "0xa004cf15fc3435b672f58d5b719b2295c6c66025810a498a822e0993ef0ee5f4");
  assert.throws(() => solanaUsdcAccount("not-base58!"));
  // Sui: a 32-byte address, padded if written short.
  assert.equal(mintRecipient(bridgeChain(8), "0x2"), `0x${"0".repeat(63)}2`);
});

test("the nonce the SDK signs is the one the deployed sponsor recomputes", async () => {
  for (const token of ["USDC", "AUSD"] as const) {
    const t = {
      owner: "0x9C05a6434a62Cc1390bdB090bb1e0Fd31a3AD262" as const,
      value: 5_000_000n,
      validAfter: 0n,
      validBefore: 1_900_000_000n,
      salt: `0x${"ab".repeat(32)}` as Hex,
      destinationDomain: 6,
      mintRecipient: mintRecipient(bridgeChain(6), "0x9C05a6434a62Cc1390bdB090bb1e0Fd31a3AD262"),
      maxFee: 58_000n,
      minFinalityThreshold: 2000,
      forward: true,
      minUsdcOut: token === "AUSD" ? 4_990_000n : 0n,
    };
    const onchain = await chain.readContract({ address: BRIDGE.sponsor, abi: sponsorAbi, functionName: "authorizationNonce", args: [token === "USDC" ? BRIDGE.usdc : BRIDGE.ausd, t] });
    const sdk = bridgeAuthorizationNonce(token, { ...t, maxFee: t.maxFee.toString(), minUsdcOut: t.minUsdcOut.toString() });
    assert.equal(sdk, onchain, token);
  }
});

test("quotes: USDC to Base pays Circle in USDC; AUSD clears the peg floor; Sui means claiming yourself", async () => {
  const usdc = await setsuna.bridge.quote({ token: "USDC", amount: "25", destinationDomain: 6 });
  assert.equal(usdc.ok, true, usdc.problems.join(" "));
  assert.equal(usdc.forward, true);
  assert.equal(usdc.burned.raw, "25000000");
  assert.ok(BigInt(usdc.maxFee.raw) > 0n && BigInt(usdc.maxFee.raw) < 1_000_000n, usdc.maxFee.formatted);
  assert.equal(BigInt(usdc.receive.raw), 25_000_000n - BigInt(usdc.maxFee.raw));

  const ausd = await setsuna.bridge.quote({ token: "AUSD", amount: "25", destinationDomain: 5 });
  assert.equal(ausd.ok, true, ausd.problems.join(" "));
  assert.ok(BigInt(ausd.burned.raw) >= 24_950_000n, ausd.burned.formatted);
  assert.ok(BigInt(ausd.minUsdcOut.raw) >= 24_950_000n && BigInt(ausd.minUsdcOut.raw) <= BigInt(ausd.burned.raw));

  const sui = await setsuna.bridge.quote({ token: "USDC", amount: "25", destinationDomain: 8 });
  assert.equal(sui.forward, false);
  assert.equal(sui.ok, true);
  assert.equal(sui.maxFee.raw, "0");
  const forced = await setsuna.bridge.quote({ token: "USDC", amount: "25", destinationDomain: 8, forward: true });
  assert.equal(forced.ok, false);

  const tiny = await setsuna.bridge.quote({ token: "USDC", amount: "0.5", destinationDomain: 6 });
  assert.equal(tiny.ok, false);
  assert.match(tiny.problems.join(" "), /start at 1/);
});

test("the typed data matches each token's EIP-712 domain on Monad and recovers to the owner", async () => {
  const signer = privateKeyToAccount(generatePrivateKey());
  for (const token of ["USDC", "AUSD"] as const) {
    const quote = await setsuna.bridge.quote({ token, amount: "10", destinationDomain: 3 });
    const req = setsuna.bridge.buildSponsored({ owner: signer.address, recipient: signer.address, quote });
    const separator = await chain.readContract({ address: req.typedData.domain.verifyingContract, abi: parseAbi(["function DOMAIN_SEPARATOR() view returns (bytes32)"]), functionName: "DOMAIN_SEPARATOR" });
    assert.equal(hashDomain({ domain: req.typedData.domain, types: { EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }] } }), separator, token);
    assert.equal(req.typedData.message.to, BRIDGE.sponsor);
    assert.equal(req.typedData.message.nonce, bridgeAuthorizationNonce(token, req.transfer));
    const signature = await signer.signTypedData(req.typedData as never);
    assert.equal(await recoverTypedDataAddress({ ...(req.typedData as never), signature }), signer.address);
  }
});

test("building refuses a quote that isn't ok", async () => {
  const bad = await setsuna.bridge.quote({ token: "USDC", amount: "0.1", destinationDomain: 6 });
  assert.throws(() => setsuna.bridge.buildSponsored({ owner: "0x9C05a6434a62Cc1390bdB090bb1e0Fd31a3AD262", recipient: "0x9C05a6434a62Cc1390bdB090bb1e0Fd31a3AD262", quote: bad }), /start at 1/);
});
