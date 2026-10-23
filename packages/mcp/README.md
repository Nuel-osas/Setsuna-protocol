# Setsuna MCP

Let your AI read Setsuna's vaults on Monad, and prepare deposits and withdrawals for you to sign.

Your AI proposes. You sign. The vault's on-chain rules decide the rest.

The server holds no keys and never sends a transaction. It reads the contracts on Monad mainnet and returns unsigned transactions that your own wallet signs.

## Connect

**Hosted, nothing to install**

```sh
claude mcp add --transport http setsuna https://mcp.setsuna.finance/mcp
```

Claude Desktop, Cursor and other MCP apps: add a remote MCP server with the URL `https://mcp.setsuna.finance/mcp`.

**Local, over stdio**

```sh
claude mcp add setsuna -- npx -y @setsunaprotocol/mcp
```

```json
{
  "mcpServers": {
    "setsuna": { "command": "npx", "args": ["-y", "@setsunaprotocol/mcp"] }
  }
}
```

Set `MONAD_RPC_URL` to use your own Monad RPC. The default is `https://rpc2.monad.xyz`.

## Tools

| Tool | What your AI can do |
|---|---|
| `list_vaults` | Compare setsUSDC and setsMON: net assets, net and base APR, where the money sits, cash buffer, room under the cap |
| `get_vault` | One vault in detail: every market's share and rate, share price, cap, pause state, last rebalance |
| `get_markets` | Monad's lending markets the vaults may use, with rates, size, available cash and eligibility |
| `get_position` | A wallet's shares and their value, what is withdrawable now, and its USDC and MON |
| `explain_rules` | The vault's fixed rules, read from the contract, in plain words |
| `quote_deposit` · `quote_withdraw` | What a deposit or withdrawal would give today, and what would stop it |
| `prepare_deposit` · `prepare_withdraw` | Unsigned transactions, in order, for your wallet to sign |

Every tool is read-only toward the chain. Prepared transactions carry the same protection as the app: each reverts if the result falls more than 0.1% short of the quote, or if it is sent after 10 minutes.

## Try asking

- "Which Setsuna vault pays more right now, and where does it keep the money?"
- "Explain setsUSDC's rules like I'm new to DeFi."
- "What's in my Setsuna position? My wallet is 0x…"
- "Prepare a 50 USDC deposit into setsUSDC from 0x…"

## Safety

Setsuna's contracts are unaudited and the vaults are capped at 2,000 USDC and 25,000 MON. Deposit only what you can afford to lose. Rates are variable base rates, not promises.

The server never asks for a private key, and you should never give one to any AI tool.

Built on [`@setsunaprotocol/sdk`](https://www.npmjs.com/package/@setsunaprotocol/sdk). Source: [`packages/mcp`](https://github.com/Nuel-osas/Setsuna-protocol/tree/main/packages/mcp).
