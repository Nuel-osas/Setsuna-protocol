// Vercel function for mcp.setsuna.finance. Every path is rewritten here (see vercel.json).
import { handleMcpRequest } from "../dist/http.js";

const handle = (request) => handleMcpRequest(request, { rpcUrl: process.env.MONAD_RPC_URL });
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
export const OPTIONS = handle;
