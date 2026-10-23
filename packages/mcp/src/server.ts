import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSetsuna, type Setsuna, type VaultState } from "@setsunaprotocol/sdk";
import { z } from "zod";

export const SERVER_NAME = "setsuna";
export const SERVER_VERSION = "0.1.1";

const INSTRUCTIONS = `Setsuna runs rule-bound Earn vaults on Monad mainnet (chain 143): setsUSDC holds USDC and setsMON holds MON. Deposits are allocated across Monad lending markets (Aave, Morpho, Euler, Neverland, Curvance) by fixed on-chain rules that nobody can change.

These tools read the vaults straight from the chain. The prepare tools return unsigned transactions for the user's own wallet, plus a signing link (mcp.setsuna.finance/sign) where the user reviews and signs them in their browser wallet: this server holds no keys, never signs and never sends. Show the user every transaction, and what it does, before they sign. Never ask for a private key or seed phrase.

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

export const SIGN_PAGE = "https://mcp.setsuna.finance/sign";

/** A link to Setsuna's signing page. It carries only the request; the page rebuilds the transactions itself when opened. */
export function signUrl(request: { vault: string; action: "deposit" | "withdraw"; owner?: string; amount?: string; shares?: string; all?: boolean }) {
  const q = new URLSearchParams({ vault: request.vault, action: request.action });
  if (request.amount !== undefined) q.set("amount", request.amount);
  if (request.shares !== undefined) q.set("shares", request.shares);
  if (request.all) q.set("all", "true");
  if (request.owner) q.set("owner", request.owner);
  return `${SIGN_PAGE}?${q}`;
}

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

  const amount = z.string().regex(/^\d+(\.\d+)?$/, 'A decimal number such as "25" or "0.5".');
  const withdrawRequest = {
    amount: amount.optional().describe("How much of the vault's asset to withdraw, in USDC or MON."),
    shares: amount.optional().describe("How many vault shares to redeem, instead of an amount."),
    all: z.boolean().optional().describe("Withdraw the whole position."),
  };
  type WithdrawArgs = { amount?: string; shares?: string; all?: boolean };
  const pick = (a: WithdrawArgs) => {
    const given = [a.amount !== undefined, a.shares !== undefined, a.all === true].filter(Boolean).length;
    if (given !== 1) throw new Error("Give exactly one of amount, shares or all.");
    return a.all ? ({ all: true } as const) : a.shares !== undefined ? { shares: a.shares } : { amount: a.amount! };
  };
  const slippage = z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Most the result may fall short of the quote, in basis points. Default 10 (0.1%).");
  const steps = (p: { transactions: { label: string }[]; expiresAt: string; appUrl: string; signUrl: string; notes: string[] }) =>
    [
      `Easiest: send the user this link to review and sign in their browser wallet. The page rebuilds the transactions fresh, so it never expires: ${p.signUrl}`,
      `${p.transactions.length} transaction${p.transactions.length > 1 ? "s" : ""} for the user's wallet to sign, in order:`,
      ...p.transactions.map((t, i) => `${i + 1}. ${t.label}`),
      `Valid until ${p.expiresAt}; prepare again after that. Or use the app: ${p.appUrl}`,
      ...p.notes,
    ].join("\n");

  server.registerTool(
    "quote_deposit",
    {
      title: "Quote a deposit",
      description: "Shares a deposit would mint at today's price, and anything that would stop it: the cap, a deposit pause, or the wallet's balance.",
      inputSchema: { vault, amount: amount.describe("Amount of USDC or MON to deposit."), owner: address.optional().describe("The depositing wallet, to check its balance.") },
      annotations: readOnly,
    },
    ({ vault: id, amount: value, owner }) =>
      run(
        () => setsuna.quoteDeposit(id, value, owner),
        (q) => (q.ok ? `Depositing ${short(q.assets.formatted)} mints about ${short(q.shares.formatted)} ${q.vault}.` : `This deposit would fail: ${q.problems.join(" ")}`),
      ),
  );

  server.registerTool(
    "quote_withdraw",
    {
      title: "Quote a withdrawal",
      description: "What a withdrawal would return at today's price, and whether the markets hold enough cash for it right now.",
      inputSchema: { vault, owner: address.describe("The wallet that holds the shares."), ...withdrawRequest },
      annotations: readOnly,
    },
    (a) =>
      run(
        () => setsuna.quoteWithdraw(a.vault, a.owner, pick(a)),
        (q) => (q.ok ? `Redeeming ${short(q.shares.formatted)} ${q.vault} returns about ${short(q.assets.formatted)}.` : `This withdrawal would fail: ${q.problems.join(" ")}`),
      ),
  );

  server.registerTool(
    "prepare_deposit",
    {
      title: "Prepare a deposit",
      description:
        "Build the unsigned transactions for a deposit, in order: for setsUSDC an exact USDC approval when needed, then the deposit; for setsMON one native MON deposit through the gateway. Nothing is signed or sent: give the user the signing link, or show each transaction for their own wallet to sign. Each reverts if it would mint less than the quote minus the slippage, or after 10 minutes.",
      inputSchema: { vault, amount: amount.describe("Amount of USDC or MON to deposit."), owner: address.describe("The wallet that will sign and receive the shares."), slippage_bps: slippage },
      annotations: readOnly,
    },
    (a) =>
      run(
        async () => ({
          ...(await setsuna.prepareDeposit(a.vault, a.amount, a.owner, { slippageBps: a.slippage_bps })),
          signUrl: signUrl({ vault: a.vault, action: "deposit", amount: a.amount, owner: a.owner }),
        }),
        steps,
      ),
  );

  server.registerTool(
    "prepare_withdraw",
    {
      title: "Prepare a withdrawal",
      description:
        "Build the unsigned transactions for a withdrawal back to the owner, in order: setsUSDC returns USDC in one transaction; setsMON approves exactly those shares to the gateway when needed, then returns native MON. Nothing is signed or sent: give the user the signing link, or show each transaction for their own wallet to sign.",
      inputSchema: { vault, owner: address.describe("The wallet that holds the shares and receives the assets."), ...withdrawRequest, slippage_bps: slippage },
      annotations: readOnly,
    },
    (a) =>
      run(
        async () => ({
          ...(await setsuna.prepareWithdraw(a.vault, a.owner, pick(a), { slippageBps: a.slippage_bps })),
          signUrl: signUrl({ vault: a.vault, action: "withdraw", ...pick(a), owner: a.owner }),
        }),
        steps,
      ),
  );

  return server;
}
