import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSetsuna, type Setsuna, type VaultState } from "@setsunaprotocol/sdk";
import { z } from "zod";

export const SERVER_NAME = "setsuna";
export const SERVER_VERSION = "0.1.0";

const INSTRUCTIONS = `Setsuna runs rule-bound Earn vaults on Monad mainnet (chain 143): setsUSDC holds USDC and setsMON holds MON. Deposits are allocated across Monad lending markets (Aave, Morpho, Euler, Neverland, Curvance) by fixed on-chain rules that nobody can change.

These tools read the vaults straight from the chain. The prepare tools return unsigned transactions for the user's own wallet: this server holds no keys, never signs and never sends. Show the user every transaction, and what it does, before they sign. Never ask for a private key or seed phrase.

Setsuna's contracts are unaudited and the vaults are capped (2,000 USDC and 25,000 MON). Say so when someone considers depositing, and suggest only amounts they can afford to lose. APRs are variable base rates, not promises.`;

const vault = z.enum(["setsUSDC", "setsMON"]).describe('Which vault: "setsUSDC" (USDC) or "setsMON" (MON).');
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "A 0x address of 40 hex characters.");

const json = (value: unknown) => JSON.stringify(value, null, 2);
const reply = (summary: string, data: unknown) => ({
  content: [{ type: "text" as const, text: `${summary}\n\n${json(data)}` }],
});
const fail = (error: unknown) => ({
  isError: true,
  content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
});
async function run<T>(fn: () => Promise<T>, summarize: (data: T) => string) {
  try {
    const data = await fn();
    return reply(summarize(data), data);
  } catch (error) {
    return fail(error);
  }
}

/** Readable figures for summaries; the JSON below each summary keeps full precision. */
const short = (formatted: string) => {
  const n = Number(formatted);
  return n.toLocaleString("en-US", { maximumFractionDigits: n >= 1 ? 4 : 6 });
};

const vaultLine = (v: VaultState) =>
  `${v.id}: ${short(v.netAssets.formatted)} ${v.assetSymbol} at ${v.netAprPct}% net APR (${v.baseAprPct}% base, ${v.performanceFeePct}% fee on yield). ` +
  `${v.allocations.map((a) => `${a.venue} ${a.sharePct.toFixed(1)}%`).join(", ")}, cash ${v.idle.sharePct.toFixed(1)}%. ` +
  `${v.depositsPaused ? "Deposits paused." : `Room under the cap: ${short(v.capRemaining.formatted)} ${v.assetSymbol}.`}`;

const readOnly = { readOnlyHint: true, openWorldHint: true } as const;

/** An MCP server exposing Setsuna's vaults. Read-only toward the chain; prepare tools return unsigned transactions. */
export function createSetsunaServer(options: { setsuna?: Setsuna; rpcUrl?: string } = {}) {
  const setsuna = options.setsuna ?? createSetsuna({ rpcUrl: options.rpcUrl });
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: INSTRUCTIONS });

  server.registerTool(
    "list_vaults",
    {
      title: "List Setsuna vaults",
      description: "Compare setsUSDC and setsMON: net assets, net and base APR, where the money sits by market, cash buffer, and room under the cap.",
      annotations: readOnly,
    },
    () => run(() => setsuna.getVaults(), (vs) => vs.map(vaultLine).join("\n")),
  );

  server.registerTool(
    "get_vault",
    {
      title: "Get one vault",
      description: "One vault in detail: every market's share and current rate, cash buffer, share price, cap, pause state and last rebalance time.",
      inputSchema: { vault },
      annotations: readOnly,
    },
    ({ vault: id }) => run(() => setsuna.getVault(id), vaultLine),
  );

  server.registerTool(
    "get_markets",
    {
      title: "Get lending markets",
      description: "Every Monad lending market the vaults may use, with its supply APR, size, available cash, and whether it is eligible for new money.",
      annotations: readOnly,
    },
    () =>
      run(
        () => setsuna.getMarkets(),
        (ms) => ms.map((m) => `${m.vault} · ${m.venue} (${m.market}): ${m.aprPct}% APR${m.eligible ? "" : ", not eligible for new money"}`).join("\n"),
      ),
  );

  server.registerTool(
    "get_position",
    {
      title: "Get a wallet's position",
      description: "A wallet's shares in each vault, what they are worth now, what is withdrawable right now, and the wallet's USDC and MON balances.",
      inputSchema: { owner: address.describe("The wallet to look up.") },
      annotations: readOnly,
    },
    ({ owner }) =>
      run(
        () => setsuna.getPosition(owner),
        (p) =>
          [
            ...p.vaults.map((v) => `${v.vault}: ${short(v.shares.formatted)} shares worth ${short(v.assets.formatted)} (withdrawable now ${short(v.withdrawableNow.formatted)}).`),
            `Wallet: ${short(p.wallet.USDC.formatted)} USDC, ${short(p.wallet.MON.formatted)} MON.`,
          ].join("\n"),
      ),
  );

  server.registerTool(
    "explain_rules",
    {
      title: "Explain a vault's rules",
      description: "The vault's fixed on-chain rules, read from the contract, with a plain sentence for each: cash buffer, caps per market, move limits, rate checks, fee and what the guardian can and cannot do.",
      inputSchema: { vault },
      annotations: readOnly,
    },
    ({ vault: id }) => run(() => setsuna.getRules(id), (r) => r.rules.map((line) => `- ${line}`).join("\n")),
  );

  return server;
}
