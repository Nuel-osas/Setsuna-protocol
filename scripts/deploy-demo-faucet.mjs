import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  http,
  parseEther,
  toHex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { keeperNetwork } from "./earn-keeper-network.mjs";

// Run after deploying the Earn/Spot/Perps contracts. Never changes a live network.
const { values } = parseArgs({
  options: {
    manifest: { type: "string" },
    output: { type: "string" },
    execute: { type: "boolean", default: false },
    "local-admin": { type: "boolean", default: false },
  },
});
async function main() {
  if (!values.manifest || !values.output)
    throw new Error("Manifest and new output paths required");
  const m = JSON.parse(await readFile(values.manifest, "utf8"));
  if (m.faucet)
    throw new Error(
      "Manifest already contains a faucet; do not redeploy silently",
    );
  const rpc = process.env.SETSUNA_DEMO_RPC_URL,
    adminRPC = process.env.SETSUNA_DEMO_ADMIN_RPC_URL;
  if (!rpc || !adminRPC)
    throw new Error("Demo and administrator RPC variables required");
  const adminURL = new URL(adminRPC);
  if (
    values["local-admin"] &&
    !["127.0.0.1", "localhost"].includes(adminURL.hostname)
  )
    throw new Error("Anvil funding is restricted to loopback");
  if (!values["local-admin"] && adminURL.protocol !== "https:")
    throw new Error("Hosted administrator RPC must use HTTPS");
  const { client, chainId } = await keeperNetwork({
    rpc,
    manifest: m,
    address: m.vault,
    assetSymbol: "MON",
  });
  if (chainId !== 31337)
    throw new Error("Faucet requires the reviewed demo chain 31337");
  const admin = createPublicClient({
    transport: http(adminRPC, { timeout: 15000, retryCount: 0 }),
  });
  const tip = await client.getBlock();
  if (
    (await admin.getChainId()) !== 31337 ||
    (await admin.getBlock({ blockNumber: tip.number })).hash !== tip.hash
  )
    throw new Error("Read/admin RPCs identify different forks");
  if (!values.execute) {
    console.log(
      JSON.stringify({
        mode: "read-only",
        chainId,
        vault: m.vault,
        next: "Pass --execute to deploy and seed a new synthetic-fund faucet.",
      }),
    );
    return;
  }
  // Reserve a NEW output file before any write so existing manifests are never overwritten.
  await writeFile(
    values.output,
    JSON.stringify({ status: "deployment-started", chainId }) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  const dispatcher = privateKeyToAccount(generatePrivateKey()).address;
  const setNative = async (address, amount) =>
    admin.request({
      method: values["local-admin"]
        ? "anvil_setBalance"
        : "tenderly_setBalance",
      params: [address, toHex(amount)],
    });
  await setNative(dispatcher, parseEther("20"));
  const artifact = JSON.parse(
    await readFile(
      new URL(
        "../contracts/out/SetsunaDemoFaucet.sol/SetsunaDemoFaucet.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const wallet = createWalletClient({
    account: dispatcher,
    transport: http(adminRPC, { timeout: 15000, retryCount: 0 }),
  });
  if (values["local-admin"])
    await admin.request({
      method: "anvil_impersonateAccount",
      params: [dispatcher],
    });
  // Persist the nonce-derived address before broadcasting so uncertain outcomes can be inspected.
  const { getContractAddress } = await import("viem");
  const nonce = await client.getTransactionCount({
    address: dispatcher,
    blockTag: "pending",
  });
  const faucet = getContractAddress({ from: dispatcher, nonce: BigInt(nonce) });
  await writeFile(
    values.output,
    JSON.stringify(
      { status: "deployment-pending", dispatcher, faucet, nonce, chainId },
      null,
      2,
    ) + "\n",
  );
  const hash = await wallet.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode.object,
    args: [dispatcher],
    chain: null,
    nonce,
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (
    receipt.status !== "success" ||
    receipt.contractAddress?.toLowerCase() !== faucet.toLowerCase()
  )
    throw new Error("Faucet deployment failed");
  await writeFile(
    values.output,
    JSON.stringify(
      { status: "funding-incomplete", dispatcher, faucet, hash, chainId },
      null,
      2,
    ) + "\n",
  );
  await setNative(faucet, parseEther("10100"));
  for (const token of [
    "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
    "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a",
  ]) {
    if (values["local-admin"]) {
      // The local proof uses only the two reviewed token layouts on the owned fork.
      const { encodeFunctionData } = await import("viem");
      const trace = await admin.request({
        method: "debug_traceCall",
        params: [
          {
            to: token,
            data: encodeFunctionData({
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [faucet],
            }),
          },
          "latest",
          { disableMemory: true, disableStorage: true },
        ],
      });
      const reads = trace.structLogs.filter((x) => x.op === "SLOAD");
      if (!reads.length) throw new Error("Token layout unavailable");
      const slot = toHex(
        BigInt(`0x${reads.at(-1).stack.at(-1).replace(/^0x/, "")}`),
        { size: 32 },
      );
      const previous = await client.getStorageAt({ address: token, slot });
      const isAUSD =
        token.toLowerCase() === "0x00000000efe302beaa2b3e6e1b18d08d69a9012a";
      const amount = isAUSD
        ? (100_000_000_000n << 8n) | (BigInt(previous) & 255n)
        : 100_000_000_000n;
      await admin.request({
        method: "anvil_setStorageAt",
        params: [token, slot, toHex(amount, { size: 32 })],
      });
      if (
        (await client.readContract({
          address: token,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [faucet],
        })) !== 100_000_000_000n
      ) {
        await admin.request({
          method: "anvil_setStorageAt",
          params: [token, slot, previous],
        });
        throw new Error("Token layout mismatch; local storage restored");
      }
    } else {
      await admin.request({
        method: "tenderly_setErc20Balance",
        params: [token, faucet, toHex(100_000_000_000n)],
      });
    }
    if (
      (await client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [faucet],
      })) !== 100_000_000_000n
    )
      throw new Error("Synthetic token funding was not confirmed");
  }
  await writeFile(
    values.output,
    JSON.stringify(
      {
        ...m,
        faucet,
        faucetDeployment: {
          hash,
          block: receipt.blockNumber.toString(),
          dispatcher,
          syntheticFunding: true,
        },
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      chainId,
      faucet,
      hash,
      manifest: values.output,
      syntheticFunding: true,
    }),
  );
}
main().catch(() => {
  console.error(
    "Demo faucet setup stopped. Inspect the output journal and explorer before retrying. No RPC credentials are logged.",
  );
  process.exitCode = 1;
});
