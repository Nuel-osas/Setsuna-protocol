#!/usr/bin/env node
// Local MCP server over stdio: `npx -y @setsunaprotocol/mcp`. Reads Monad mainnet; holds no keys.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createSetsunaServer } from "./server.js";

const server = createSetsunaServer({ rpcUrl: process.env.MONAD_RPC_URL });
await server.connect(new StdioServerTransport());
// stdout carries the protocol, so status goes to stderr.
console.error("Setsuna MCP server running on stdio (Monad mainnet, read-only, no keys).");
