// Drives the server through real MCP clients against Monad mainnet. Reads only; sends nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createSetsunaServer, signUrl } from "../src/server.js";
import { handleMcpRequest } from "../src/http.js";

const HOLDER = "0x6915aEf0947F4daD61aeF39Fe0f546A03190c92C";
const TOOLS = ["list_vaults", "get_vault", "get_markets", "get_position", "explain_rules", "quote_deposit", "quote_withdraw", "prepare_deposit", "prepare_withdraw"];

async function connect() {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createSetsunaServer().connect(a);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(b);
  return client;
}
const text = (r: any) => r.content[0].text as string;
const data = (r: any) => JSON.parse(text(r).slice(text(r).indexOf("\n\n") + 2));

test("the server lists its nine tools, all marked read-only, with safety instructions", async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name), TOOLS);
  assert.ok(tools.every((t) => t.annotations?.readOnlyHint === true));
  assert.match(client.getInstructions() ?? "", /holds no keys, never signs and never sends/);
  await client.close();
});

test("list_vaults summarises both vaults from mainnet", async () => {
  const client = await connect();
  const r = await client.callTool({ name: "list_vaults", arguments: {} });
  assert.match(text(r), /^setsUSDC: .* net APR/m);
  assert.match(text(r), /^setsMON: .* net APR/m);
  assert.equal(data(r).length, 2);
  await client.close();
});

test("explain_rules states what the guardian cannot do", async () => {
  const client = await connect();
  const r = await client.callTool({ name: "explain_rules", arguments: { vault: "setsUSDC" } });
  assert.match(text(r), /cannot move funds, change fees or upgrade/);
  await client.close();
});

test("a deposit over the cap is explained, not prepared", async () => {
  const client = await connect();
  const q = await client.callTool({ name: "quote_deposit", arguments: { vault: "setsUSDC", amount: "100000" } });
  assert.match(text(q), /would fail: .*before its cap/);
  const p: any = await client.callTool({ name: "prepare_deposit", arguments: { vault: "setsUSDC", amount: "100000", owner: HOLDER } });
  assert.equal(p.isError, true);
  await client.close();
});

test("prepare_deposit returns unsigned transactions with an expiry and the risk note", async () => {
  const client = await connect();
  const r = await client.callTool({ name: "prepare_deposit", arguments: { vault: "setsMON", amount: "1", owner: HOLDER } });
  const prepared = data(r);
  assert.equal(prepared.transactions.length, 1);
  assert.equal(prepared.transactions[0].value, "1000000000000000000");
  assert.ok(prepared.expiresAt);
  assert.match(text(r), /unaudited/);
  assert.equal(prepared.signUrl, `https://mcp.setsuna.finance/sign?vault=setsMON&action=deposit&amount=1&owner=${HOLDER}`);
  assert.match(text(r), /^Easiest: send the user this link/);
  await client.close();
});

test("signing links carry only the request, never transaction data", () => {
  const url = new URL(signUrl({ vault: "setsUSDC", action: "withdraw", all: true }));
  assert.equal(url.origin + url.pathname, "https://mcp.setsuna.finance/sign");
  assert.deepEqual([...url.searchParams.keys()], ["vault", "action", "all"]);
});

test("withdraw tools want exactly one of amount, shares or all", async () => {
  const client = await connect();
  const r: any = await client.callTool({ name: "prepare_withdraw", arguments: { vault: "setsMON", owner: HOLDER, amount: "1", all: true } });
  assert.equal(r.isError, true);
  assert.match(text(r), /exactly one of amount, shares or all/);
  await client.close();
});

test("bad arguments are rejected before anything is read", async () => {
  const client = await connect();
  const r: any = await client.callTool({ name: "get_position", arguments: { owner: "0x123" } });
  assert.equal(r.isError, true);
  await client.close();
});

test("the HTTP endpoint serves MCP and a plain explanation to browsers", async () => {
  const about = await handleMcpRequest(new Request("https://mcp.setsuna.finance/", { headers: { accept: "text/html" } }));
  assert.match(await about.text(), /claude mcp add --transport http setsuna/);
  const client = new Client({ name: "test", version: "0" });
  const fetchVia = (input: string | URL | Request, init?: RequestInit) => handleMcpRequest(new Request(input, init));
  await client.connect(new StreamableHTTPClientTransport(new URL("https://mcp.setsuna.finance/mcp"), { fetch: fetchVia }));
  assert.equal((await client.listTools()).tools.length, TOOLS.length);
  await client.close();
});
