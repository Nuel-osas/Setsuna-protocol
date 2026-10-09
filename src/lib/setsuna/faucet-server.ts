import {
  createPublicClient,
  erc20Abi,
  http,
  parseEther,
  type Address,
} from "viem";
import { demoFaucetAbi } from "./demo-faucet";
import { demoRPC, validatedDemo } from "./demo-server";
import { venues } from "./demo-config";

export async function faucetContext(origin: string, recipient: Address) {
  const d = await validatedDemo(origin);
  if (
    d.chainId !== 31337 ||
    !d.faucet ||
    !process.env.SETSUNA_DEMO_ADMIN_RPC_URL
  )
    throw new Error("Demo funding unavailable");
  const url = new URL(process.env.SETSUNA_DEMO_ADMIN_RPC_URL);
  if (
    url.protocol !== "https:" &&
    !(
      process.env.NODE_ENV !== "production" &&
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(url.hostname)
    )
  )
    throw new Error("Private demo RPC must use HTTPS");
  const client = createPublicClient({
    transport: http(demoRPC(), { timeout: 8000, retryCount: 0 }),
  });
  const admin = createPublicClient({
    transport: http(url.href, { timeout: 8000, retryCount: 0 }),
  });
  const block = await client.getBlock();
  // Matching a post-deployment block also prevents funding a different fork with the same chain ID.
  const [adminChain, adminBlock] = await Promise.all([
    admin.getChainId(),
    admin.getBlock({ blockNumber: block.number }),
  ]);
  if (adminChain !== d.chainId || adminBlock.hash !== block.hash)
    throw new Error("Demo funding RPC mismatch");
  const read = <
    N extends
      | "DEMO_CHAIN_ID"
      | "MON_AMOUNT"
      | "TOKEN_AMOUNT"
      | "MAX_CLAIMS"
      | "COOLDOWN"
      | "USDC"
      | "AUSD"
      | "dispatcher"
      | "claims",
  >(
    functionName: N,
  ) =>
    client.readContract({
      address: d.faucet!,
      abi: demoFaucetAbi,
      functionName,
      blockNumber: block.number,
    });
  const [
    chain,
    mon,
    token,
    max,
    cooldown,
    usdc,
    ausd,
    dispatcher,
    claims,
    next,
    native,
    usdcBalance,
    ausdBalance,
  ] = await Promise.all([
    read("DEMO_CHAIN_ID"),
    read("MON_AMOUNT"),
    read("TOKEN_AMOUNT"),
    read("MAX_CLAIMS"),
    read("COOLDOWN"),
    read("USDC"),
    read("AUSD"),
    read("dispatcher"),
    read("claims"),
    client.readContract({
      address: d.faucet,
      abi: demoFaucetAbi,
      functionName: "nextClaimAt",
      args: [recipient],
      blockNumber: block.number,
    }),
    client.getBalance({ address: d.faucet, blockNumber: block.number }),
    client.readContract({
      address: venues.usdc,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [d.faucet],
      blockNumber: block.number,
    }),
    client.readContract({
      address: venues.collateral,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [d.faucet],
      blockNumber: block.number,
    }),
  ]);
  if (
    chain !== BigInt(31337) ||
    mon !== parseEther("101") ||
    token !== BigInt(1000000000) ||
    max !== BigInt(100) ||
    cooldown !== BigInt(86400) ||
    usdc.toLowerCase() !== venues.usdc.toLowerCase() ||
    ausd.toLowerCase() !== venues.collateral.toLowerCase()
  )
    throw new Error("Unreviewed demo faucet");
  const available =
    claims < max &&
    native >= mon &&
    usdcBalance >= token &&
    ausdBalance >= token;
  const eligible =
    available &&
    next <= block.timestamp &&
    recipient.toLowerCase() !== dispatcher.toLowerCase() &&
    recipient.toLowerCase() !== d.faucet.toLowerCase();
  return {
    d,
    client,
    admin,
    dispatcher,
    adminRPC: url.href,
    status: {
      available,
      eligible,
      nextClaimAt: next.toString(),
      timestamp: block.timestamp.toString(),
      remainingClaims: (max - claims).toString(),
      message: !available
        ? "The demo funding pool needs maintenance."
        : !eligible
          ? "This wallet cannot claim again yet. Your existing test funds remain available."
          : undefined,
    },
  };
}
