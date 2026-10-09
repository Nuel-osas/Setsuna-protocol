# Setsuna introduction thread — 2 October 2026

**Complete posting pack:** [Four images, final numbered captions, alt text and Word/PDF guides](setsuna-intro-thread-2026-10-02/POSTING-GUIDE.md). Use that package for publication; the initial draft below is retained for reference.

Author: Codex. Draft only; not published.

Reference: [Nuntio product introduction](https://x.com/nuntio_finance/status/2105923805327536426).
Adapted structure: clear product introduction, user problem, operating rules, honest status and invitation for feedback. The graphic uses Setsuna branding; it is an explainer, not a screenshot of a deployed vault.

Attach [the introduction graphic](setsuna-intro-2026-10-02-v1.png) to the first post; publish subsequent entries as replies in order. Each post fits within 280 characters. No post claims public availability, a guaranteed rate, or unique Monad capability.

## Post 1 of 4

Meet Setsuna: automated Earn vaults for your USDC on Monad.

One deposit, with allocation, rebalancing and compounding handled by onchain rules.

In development. Here’s what we’re building 🧵

## Post 2 of 4

Checking rates. Moving funds. Checking again.

Setsuna is being built to handle those repeated steps. Deposit USDC for setsUSDC shares, which represent your share of the pool as it earns—or takes losses.

## Post 3 of 4

The prototype has a 10% cash target, a 60% cap per destination, and bounded moves.

Anyone can trigger a valid rebalance. The vault calculates where funds go; the caller cannot choose arbitrary destinations.

Withdrawals require available cash and healthy accounting.

## Post 4 of 4

Aave and Morpho deposit/withdrawal flows have passed tests on a Monad mainnet fork using synthetic funds.

Public deposits aren’t open yet.

Holding USDC on Monad? Tell us what you currently do with it.

## Image alt text

Setsuna introduction on a dark blue flowing background. Headline: Your USDC. Less to manage. Automated Earn vaults on Monad: allocation, rebalancing and compounding. A setsUSDC rules card lists a 10% cash target, a 60% cap per destination, and public execution of valid rebalances. Rules are enforced onchain. The footer says: In development; deposits not open.

## Publication context

The current factory has two adapters and excludes the WBTC/USDC Morpho market at the pinned block under its $250,000 size floor. A separately disclosed lower-threshold test profile establishes the two-protocol round trip. This thread reports integration tests, not a live allocation or customer yield. The five-market website portfolio is research beyond the implemented factory. See [the implementation guide](../../docs/EARN.md) for exact behavior and constraints. Recheck development/deployment status before publishing later.
