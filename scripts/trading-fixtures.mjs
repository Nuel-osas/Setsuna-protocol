// Local simulation only. None of these helpers can use a public RPC.
import { readFile } from "node:fs/promises";
import {
  createWalletClient,
  http,
  encodeFunctionData,
  erc20Abi,
  parseAbi,
  toHex,
} from "viem";
import { checkAccount } from "./keeper-core.mjs";

export const exchange = "0x34B6552d57a35a1D042CcAe1951BD1C370112a6F";
export const collateral = "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a";
const localABI = parseAbi([
  "function setIgnOracle(uint256 perpId, bool ignore)",
  "function updateMarkPricePNSByOwner(uint256 perpId, uint32 price)",
  "function owner() view returns(address)",
]);

async function localOnly(client) {
  if (
    client.transport.url !== "http://127.0.0.1:18608" ||
    (await client.getChainId()) !== 31337
  ) {
    throw new Error(
      "Trading fixtures require the owned localhost:18608 fork, chain 31337",
    );
  }
}

export async function prepareTradingFixtures(client, owner) {
  await localOnly(client);
  const trace = await client.request({
    method: "debug_traceCall",
    params: [
      {
        to: collateral,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [owner],
        }),
      },
      "latest",
      { disableMemory: true, disableStorage: true },
    ],
  });
  const reads = trace.structLogs.filter((x) => x.op === "SLOAD");
  if (reads.length !== 2)
    throw new Error(
      "AUSD storage layout changed; no synthetic funding applied",
    );
  const slot = toHex(
    BigInt(`0x${reads.at(-1).stack.at(-1).replace(/^0x/, "")}`),
    { size: 32 },
  );
  const previous = BigInt(
    await client.getStorageAt({ address: collateral, slot }),
  );
  await client.request({
    method: "anvil_setStorageAt",
    params: [
      collateral,
      slot,
      toHex((10_000_000_000n << 8n) | (previous & 255n), { size: 32 }),
    ],
  });
  if (
    (await client.readContract({
      address: collateral,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [owner],
    })) !== 10_000_000_000n
  ) {
    throw new Error("Synthetic AUSD balance mismatch");
  }
  const abi = JSON.parse(
    await readFile(
      new URL("../contracts/abi/IPerplExchange.json", import.meta.url),
    ),
  );
  const market = await client.readContract({
    address: exchange,
    abi,
    functionName: "getPerpetualInfo",
    args: [1n],
  });
  const venueOwner = await client.readContract({
    address: exchange,
    abi: localABI,
    functionName: "owner",
  });
  const fixture = {
    mode: "FIXED_HISTORICAL_MARK",
    markPNS: String(market.markPNS),
    originalMarkTimestamp: String(market.markTimestamp),
    venueOwner,
    oracleGuardDisabledOnFork: true,
  };
  await ownerCall(client, venueOwner, "setIgnOracle", [1n, true]);
  await refreshTradingMark(client, fixture);
  return fixture;
}

async function ownerCall(client, owner, functionName, args) {
  await localOnly(client);
  await client.request({
    method: "anvil_setBalance",
    params: [owner, toHex(10n ** 19n)],
  });
  await client.request({ method: "anvil_impersonateAccount", params: [owner] });
  try {
    const wallet = createWalletClient({
      account: owner,
      chain: client.chain,
      transport: http(client.transport.url),
    });
    const hash = await wallet.writeContract({
      address: exchange,
      abi: localABI,
      functionName,
      args,
    });
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success")
      throw new Error(`Local fixture ${functionName} reverted`);
  } finally {
    await client.request({
      method: "anvil_stopImpersonatingAccount",
      params: [owner],
    });
  }
}

export async function refreshTradingMark(client, fixture) {
  await ownerCall(client, fixture.venueOwner, "updateMarkPricePNSByOwner", [
    1n,
    Number(fixture.markPNS),
  ]);
}

export async function runLocalProtection(client, keeper, factory, owner) {
  await localOnly(client);
  const abi = parseAbi(["function accountOf(address) view returns(address)"]);
  const account = await client.readContract({
    address: factory,
    abi,
    functionName: "accountOf",
    args: [owner],
  });
  if (/^0x0{40}$/.test(account)) return;
  const accountAbi = JSON.parse(
    await readFile(
      new URL("../contracts/abi/SetsunaAccount.json", import.meta.url),
    ),
  );
  const report = await checkAccount({
    publicClient: client,
    walletClient: keeper,
    address: account,
    abi: accountAbi,
    execute: true,
    maxGasPrice: 200_000_000_000n,
  });
  if (report.action === "rescued")
    console.log(`Local protection top-up: ${account}`);
}
