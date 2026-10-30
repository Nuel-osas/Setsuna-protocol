## What changed

<!-- One or two sentences. What can Setsuna do now that it couldn't before? -->

## Why

<!-- The reasoning, and the alternative you rejected. -->

## How it was verified

<!-- Commands run, tests added, transaction hashes. "It builds" is not verification. -->

- [ ] `npm run typecheck` and `npm run build`
- [ ] Relevant `npm run test:*` suites
- [ ] `npm run contracts:test` (if Solidity changed)
- [ ] Checked on Monad mainnet with a small amount (tx hash: ), if onchain behaviour changed

## Still open

<!-- What this doesn't do, and anything untested or uncertain. -->

---

- [ ] A failed read shows as unknown, not 0; an ambiguous status shows as pending, not failed
- [ ] Amounts are measured where they move, not taken from a parameter
- [ ] Any new address is documented with how it was verified
- [ ] No secret can reach git or the browser bundle
- [ ] Docs updated in the same change
