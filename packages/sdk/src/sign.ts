import type { VaultId } from "./constants.js";

/** Setsuna's signing page: it rebuilds a deposit or withdrawal when opened and the visitor's own wallet signs it. */
export const SIGN_PAGE = "https://mcp.setsuna.finance/sign";

export type SignRequest =
  | { vault: VaultId; action: "deposit"; amount: string; owner?: string }
  | { vault: VaultId; action: "withdraw"; amount: string; owner?: string }
  | { vault: VaultId; action: "withdraw"; shares: string; owner?: string }
  | { vault: VaultId; action: "withdraw"; all: true; owner?: string };

const NUMBER = /^\d+(\.\d+)?$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * A link to Setsuna's signing page for a deposit or withdrawal. Hand it to a person to review and sign in
 * their browser wallet. The link carries only the request, never transaction data: the page rebuilds the
 * transactions with this SDK when opened, so it cannot be made to send anything else, and it never expires.
 * `owner` is a hint; the page warns if the connected wallet differs.
 */
export function signUrl(request: SignRequest, base: string = SIGN_PAGE): string {
  if (request.vault !== "setsUSDC" && request.vault !== "setsMON") throw new Error(`Unknown vault "${request.vault}". Use "setsUSDC" or "setsMON".`);
  const q = new URLSearchParams({ vault: request.vault, action: request.action });
  if ("amount" in request) {
    if (!NUMBER.test(request.amount) || Number(request.amount) <= 0) throw new Error(`"${request.amount}" is not a positive decimal amount.`);
    q.set("amount", request.amount);
  } else if ("shares" in request) {
    if (!NUMBER.test(request.shares) || Number(request.shares) <= 0) throw new Error(`"${request.shares}" is not a positive share count.`);
    q.set("shares", request.shares);
  } else if ("all" in request && request.all) {
    q.set("all", "true");
  } else {
    throw new Error("A withdrawal needs one of amount, shares or all.");
  }
  if (request.owner !== undefined) {
    if (!ADDRESS.test(request.owner)) throw new Error(`"${request.owner}" is not a 0x address.`);
    q.set("owner", request.owner);
  }
  return `${base}?${q}`;
}
