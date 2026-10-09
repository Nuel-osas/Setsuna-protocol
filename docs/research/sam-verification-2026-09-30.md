# SAM verification notes — 30 September 2026

Author: **Codex**. Prepared for the user's research into SAM as a reference for Monad Onchain Finance & Trading. No Setsuna pivot or implementation change is implied.

Scope: public documentation, selected source files at commit `ff7a421adcfee3f4132af63cf93378d18d39a3ae`, and read-only mainnet/API observations. This is not a security audit, a source-to-bytecode equivalence check, or an executed deposit/withdrawal test.

## Directly observed deployment facts

Evidence: [saved RPC and service snapshot](./sam-onchain-snapshot-2026-09-30.json). The RPC was `https://sui-rpc.publicnode.com`. A contemporaneous checkpoint, sequence `328548320`, had timestamp **2026-09-30 05:25:24.877 UTC**, confirming that the endpoint was serving current chain data.

Both vaults named in the [public deployment manifest](https://github.com/Iamknownasfesal/sam/blob/ff7a421adcfee3f4132af63cf93378d18d39a3ae/deployments/mainnet.json) exist on mainnet:

| Observation | samSUI | samUSDC |
|---|---|---|
| Outer vault | `0x0f386c1f036d55b8d8d16b7a8738d6e51a5adf06707fbc236eb4fd3381bba6c1` | `0x57b0fbc9b3d299015480b56ff7cee04b7191ac9c2f6a8f75f1044b4366b5b5ae` |
| Last outer-object transaction | 2026-07-28 18:29:10.915 UTC | 2026-07-28 18:29:33.089 UTC |
| Paused flag | false | false |
| Stored underlying backing shares | 0.100142979 SUI | 0.775124 USDC |
| Configured deposit fee | 0 bps = 0% | 0 bps = 0% |
| Configured withdrawal fee | 1 bps = 0.01% | 1 bps = 0.01% |
| Configured performance fee | 100 bps = 1% | 100 bps = 1% |
| Idle / exposure / depth settings | 5% / 70% / 50% | 5% / 70% / 50% |

The balances above are **stored accounting**, not a fresh valuation of all external positions or unharvested rewards, and exclude separately accounted fee balances. They do not establish historical peak TVL, unique users, revenue, or whether a later deployment exists elsewhere. The last recorded transactions establish inactivity of these particular published outer vault objects over that interval; they do not establish why.

The repository's [fee documentation](https://github.com/Iamknownasfesal/sam/blob/ff7a421adcfee3f4132af63cf93378d18d39a3ae/docs/src/content/docs/math/fees.md) advertises a **10%** performance fee. That differs from the **1%** configuration observed in both vaults. The [basis-point implementation](https://github.com/Iamknownasfesal/sam/blob/ff7a421adcfee3f4132af63cf93378d18d39a3ae/packages/libs/bps/sources/bps.move) uses a denominator of 10,000.

At approximately 05:23 UTC, the website returned HTTP 200. The public API's `/health` returned HTTP 503 and reported approximately 63.4 days of indexer lag. `/api/vaults` and `/api/revenue` returned HTTP 500. These are time-specific observations. `/status` reported `keeper.running: false`, but the source supports running the keeper separately, so that flag alone does not establish whether any external keeper is operating.

The default public Sui fullnode returned a JSON-RPC deprecation message. SAM's checked-in SDK uses that endpoint by default. This is a plausible integration-maintenance issue, **not a verified diagnosis of its deployed API failures**: the deployed configuration and logs were not available.

## Qualifications to the product narrative

- The public allocator weights measured yields and applies liquidity/exposure limits. The source also adds a small 0.5-percentage-point exploration weight. This is deterministic allocation logic; it does not establish an AI model or a comprehensive model of protocol failure risk. [Allocator](https://github.com/Iamknownasfesal/sam/blob/ff7a421adcfee3f4132af63cf93378d18d39a3ae/packages/sam/sources/protocol/state_inner.move).
- Public rebalancing is permissionless, but an additional admin-directed rebalance exists. Admins can also change fees, change allocation parameters, register adapters, and pause user actions including withdrawals. The source's fee limit is 30% per fee type. [Entry functions](https://github.com/Iamknownasfesal/sam/blob/ff7a421adcfee3f4132af63cf93378d18d39a3ae/packages/sam/sources/state.move), [fee limits](https://github.com/Iamknownasfesal/sam/blob/ff7a421adcfee3f4132af63cf93378d18d39a3ae/packages/sam/sources/protocol/fee/fee_config.move).
- The inspected admin, super-admin, and core upgrade capabilities were owned by the manifest's deployer address. The address ownership does not by itself establish its signing arrangement, multisig threshold, or key-storage practices.
- No scheduled lockup does not guarantee immediate liquidity. The project's own risk page acknowledges redemption limitations when lending markets lack cash, and calls the deployment experimental and unaudited. [Risks](https://github.com/Iamknownasfesal/sam/blob/ff7a421adcfee3f4132af63cf93378d18d39a3ae/docs/src/content/docs/getting-started/risks.md).
- Oracle-free APR measurement is narrower than an oracle-independent system. Its lending integrations include oracle update dependencies. Historical APR is a routing input, not a forecast guarantee.
- The source includes Move tests and CI configuration for core tests, typechecking and a web build. Codex did not run those checks or verify a complete security review.

## Product and hackathon interpretation

SAM offers a coherent user workflow: deposit one asset, receive vault shares, delegate ongoing allocation and reward handling to contracts, inspect results, and redeem. Its mainnet objects and implementation substantiate engineering work. This inspection does **not** establish sustained usage or product-market fit.

SAM is absent from the [official Sui Overflow 2026 winner announcement](https://www.sui.io/blog/sui-overflow-2026-winners). The user reports that it entered. The original submission and judge feedback were not located, so no cause for its result is established.

The repository's [source-available license](https://github.com/Iamknownasfesal/sam/blob/ff7a421adcfee3f4132af63cf93378d18d39a3ae/LICENSE) permits study and limited attributed reuse but restricts taking or operating the project as a whole. The published SDK separately carries an MIT notice; that should not be treated as a license for the entire repository.

For Monad, the useful reference is the complete customer workflow and transparent accounting. New venue adapters, equivalent financial assumptions, reliable operations, and a differentiated customer case would still need to be built and validated.
