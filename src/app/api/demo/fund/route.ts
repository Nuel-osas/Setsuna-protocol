import {
  createWalletClient,
  http,
  isAddress,
  zeroAddress,
  type Address,
} from "viem";
import { confirmsDemoFunding, demoFaucetAbi } from "@/lib/setsuna/demo-faucet";
import { faucetContext } from "@/lib/setsuna/faucet-server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
const headers = { "Cache-Control": "no-store" };
function address(value: unknown): value is Address {
  return typeof value === "string" && isAddress(value) && value !== zeroAddress;
}
export async function GET(request: Request) {
  const url = new URL(request.url),
    recipient = url.searchParams.get("address");
  if (!address(recipient))
    return Response.json(
      { error: "Invalid wallet address" },
      { status: 400, headers },
    );
  try {
    return Response.json((await faucetContext(url.origin, recipient)).status, {
      headers,
    });
  } catch {
    return Response.json(
      { error: "Demo funding is not connected or is temporarily unavailable." },
      { status: 503, headers },
    );
  }
}
export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  const requestOrigin = request.headers.get("origin");
  // Next's development server can normalize 127.0.0.1 to localhost in request.url.
  // Compare the browser Origin with the actual Host as well; neither header is
  // writable by cross-origin browser JavaScript.
  const hostOrigin = `${new URL(request.url).protocol}//${request.headers.get("host")}`;
  if (requestOrigin !== origin && requestOrigin !== hostOrigin)
    return Response.json(
      { error: "Use the funding button on this site." },
      { status: 403, headers },
    );
  if (Number(request.headers.get("content-length")) > 512)
    return Response.json(
      { error: "Request too large" },
      { status: 413, headers },
    );
  let recipient: Address;
  try {
    const text = await request.text();
    if (text.length > 512) throw new Error();
    const body = JSON.parse(text);
    if (!body || Object.keys(body).length !== 1 || !address(body.address))
      throw new Error();
    recipient = body.address;
  } catch {
    return Response.json(
      { error: "Provide only a valid wallet address." },
      { status: 400, headers },
    );
  }
  let hash: `0x${string}` | undefined;
  try {
    const context = await faucetContext(origin, recipient);
    if (!context.status.eligible)
      return Response.json(context.status, {
        status: context.status.available ? 409 : 503,
        headers,
      });
    const { d, client, dispatcher, adminRPC } = context;
    // Only this fixed, bounded faucet call can use the private administrator RPC.
    // The contract atomically enforces recipient cooldown and a total claim budget.
    const { request: claim } = await client.simulateContract({
      address: d.faucet!,
      abi: demoFaucetAbi,
      functionName: "claim",
      args: [recipient],
      account: dispatcher,
      gas: BigInt(500000),
    });
    const wallet = createWalletClient({
      account: dispatcher,
      transport: http(adminRPC, { timeout: 8000, retryCount: 0 }),
    });
    hash = await wallet.writeContract({ ...claim, chain: null });
    const receipt = await client.waitForTransactionReceipt({
      hash,
      timeout: 8000,
      retryCount: 0,
    });
    const funded = confirmsDemoFunding(receipt, d.faucet!, recipient);
    if (!funded)
      return Response.json(
        {
          error:
            "Funding was not confirmed. Check the wallet balance before retrying.",
          hash,
        },
        { status: 409, headers },
      );
    return Response.json(
      {
        funded: true,
        hash,
        message:
          "Test funds received: 101 MON, 1,000 USDC and 1,000 AUSD. These assets have no monetary value.",
      },
      { headers },
    );
  } catch {
    // Never forward upstream errors: they may contain the private administrator RPC URL.
    return Response.json(
      {
        error:
          "Funding confirmation is unavailable. Check your balance and claim status before trying again.",
        ...(hash ? { hash } : {}),
      },
      { status: hash ? 202 : 503, headers },
    );
  }
}
