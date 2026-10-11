Venue addresses identify protocol deployments on Monad. Setsuna's Earn, Spot and Perps contracts are deployed on Monad mainnet. A venue address is not a Setsuna deposit address.

## Environments

| Environment | Chain ID | Current scope |
| --- | --- | --- |
| Monad mainnet | 143 | Earn (capped beta), Spot (Kuru) and Perps (Perpl) with real funds |

The application uses mainnet exclusively. Contract tests use local mocks; fork test suites and launchers have been removed.

## Mainnet trading contracts

Deployed at Monad block 112443702. Each address is fixed at construction; there is no admin. Fees go to the fixed treasury `0x6915aEf0947F4daD61aeF39Fe0f546A03190c92C`.

| Component | Address on Monad mainnet (143) | Fee |
| --- | --- | --- |
| Spot gateway (Kuru MON/USDC) | `0x978BdBaD035F1cdf47e10915c0ceC4A94C3fC17D` | 0.10% of swap output |
| Spot limit-order factory | `0xd0643451a10Ab33DEA53F1A64e94760770Be1E18` | None |
| Perpl account factory (BTC) | `0x00206Efbf5C49B61f2701a20d86329df4C3aB50D` | 1% of each protection top-up |

These contracts are unaudited. Trade small.

## Mainnet Earn contracts

Deployed at Monad block 112553267. setsUSDC is capped at 2,000 USDC and setsMON at 25,000 MON. Both take 2% of yield, never principal, for the treasury above. The guardian can only pause deposits or disable a destination; it cannot move funds. [Live deployment manifest](/api/deployment/).

| Component | Address on Monad mainnet (143) |
| --- | --- |
| setsUSDC vault | `0xAA5366660c3dDb3400f7083F21196Db125d6a2E7` |
| setsMON vault | `0x3F271AaD41D6064Be2A9245fE00Fa72606c5Fda1` |
| Native MON gateway | `0x32BcA3c83968682173c8c5A05Ab8Fb927EE5D8d2` |

These contracts are unaudited. Deposit only what you can afford to lose.

## Underlying assets

| Asset | Monad address                                |
| ----- | -------------------------------------------- |
| USDC  | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` |
| WMON  | `0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A` |
| AUSD  | `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a` |

## USDC lending destinations

| Protocol                    | Fixed address or market ID                                           |
| --------------------------- | -------------------------------------------------------------------- |
| Aave pool                   | `0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef`                         |
| Morpho Blue                 | `0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee`                         |
| Morpho aHYPER market ID     | `0x9e8441e7af65860feac831ebc117473e3033321abf528ebc8fbde1eeaaa3a626` |
| Euler eUSDC-12              | `0x1905EDDF5943ef6C92Ccf1469bd40fC2cB4A77b0`                         |
| Neverland pool              | `0x80F00661b13CC5F6ccd3885bE7b4C9c67545D585`                         |
| Curvance wsrUSD/USDC cToken | `0x7f779f7F5316F6164dC5a25422A5ee51504B284A`                         |

## MON and trading destinations

| Destination            | Address                                      |
| ---------------------- | -------------------------------------------- |
| Euler WMON market      | `0x7B4BcAEAC5Eb67ae947903F24BBa660eE06A5231` |
| Neverland WMON receipt | `0xD0fd2Cf7F6CEff4F96B1161F5E995D5843326154` |
| Kuru MON/USDC market   | `0x065c9d28e428a0db40191a54d33d5b7c71a9c394` |
| Perpl exchange         | `0x34B6552d57a35a1D042CcAe1951BD1C370112a6F` |

These are the destinations used by the checked implementation and pinned proof environments, not an assertion about current market liquidity or governance state.

## Deployment records

The mainnet Foundry deployment scripts emit the public manifests configured through `SETSUNA_MAINNET_EARN` and `SETSUNA_MAINNET_TRADING`. The app exposes their public fields at `/api/deployment/`; the keeper requires RPC chain ID 143.

The repository's `docs/research/usdc-five-2026-10-08.json` records test scope, transactions, source hashes and compiled sizes. Local executor private-key files are not deployment documentation and must not be published.
