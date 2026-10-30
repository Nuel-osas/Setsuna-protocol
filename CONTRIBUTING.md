# Contributing

Setsuna holds real money on Monad mainnet. These conventions keep changes reviewable and keep the
rules that protect deposits from being broken by accident.

## Setup

Node.js 24 (`.nvmrc`) and npm. Foundry for the contracts.

```sh
npm ci
cp .env.example .env.local     # public manifests only; never put a private key here
npm run setup:contracts        # Foundry dependencies
```

## Before you push

```sh
npm run typecheck
npm run build
npm run test:earn-keeper && npm run test:keeper && npm run test:markets && npm run test:portfolio
npm run contracts:test          # if you touched Solidity
```

Report what you ran in the pull request. A step you skipped is listed as skipped.

## Branches, commits and pull requests

- Branch from an up-to-date `main` as `<scope>/<topic>`: `bridge/claim-fixes`, `stats/earn-volume`,
  `contracts/ausd-saver`. One theme per branch. Nothing is committed straight to `main`.
- Commit subject: a lowercase scope, then one sentence saying what behaviour changed.
  Scopes in use: `earn`, `trade`, `bridge`, `contracts`, `sdk`, `mcp`, `relayer`, `stats`, `keepers`,
  `docs`, `ci`, `chore`.

  ```
  bridge: stop before a burn the wallet can no longer cover
  stats: count Earn volume (deposits + withdrawals) alongside spot
  ```

- The body says why, and the alternative you rejected. The diff already says what. A bug fix says
  what was wrong and that the new test fails without the fix.
- A large piece of finished work is split into one commit per theme before it is pushed. Squash WIP
  and checkpoint commits.
- Every change reaches `main` through a pull request merged with a merge commit. Never force-push or
  rewrite pushed history. Delete the branch once it merges.
- `main` is what runs in production: the app, bridge and stats deploy from it.

## Rules that protect funds

1. **Fail closed.** Missing, malformed, expired or paused input is rejected, never defaulted.
2. **A failed read is unknown, never zero.** Show "unavailable", not a balance of 0.
3. **Never trust a claimed amount.** Measure it where it moves (balance before and after).
4. **Money stays in integer base units** (`bigint`, `uint256`) until it is displayed.
5. **An ambiguous status is pending, never failed**, so nobody pays twice.
6. **No new address without a source.** Add it to the contracts page with how it was verified.
7. **No admin path to user funds.** Vault rules are immutable; a guardian may only pause deposits or
   disable a destination.
8. **Monad specifics:** `block.timestamp` repeats across blocks, so compare with `>=`; gas is charged
   on the gas limit; EIP-7702 smart accounts must keep 10 MON when moving MON out.
9. **Secrets never reach git or the browser.** Keys live in ignored local files or the host's secret
   store, and `NEXT_PUBLIC_` variables are public by definition.

## Solidity

Custom errors with arguments, `nonReentrant` on every function that moves funds, `SafeERC20` for
token calls, checks-effects-interactions. Each critical rule has a test for the path that succeeds
and one for the path that must revert.

## Writing

Plain words, real numbers, limits stated up front. Every failure message says whether money moved.
Update the docs in the same change as the code.
