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
| Starknet, Stellar | Listed as "soon" |

Mixed routes (e.g. Base → Sui, Sui → Solana) burn on the source, wait for the Iris attestation, then mint on the destination (`src/lib/legs.ts`, `runCustom` in `src/lib/bridge.ts`). Chain data comes from Bridge Kit's definitions (`src/lib/chains.ts`); Sui and Aptos V2 IDs are from Circle's package references and were checked on-chain in Oct 2026.

## Wallets

One wallet per ecosystem, connected side by side (`src/lib/wallets.tsx`): EVM via EIP-6963, Solana via injected providers (Phantom, Solflare, Backpack), Sui and Aptos via Wallet Standard.

## Notes

- Transfers are saved in `localStorage` and can be retried from the failed step.
- Circle marks Fast Transfer as N/A for Sui and Aptos as sources (sub-second finality), so those burns use finality 2000 with no fee. The sandbox fee API has no quotes for Sui routes; the UI falls back to Standard.
- Not yet exercised end to end on every route; Solana ↔ Sui/Aptos uses Bridge Kit's action layer with a synthesized V2 chain definition and is the first place to look if a route fails.

Chain logos: [web3icons](https://github.com/0xa3k5/web3icons) (MIT), see `public/icons/ATTRIBUTION.txt`. Aptos scripts: Circle (Apache-2.0), see `public/cctp/aptos/NOTICE`.
