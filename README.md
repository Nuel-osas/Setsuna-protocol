# Setsuna Protocol

Setsuna runs on **Monad mainnet (chain 143)**. Earn supplies USDC and MON through rule-based lending vaults, issuing `setsUSDC` and `setsMON`. Trade combines Kuru Spot and Perpl perpetuals. Portfolio shows wallet balances and positions.

The public app is [setsuna.finance](https://setsuna.finance). Earn is a capped beta with real funds. The old hosted fork, faucet and unlocked demo account have been retired. All Setsuna contracts are unaudited.

## Run the frontend

Use Node.js 24. Copy `.env.example` to `.env.local` and supply the public `SETSUNA_MAINNET_EARN` and `SETSUNA_MAINNET_TRADING` JSON manifests from your deployment. [Configuration and contract addresses](docs/LIVE-DEPLOYMENT.md).

```sh
npm ci
npm run dev
```

Open http://localhost:3000. With no manifests, the app displays read-only markets. With mainnet manifests, wallet transactions use real mainnet funds, including when the frontend runs locally. The app does not start or fall back to a fork.

## Keepers

The frontend does not need a blockchain server. The Earn keepers are separate persistent processes that observe rates and submit permissionless actions to Monad mainnet. They need dedicated gas wallets and durable transaction journals. `scripts/start-mainnet-keepers.mjs`, `Dockerfile.keepers` and `railway.json` define that service. [Keeper setup](src/content/docs/developers/keepers.md).

## Verification

```sh
npm run typecheck
npm run build
npm run test:mainnet
npm run test:earn-keeper
npm run test:keeper
npm run test:markets
npm run test:portfolio
npm run test:order-types
```

For contract development, install Foundry and run:

```sh
npm run setup:contracts
npm run contracts:test
```

Contract tests use local mocks and require no fork or RPC server. The development fork suites and their launch commands have been removed. Historical synthetic-fund acceptance records remain in `docs/research/` and are not evidence of mainnet transactions.

## Documentation

- [Product docs](https://setsuna.finance/docs/) and [engineering index](docs/README.md).
- [Architecture](docs/ARCHITECTURE-V2.md) and [Earn implementation](docs/EARN.md).
- [Live mainnet contracts](src/content/docs/developers/contracts.md).
- [Retired demo history](docs/PUBLIC-DEMO.md).

Keep private keys and machine-specific state in ignored local files. Browser wallets and Mera passkeys review transactions before signing. Perpl collateral and protection reserves use AUSD and remain separate from Earn.
