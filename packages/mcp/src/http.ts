// Remote MCP over Streamable HTTP, stateless: every request gets a fresh server, so any instance
// can answer any request. Built on web-standard Request and Response, so it runs on Vercel, Workers or Bun.
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createSetsunaServer, SERVER_VERSION } from "./server.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
};

const ABOUT = `Setsuna MCP server ${SERVER_VERSION}

Lets an AI read Setsuna's vaults on Monad and prepare deposits and withdrawals for you to sign.
It holds no keys and never sends a transaction.

Connect:
  Claude Code:   claude mcp add --transport http setsuna https://mcp.setsuna.finance/mcp
  Other apps:    add an MCP server with the URL https://mcp.setsuna.finance/mcp

Tools: list_vaults, get_vault, get_markets, get_position, explain_rules,
       quote_deposit, quote_withdraw, prepare_deposit, prepare_withdraw

Docs: https://setsuna.finance/docs · Source: https://github.com/Nuel-osas/Setsuna-protocol/tree/main/packages/mcp
`;

export async function handleMcpRequest(request: Request, options: { rpcUrl?: string } = {}): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  // A browser visiting the URL gets a short explanation instead of a protocol error.
  if (request.method === "GET" && !(request.headers.get("accept") ?? "").includes("text/event-stream")) {
    return new Response(ABOUT, { headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8" } });
  }
  const server = createSetsunaServer({ rpcUrl: options.rpcUrl });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    const response = await transport.handleRequest(request);
    const headers = new Headers(response.headers);
    for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
    return new Response(response.body, { status: response.status, headers });
  } finally {
    // Stateless: nothing outlives the request.
    void server.close();
  }
}
