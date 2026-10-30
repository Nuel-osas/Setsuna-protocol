# Security

Setsuna's contracts are **unaudited** and Earn is a capped beta (setsUSDC at most 2,000 USDC,
setsMON at most 25,000 MON). Deposit only what you can afford to lose.

## Reporting a vulnerability

Please report privately. Do not open a public issue or pull request.

- Use GitHub's **[Report a vulnerability](https://github.com/Nuel-osas/Setsuna-protocol/security/advisories/new)**
  form on this repository, or
- send a direct message to [@Setsunaprotocol](https://x.com/Setsunaprotocol) on X asking for a
  private channel.

Include the affected contract or app, the steps or transaction to reproduce it, and the impact you
expect. We will acknowledge within 72 hours and keep you updated until it is resolved.

## Scope

- The Earn vaults, adapters, MON gateway, setsAUSD wrapper and SetsunaAUSDSaver listed in the README.
- The Spot gateway, limit-order factory and Perpl account factory.
- The apps at setsuna.finance and bridge.setsuna.finance, the gas relayer, and the published
  `@setsunaprotocol/sdk` and `@setsunaprotocol/mcp` packages.

Third-party protocols the vaults lend into (Aave, Morpho, Euler, Neverland, Curvance, Kuru, Perpl,
Curve, Circle CCTP) are out of scope; report issues in them to their own teams.

## Trust model

- Vault rules are immutable. There is no owner who can move user funds, change the fee or replace
  a destination.
- A guardian can only pause new deposits or disable a destination. It cannot move funds.
- Rebalancing and rate observation are permissionless; callers cannot choose weights or recipients.
- The setsAUSD wrapper and saver have no owner. The relayer can only submit a saver's own signed
  deposit or withdrawal, and funds only ever reach the signer.
