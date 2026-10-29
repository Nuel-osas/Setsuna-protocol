# @setsunaprotocol/sdk

Read Setsuna's rule-bound Earn vaults on Monad, and prepare deposits and withdrawals for a wallet to sign.

The SDK never holds a key and never sends a transaction. Reads come straight from the contracts on Monad mainnet. Prepared transactions are plain `{ to, data, value }` objects that your user's wallet signs.

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

Sponsored saves start at 1 AUSD; each wallet gets 5 sponsored moves a day, within a daily gas budget. The relayer only ever calls `save` or `withdraw` on the saver, and the saver only ever pays the signer.

setsAUSD: [`0x551903E3687820A733FBe406DD33Fee8D12bd2F3`](https://monadscan.com/address/0x551903E3687820A733FBe406DD33Fee8D12bd2F3), verified on Sourcify.

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

The tests read Monad mainnet and simulate the prepared transactions with `eth_call`. They send nothing.
