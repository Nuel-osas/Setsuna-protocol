# @setsunaprotocol/sdk

Read Setsuna's rule-bound Earn vaults on Monad, prepare deposits and withdrawals for a wallet to sign, and bridge USDC or AUSD out of Monad with the gas sponsored.

The SDK never holds a key and never sends a transaction itself (sponsored calls go to Setsuna's relayer, which can only carry out what the user signed). Reads come straight from the contracts on Monad mainnet. Prepared transactions are plain `{ to, data, value }` objects that your user's wallet signs.

```sh
npm install @setsunaprotocol/sdk viem
```

```ts
import { createSetsuna } from "@setsunaprotocol/sdk";

const setsuna = createSetsuna(); // Monad mainnet over https://rpc2.monad.xyz

const usdc = await setsuna.getVault("setsUSDC");
usdc.netAprPct;        // 4.316, after the 2% fee on yield
usdc.allocations;      // [{ venue: "Aave", sharePct: 37.7, aprPct: 4.06, ... }, ...]

const prepared = await setsuna.prepareDeposit("setsUSDC", "25", "0xYourWallet");
for (const tx of prepared.transactions) await wallet.sendTransaction(tx); // approve (if needed), then deposit
```

## What it reads

| Call | Returns |
|---|---|
| `getVaults()` · `getVault(id)` | Net assets, share price, base and net APR, cash buffer, each market's share and rate, cap room, pause state, last rebalance |
| `getMarkets()` | Every lending market the vaults may use, with its rate, size, available cash and whether it is eligible |
| `getPosition(owner)` | Shares and their value in each vault, what is withdrawable now, and the wallet's USDC and MON |
| `getRules(id)` | The vault's fixed parameters, read from the contract, with a plain sentence for each |
| `quoteDeposit(id, amount, owner?)` | Shares at today's price, and anything that would stop the deposit (cap, pause, balance) |
| `quoteWithdraw(id, owner, request)` | Assets returned, and whether the markets have the cash for it now |

## What it prepares

| Call | Transactions |
|---|---|
| `prepareDeposit("setsUSDC", amount, owner)` | `approve` for exactly the amount (only when needed), then `depositWithMinShares` |
| `prepareDeposit("setsMON", amount, owner)` | `depositMON` on the gateway, sending native MON |
| `prepareWithdraw("setsUSDC", owner, request)` | `redeemWithMinAssets` back to the owner |
| `prepareWithdraw("setsMON", owner, request)` | `approve` of exactly those shares to the gateway (only when needed), then `redeemMON`, which returns native MON |

`request` is `{ amount: "10" }` in the vault's asset, `{ shares: "9.98" }`, or `{ all: true }`.

Every prepared deposit or withdrawal carries the same protection as the app: it reverts if it would mint or return more than 0.1% less than quoted (`slippageBps: 10`), or if it is sent after 10 minutes (`deadlineSeconds: 600`). Both are options.

Amounts come back as `{ raw, formatted, decimals }`: `raw` is the exact integer as a string, so results survive JSON.

## Signing links

Every prepared deposit or withdrawal also has a `signUrl`: a link to Setsuna's signing page, where a person connects their browser wallet (MetaMask, Rabby, Phantom and others), reviews the request and signs it. Build one directly with `signUrl()`:

```ts
import { signUrl } from "@setsunaprotocol/sdk";

signUrl({ vault: "setsUSDC", action: "deposit", amount: "50" });
// https://mcp.setsuna.finance/sign?vault=setsUSDC&action=deposit&amount=50
```

The link carries only the request, never transaction data. The page rebuilds the transactions with this SDK when it is opened, so a link can only deposit into a Setsuna vault or withdraw back to the connected wallet, and it never expires. This is the easiest way for an app or an AI agent to let someone act without ever touching their keys.

## AUSD savings (setsAUSD)

`setsuna.ausd` covers setsAUSD, a wrapper that lets an app save **AUSD** in setsUSDC: AUSD in, AUSD out. Each setsAUSD share is one setsUSDC share, so it earns setsUSDC's rate under setsUSDC's 2,000 USDC cap. Swaps go through one Curve stable pool (about 0.005% each way) and revert if they would return under 99.8% of one-for-one, so a depeg pauses savings instead of filling them badly. `unwrap` always hands back plain setsUSDC.

```ts
const s = await setsuna.ausd.getSavings();          // rate, room, swap cost, peg health
await setsuna.ausd.prepareDeposit("50", owner);     // approve + deposit, the saver pays gas
await setsuna.ausd.prepareWithdraw(owner, { all: true });
```

**Gasless, for apps with a relayer.** The saver only signs; the app's relayer submits and pays the gas.

```ts
// In: an EIP-3009 ReceiveWithAuthorization on AUSD, payable only to `to`, the app's contract,
// which then calls setsAUSD deposit(value, owner) in the saver's name.
const { typedData } = setsuna.ausd.buildGaslessDeposit({ owner, to: appSaver, amount: "50" });

// Out: an EIP-2612 permit on the saver's setsAUSD for the app's contract, which calls
// redeem(shares, owner, owner). The AUSD can only go back to the owner.
const out = await setsuna.ausd.buildGaslessWithdraw({ owner, spender: appSaver, request: { all: true } });
```

Both return EIP-712 typed data for `signTypedData` (viem) or `eth_signTypedData_v4`.

**Sponsored: Setsuna pays the gas.** No relayer of your own needed. The saver signs; you submit to Setsuna's relayer, which carries the call out through `SetsunaAUSDSaver` and pays the MON.

```ts
const save = setsuna.ausd.buildSponsoredDeposit({ owner, amount: "50" });
await setsuna.ausd.submitSponsoredDeposit({ typedData: save.typedData, signature: await signTypedData(save.typedData) });

const out = await setsuna.ausd.buildSponsoredWithdraw({ owner, request: { all: true } });
await setsuna.ausd.submitSponsoredWithdraw({ typedData: out.typedData, signature: await signTypedData(out.typedData) });
```

Sponsored saves start at 1 AUSD; each wallet gets 5 sponsored moves a day, within a daily gas budget. The relayer is at `https://setsuna-relayer-production.up.railway.app` (`/health` shows whether sponsoring is on); pass `relayerUrl` to `createSetsuna` to use another. The relayer only ever calls `save` or `withdraw` on the saver, and the saver only ever pays the signer.

setsAUSD: [`0x551903E3687820A733FBe406DD33Fee8D12bd2F3`](https://monadscan.com/address/0x551903E3687820A733FBe406DD33Fee8D12bd2F3), verified on Sourcify.

## Bridge out of Monad, gas sponsored

Send USDC, or AUSD, from Monad to any chain Circle's CCTP V2 reaches. The user signs once, and nothing else.

- **Monad gas:** Setsuna's relayer pays the MON.
- **AUSD:** swapped to USDC first, on the Curve pool setsAUSD uses. The swap never fills below 99.8% of one-for-one.
- **Destination gas:** on chains marked `gasInUSDC`, Circle delivers the USDC and takes its gas fee from it, so the recipient needs no gas there either.

```ts
import { createSetsuna } from "@setsunaprotocol/sdk";
const setsuna = createSetsuna();

// 1. A chain picker: name, CCTP domain, logo URL, and whether gas is paid in USDC on arrival.
const chains = setsuna.bridge.chains();

// 2. What happens: the swap (AUSD), Circle's fee, what arrives. Show `problems` if !ok.
const quote = await setsuna.bridge.quote({ token: "AUSD", amount: "25", destinationDomain: 6 }); // Base

// 3. One signature (EIP-3009 typed data on the token; no approval, no MON).
const request = setsuna.bridge.buildSponsored({ owner, recipient, quote });
const signature = await walletClient.signTypedData(request.typedData);

// 4. Setsuna's relayer burns it on Monad and pays the gas.
const sent = await setsuna.bridge.submitSponsored({ ...request, signature, app: "your-app" });

// 5. Follow it: pending → attested → delivered (with the destination transaction).
const status = await setsuna.bridge.waitForDelivery(sent.burnTx);
```

**How the money is protected.** The signature is a `ReceiveWithAuthorization` naming [`SetsunaBridgeSponsor`](https://monadscan.com/address/0xeabF1Aa629a686C9E5862b316F954bF2C0b68DBe). Only that contract can use it. Its nonce is a hash of every bridge detail: destination, recipient, fee ceiling, forwarding and swap minimum. Neither the relayer nor anyone else can change where the money goes; a changed detail makes the signature invalid. Each signature works once and expires after 10 minutes by default. The contract has no owner and holds nothing between transfers.

**Fees.** Circle keeps the whole fee ceiling (`quote.maxFee`), which the quote sets at Circle's delivery fee plus 5%, so `quote.receive` is what arrives. Today that's about $0.06 to Base, Arbitrum or OP, $0.12 to Solana and $1.05 to Ethereum. Setsuna charges nothing.

**Recipients.** EVM chains take an address. Solana takes the wallet address, and the SDK works out its USDC token account, which is where Circle mints. On chains where `gasInUSDC` is false (Sui, Aptos, Cronos, Plasma, X Layer, Injective, Morph, Pharos), the USDC is burned on Monad. The recipient then claims it on that chain with their own gas; `getStatus` returns the `message` and `attestation` for that claim.

**Limits.** At least 1 USDC or AUSD; 10 sponsored bridges per wallet per day, within a daily gas budget. The relayer's `/health` shows whether bridging is on. Pass `app` to label your transfers on [stats.setsuna.finance](https://stats.setsuna.finance).

`setsuna.bridge.balances(owner)` returns the wallet's USDC and AUSD on Monad.

## The vaults

| Vault | Asset | Markets | Cap |
|---|---|---|---|
| setsUSDC `0x0a531817EEFB7b1FFD7c511c0817F58ac343CC67` | USDC | Aave, Morpho, Euler, Neverland, Curvance | 2,000 USDC |
| setsMON `0x408A8C85a3e15446885ADCc954575e7a918dFd33` | MON (WMON) | Neverland, Euler | 25,000 MON |

The contracts are immutable and verified on Sourcify. Nobody can choose the weights: the contract splits money between eligible markets by their rates, keeps about 10% as cash, holds at most 60% in any market, and moves at most 10% per rebalance. A guardian can only pause new deposits or disable a market.

Setsuna's contracts are unaudited and the vaults are capped. Deposit only what you can afford to lose.

## Tests

```sh
npm test
```

The tests read Monad mainnet and simulate the prepared transactions with `eth_call`. They send nothing. `RUN_FORK=1 npm test` also runs a sponsored bridge end to end, from quote to signature to Setsuna's relayer to burn, on a local fork of Monad. It needs `anvil` and `npm install` in `relayer/`.
