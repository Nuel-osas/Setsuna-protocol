Offer AUSD savings in your own app: your users sign, Setsuna's relayer pays the gas, and their AUSD earns the setsUSDC rate. Nothing to deploy and no MON to hold.

## Contracts

| Contract | Address on Monad mainnet (143) |
| --- | --- |
| setsAUSD (SetsunaAUSDWrapper) | `0x551903E3687820A733FBe406DD33Fee8D12bd2F3` |
| SetsunaAUSDSaver | `0x4cbf5688cc98BCb76CcAB602AFc7b6fD57863cC3` |
| AUSD | `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a` |
| Curve AUSD/USDC/USDT0 pool | `0x942644106B073E30D72c2C5D7529D5C296ea91ab` |

Both Setsuna contracts have no owner and are verified on [Sourcify](https://sourcify.dev/) (exact match).

setsAUSD is a standard ERC-4626 for `asset()`, `balanceOf`, `convertToAssets`, `previewDeposit`, `previewRedeem`, `maxDeposit`, `maxRedeem`, `deposit(assets, receiver)` and `redeem(shares, receiver, owner)`. `mint` and `withdraw` revert. Its permit uses the EIP-712 domain name `Setsuna AUSD Savings`, version `1`. AUSD's signed transfers use the domain name `Agora Dollar`, version `1`.

## Install the SDK

```sh
npm install @setsunaprotocol/sdk
```

```ts
import { createSetsuna } from "@setsunaprotocol/sdk";

const setsuna = createSetsuna(); // Monad mainnet, read-only, no key

const savings = await setsuna.ausd.getSavings();
// { netAprPct, capRemaining, roundTripCostPct, pegOk, ... }

const position = await setsuna.ausd.getPosition(user);
// { shares, value (in AUSD), redeemableShares, walletAUSD }
```

## Gas-free deposit and withdrawal

The user signs EIP-712 typed data; the SDK sends it to Setsuna's relayer, which waits for confirmation and returns the transaction hash.

```ts
// Save 50 AUSD
const save = setsuna.ausd.buildSponsoredDeposit({ owner: user, amount: "50" });
const saved = await setsuna.ausd.submitSponsoredDeposit({
  typedData: save.typedData,
  signature: await wallet.signTypedData(save.typedData),
});

// Withdraw everything as AUSD
const exit = await setsuna.ausd.buildSponsoredWithdraw({ owner: user, request: { all: true } });
const withdrawn = await setsuna.ausd.submitSponsoredWithdraw({
  typedData: exit.typedData,
  signature: await wallet.signTypedData(exit.typedData),
});
```

`request` also takes `{ amount: "10" }` in AUSD or `{ shares: "…" }`. The typed data works with viem's `signTypedData`, ethers' `signTypedData` or a wallet's `eth_signTypedData_v4`.

If your users pay their own gas instead, `setsuna.ausd.prepareDeposit("50", user)` and `setsuna.ausd.prepareWithdraw(user, { all: true })` return the unsigned transactions in order: an exact AUSD approval when needed, then the deposit.

## Relayer API

Base URL: `https://setsuna-relayer-production.up.railway.app`. The SDK calls it for you; the raw API is below for other languages.

| Endpoint | Body |
| --- | --- |
| `POST /v1/ausd/save` | `owner`, `value`, `validAfter`, `validBefore`, `nonce`, `signature` (the user's AUSD `ReceiveWithAuthorization` with `to` = the saver) |
| `POST /v1/ausd/withdraw` | `owner`, `shares`, `deadline`, `signature` (the user's setsAUSD `Permit` with `spender` = the saver) |
| `GET /health` | Whether sponsoring is on, and today's remaining budget |

A success returns `{ txHash }`. A failure returns `{ error }` in plain English, for example when the wallet holds too little AUSD or the signature has expired.

## Limits

So the sponsorship can't be drained:

- Saves from **1 AUSD**; withdrawals from **0.5 AUSD**, or the whole position.
- **5** sponsored moves per wallet per day.
- A daily gas budget. When it's used up the relayer answers `503`; savings are safe and the move can be retried later.
- Every request is simulated first, so a bad, replayed or expired signature is refused and costs nothing.

The relayer only ever calls `save` or `withdraw` on SetsunaAUSDSaver, and the saver only ever pays the signer.

## Running your own relayer

Anyone can call SetsunaAUSDSaver directly and pay the gas: `save(owner, value, validAfter, validBefore, nonce, v, r, s, minShares)` and `withdraw(owner, shares, deadline, v, r, s, minAssets)`. Allow about **1.3M gas** for a save and **1.8M** for a withdrawal: setsUSDC values all five lending markets on every move and the swap runs in the same transaction.

## Proof on mainnet

A wallet holding no MON saved 1 AUSD and withdrew everything, with Setsuna's relayer paying:

| Step | Transaction |
| --- | --- |
| 1 AUSD saved | [`0xc3b31647…`](https://monadscan.com/tx/0xc3b31647a2ae677a8421161fbf9e6d3d13fdde68c356bf1e5037030c62870f73) |
| Everything withdrawn as AUSD | [`0x7785e96d…`](https://monadscan.com/tx/0x7785e96dcccf27c18383a12d10b4393f25f63df36f1f6d288e8df4dac2d23ac3) |

How the wrapper works for savers: [AUSD savings](/docs/how-it-works/ausd-savings/). Package: [`@setsunaprotocol/sdk` on npm](https://www.npmjs.com/package/@setsunaprotocol/sdk).

setsAUSD is unaudited and part of a capped beta. Tell your users their savings carry setsUSDC's risks plus AUSD's peg.
