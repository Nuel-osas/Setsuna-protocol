# Setsuna Bridge

Native USDC across chains with Circle CCTP V2, in Setsuna's app style. A standalone Next.js app, kept out of the main site build (root `tsconfig` covers `src/` only, and `/bridge/` is in `.vercelignore`).

```sh
cd bridge
npm ci
npm run dev        # http://localhost:3000
npm run build && npm start
```

## Chains

| Route | How it runs |
| --- | --- |
| EVM ↔ EVM, EVM ↔ Solana (26 chains) | Circle Bridge Kit (`@circle-fin/bridge-kit` + viem and Solana adapters) |
| anything ↔ Sui | Our PTBs against Circle's Sui V2 packages (`src/lib/sui.ts`) |
| anything ↔ Aptos | Circle's precompiled V2 Move scripts (`src/lib/aptos.ts`, `public/cctp/aptos`) |
| anything → Robinhood Chain | LI.FI (`src/lib/lifi.ts`): Robinhood has no USDC or CCTP, so the USDC lands as USDG or ETH |
| Starknet, Stellar | Listed as "soon" |

Mixed routes (e.g. Base → Sui, Sui → Solana) burn on the source, wait for the Iris attestation, then mint on the destination (`src/lib/legs.ts`, `runCustom` in `src/lib/bridge.ts`). Chain data comes from Bridge Kit's definitions (`src/lib/chains.ts`); Sui and Aptos V2 IDs are from Circle's package references and were checked on-chain in Oct 2026.

## Robinhood Chain (LI.FI)

Robinhood Chain (4663) has no USDC, so the bridge swaps on the way through LI.FI's public API: into **USDG** (Paxos's Global Dollar, the default) or **ETH** for gas there.

- **EVM chains LI.FI takes directly** (20 of them, listed in `DIAMOND`) send one LI.FI transaction: approve the exact amount, then send.
- **Every other source** (Sui, Solana, Aptos, and EVM chains LI.FI can't route from) first crosses on CCTP to the user's EVM wallet on Base, with our own legs. LI.FI then takes the USDC that actually arrived, read from Circle's signed message (amount minus the fee Circle took). That wallet signs the mint and the LI.FI transaction on Base, so it needs a little ETH there.
- **Every quote is checked before anything is signed:** chains, tokens, amount, sender and recipient must match the request. The transaction and the approval must go to LI.FI's contract pinned for that chain (from `li.quest/v1/chains`, checked against live quotes). Anything else is refused.
- **Progress comes from LI.FI's status API.** An unclear status stays pending. A refund clears the hop so a retry can send again; a sent LI.FI transaction is never sent twice.
- **Fees:** LI.FI's fixed 0.25% and the bridge it picks. Setsuna adds none.

The app always opens on mainnet. Testnet is one click away and is never remembered, so a returning visitor can't land on testnet by accident.

## Wallets

One wallet per ecosystem, connected side by side (`src/lib/wallets.tsx`): EVM via EIP-6963, Solana via injected providers (Phantom, Solflare, Backpack), Sui and Aptos via Wallet Standard.

## Transfers follow the wallet

CCTP needs only the source chain and the burn transaction to finish a transfer, and the USDC can only go to the recipient fixed in the burn, so a transfer can be picked up on any device (`src/lib/lookup.ts`):

- **From the wallet.** Connecting a wallet loads the mainnet transfers Setsuna has recorded from or to it, from `stats.setsuna.finance/api/bridge-transfers` (public, read-only, every field already public on-chain). For Solana the lookup covers the wallet and its USDC token account, which is where Circle mints.
- **From the transaction hash.** The **Find** box looks a burn up at Circle (Iris) on every chain the hash could belong to, then reads when it happened from the source chain itself.
- **Resuming.** Once the burn is done, the recipient's wallet alone can finish the mint; the sending wallet isn't needed.

Transfers are also kept in `localStorage` and can be retried from the failed step. The app reports each burn to Setsuna's record right after it lands, retrying while Circle hasn't indexed it yet.

## Notes

- Circle marks Fast Transfer as N/A for Sui and Aptos as sources (sub-second finality), so those burns use finality 2000 with no fee. The sandbox fee API has no quotes for Sui routes; the UI falls back to Standard.
- Solana mainnet calls go to PublicNode (`solana-rpc.publicnode.com`), set in `src/lib/chains.ts`. Solana's public endpoint, which Bridge Kit uses by default, refuses requests from web pages with `403 Access forbidden`, so every Solana adapter is given this connection.
- Some chains' first Bridge Kit endpoint fails in a browser, so `RPC_FIX` in `src/lib/chains.ts` puts working ones first: XDC (Ankr, public-rpc.com) and X Layer (`rpc.xlayer.tech`, dRPC). Every EVM read, including Bridge Kit's adapter, goes through `evmTransport`: those endpoints, then Bridge Kit's list, moving on when one fails.
- Not yet exercised end to end on every route; Solana ↔ Sui/Aptos uses Bridge Kit's action layer with a synthesized V2 chain definition and is the first place to look if a route fails.
- Gas-free bridging out of Monad for other apps (the user signs, Setsuna's relayer pays) is not part of this app; it lives in the SDK, the relayer and `contracts/src/bridge/SetsunaBridgeSponsor.sol`. See the [sponsored bridging guide](https://setsuna.finance/docs/developers/bridge/).

Chain logos: [web3icons](https://github.com/0xa3k5/web3icons) (MIT), see `public/icons/ATTRIBUTION.txt`. Aptos scripts: Circle (Apache-2.0), see `public/cctp/aptos/NOTICE`.
