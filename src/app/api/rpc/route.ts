import { createPublicClient, http } from "viem";
import { demoConfig, validRPCPayload } from "@/lib/setsuna/demo-config";
import { demoRPC } from "@/lib/setsuna/demo-server";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
const headers = {
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
export function OPTIONS() {
  return new Response(null, { status: 204, headers });
}
export async function POST(request: Request) {
  try {
    if (!process.env.SETSUNA_DEMO_MANIFEST)
      return Response.json(
        { error: "Demo network not connected" },
        { status: 503, headers },
      );
    if (Number(request.headers.get("content-length")) > 131072)
      return Response.json(
        { error: "Request too large" },
        { status: 413, headers },
      );
    const body = await request.text();
    if (body.length > 131072)
      return Response.json(
        { error: "Request too large" },
        { status: 413, headers },
      );
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400, headers });
    }
    // No impersonation, unsigned transactions, storage edits, or administrator methods.
    if (!validRPCPayload(payload))
      return Response.json(
        { error: "RPC method not available" },
        { status: 403, headers },
      );
    const d = demoConfig(
        process.env.SETSUNA_DEMO_MANIFEST,
        new URL("/api/rpc/", request.url).href,
      ),
      rpc = demoRPC();
    const c = createPublicClient({
      transport: http(rpc, { timeout: 6000, retryCount: 0 }),
    });
    if ((await c.getChainId()) !== d.chainId)
      throw new Error("Wrong demo chain");
    const response = await fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error("RPC unavailable");
    return Response.json(await response.json(), { headers });
  } catch {
    return Response.json(
      { error: "Demo network unavailable" },
      { status: 503, headers },
    );
  }
}
