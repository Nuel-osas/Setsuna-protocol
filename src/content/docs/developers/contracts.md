Venue addresses identify protocol deployments on Monad. Setsuna's own demo contracts are deployed on its separate synthetic-fund fork; a venue address is not a mainnet Setsuna deposit address.

## Environments

| Environment                   | Chain ID | Current scope                                            |
| ----------------------------- | -------- | -------------------------------------------------------- |
| Monad mainnet                 | 143      | Source of protocol state and public market reads         |
| Local five-protocol USDC fork | 31337    | Synthetic-fund Earn transactions; source block 111560409 |
| Unified local demo | 31337 | setsUSDC, setsMON, Spot and Perps together; source block 111560409 |
| Local combined trading fork   | 31337    | setsMON, Spot and Perps with a historical Perpl fixture  |
| Public Railway fork | 31337 | Earn, Spot, Perps and test funding; source block 111560409 |

Separate forks may share chain IDs and deployment addresses while holding different state. Always pair the RPC endpoint with its deployment manifest. The public fork runs on Railway and does not depend on Tenderly.

## Public demo contracts

RPC: `https://setsuna-metropolis.vercel.app/api/rpc/`. [Explorer](https://setsuna-workers-production.up.railway.app/) · [Validated deployment manifest](/api/deployment/).

| Component | Address on demo chain 31337 |
| --- | --- |
| setsMON vault | `0x114255d235bA6EfF3b0F6b6498035c62F1A62a7F` |
| Native MON gateway | `0x5d479d7fe413Eb2Ed54741B8d914afE8cf9780f0` |
| setsUSDC vault | `0x55EcE31A7fC5f99460a1F3970d60Dd701B7E8021` |
| Spot gateway | `0xAD4602705646996Ae3AACe83f7C8d478A59ca5Ae` |
| Perpl account factory | `0x97F26EB913812C8008016633144af437a54870Fb` |
| Bounded faucet | `0x3a2aaAA478F1b827C24E91a7E612fdCaA3c18dDF` |

These addresses are for the public demo only. Do not send mainnet assets to them. Explorer receipts prove execution on this fork.

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

The five-protocol launcher writes `.local/setsusdc-five/demo.json`. Its public fields identify the vault, adapters, source block and fork hash. The app and keeper validate the manifest against the connected RPC before enabling the executable path.

The repository's `docs/research/usdc-five-2026-10-08.json` records test scope, transactions, source hashes and compiled sizes. Local executor private-key files are not deployment documentation and must not be published.
