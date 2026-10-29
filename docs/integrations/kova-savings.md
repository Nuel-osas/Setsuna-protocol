# Kova Savings with setsAUSD

How to switch on Kova's Savings with Setsuna, using Kova's existing `KovaSaver`, API and app. AUSD in, AUSD out, and savers only sign.

## What setsAUSD is

| | |
|---|---|
| Contract | [`0x551903E3687820A733FBe406DD33Fee8D12bd2F3`](https://monadscan.com/address/0x551903E3687820A733FBe406DD33Fee8D12bd2F3) on Monad mainnet (chain 143), source verified on Sourcify (exact match) |
| Asset | AUSD [`0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a`](https://monadscan.com/address/0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a) |
| Shares | "Setsuna AUSD Savings" (`setsAUSD`), **12 decimals**, EIP-2612 permit with EIP-712 domain name `Setsuna AUSD Savings`, version `1` |
| Where the money sits | [setsUSDC](https://monadscan.com/address/0x0a531817EEFB7b1FFD7c511c0817F58ac343CC67), Setsuna's rule-bound USDC vault across Aave, Morpho, Euler, Neverland and Curvance. One setsAUSD share is one setsUSDC share. |
| Swap | AUSD↔USDC on Curve's stable pool [`0x9426…91ab`](https://monadscan.com/address/0x942644106B073E30D72c2C5D7529D5C296ea91ab), about 0.005% each way. Any swap returning under 99.8% of one-for-one reverts. |
| Admin | None. No owner, no fee of its own, no upgrade. |

It is a standard ERC-4626 for everything Kova uses: `asset()`, `name()`, `balanceOf`, `nonces`, `convertToAssets`, `deposit(assets, receiver)`, `redeem(shares, receiver, owner)` and `permit`. `mint` and `withdraw` are not offered (the swap makes exact-output amounts unknowable), and Kova doesn't use them.

## Switching it on

1. **Deploy a KovaSaver for setsAUSD on mainnet**, with your existing script:

   ```sh
   SAVINGS_VAULT=0x551903E3687820A733FBe406DD33Fee8D12bd2F3 \
     forge script script/DeploySavings.s.sol --rpc-url monad --private-key $KEY --broadcast
   ```

   The constructor reads `asset()` (AUSD) and approves the vault once. Nothing else to configure.

2. **Set the API environment**: `KOVA_SAVINGS_VAULT=0x551903E3687820A733FBe406DD33Fee8D12bd2F3` and `KOVA_SAVER=<the new KovaSaver>`.

3. **Raise the relayer gas limit for savings.** This is the one code change. `saveIn` and `saveOut` in `apps/api/src/services/money.ts` call `sendFromRelayer(helper, data, { maxGas: 400_000n })`. setsAUSD needs more, because setsUSDC values all five markets on every move and the swap runs in the same transaction. Measured on mainnet:

   | Step | Gas |
   |---|---|
   | AUSD `receiveWithAuthorization` | ~96k |
   | setsAUSD deposit (swap + setsUSDC deposit) | ~1.14M |
   | setsAUSD permit | ~90k |
   | setsAUSD redeem (setsUSDC redeem + swap) | ~1.70M |

   So `save` is about 1.24M and `withdraw` about 1.79M. Use `maxGas: 2_200_000n` for both.

That's all. The app's Savings screen, the wallet's signatures (`receiveAuthorizationTypedData` naming KovaSaver, `vaultPermitTypedData` with the vault's `name()` and version `1`) and the balance maths work as they are.

## Behaviour to expect

- **Cap.** setsUSDC holds at most 2,000 USDC in total, shared with every Setsuna depositor; about 1,979 is free today. When it's full, `maxDeposit` returns 0 and a save reverts. Reading `maxDeposit(address)` before showing the Save button avoids a failed relayer transaction.
- **Depeg pause.** If AUSD and USDC move more than 0.2% apart in the pool, saves and withdrawals revert until the peg returns. The money stays safe in setsUSDC, and `unwrap(shares, receiver, owner)` always returns plain setsUSDC shares.
- **Withdrawable now.** setsUSDC keeps about 10% in cash. A very large withdrawal can exceed what the markets can pay out at that moment; `maxRedeem(owner)` says how many shares can leave right now.
- **"Earned".** Kova computes balance with `convertToAssets`, which counts setsUSDC's USDC one-for-one as AUSD. The AUSD actually received on the way out is that minus the swap, about 0.005%. On $100 that's half a cent.
- **Rate.** setsUSDC's net APR has been about 4.5% to 6% this week, after Setsuna's 2% fee on yield. It is a variable lending rate, not a promise.

## Proof on mainnet

A fresh wallet holding only AUSD, with no MON at any point, saved and withdrew while another wallet relayed and paid gas, using the published `@setsunaprotocol/sdk@0.2.0` signatures:

| Step | Transaction |
|---|---|
| Saver's signed AUSD transfer, relayed | [`0x72755c2b…`](https://monadscan.com/tx/0x72755c2bd4d1195e972db72f9f1393fc9850b3cda4b904acc3936299b01eca67) |
| 1 AUSD saved into setsAUSD in the saver's name | [`0xb5e40415…`](https://monadscan.com/tx/0xb5e40415ae8687081df364a7f937eb242686f405fe750a7b5264b716116bd8d2) |
| Saver's permit, relayed | [`0x97597a07…`](https://monadscan.com/tx/0x97597a0794cb77559ad96b06c03990c699beaa1561e00a6f8666d1b85d6d24cf) |
| Redeemed: 0.999898 AUSD back to the saver | [`0x0af8499d…`](https://monadscan.com/tx/0x0af8499d8e5d152755322bdd751d85d4e9b20fa539a283572f362b115b430b50) |

Round trip: 0.0102%.

## Setsuna pays the gas (optional)

You don't need your own relayer. Setsuna runs one that submits a saver's signed save or withdrawal through [`SetsunaAUSDSaver`](https://monadscan.com/address/0x4cbf5688cc98BCb76CcAB602AFc7b6fD57863cC3) and pays the MON. With it, Kova needs no savings contract and no gas budget of its own: the wallet signs, and you post the signature with the SDK (`buildSponsoredDeposit` / `submitSponsoredDeposit`, `buildSponsoredWithdraw` / `submitSponsoredWithdraw`), or straight to `https://setsuna-relayer-production.up.railway.app/v1/ausd/save` and `/v1/ausd/withdraw`. `https://setsuna-relayer-production.up.railway.app/health` shows whether sponsoring is on and today's remaining budget.

Limits keep it from being drained: saves from 1 AUSD, 5 sponsored moves per wallet per day, a daily gas budget, and every request is simulated first, so a bad signature costs nothing. The relayer can't do anything but `save` and `withdraw`, and the saver contract only ever pays the signer. Tested live on mainnet: a wallet saved and withdrew while its MON balance never moved.

## Using the SDK

The SDK is optional for Kova, whose own code already builds the signatures, but it's the quickest way to show the rate, the room under the cap and each saver's balance, or to build the same signatures elsewhere.

```sh
npm install @setsunaprotocol/sdk
```

```ts
import { createSetsuna } from "@setsunaprotocol/sdk";

const setsuna = createSetsuna(); // Monad mainnet, read-only, no key

// Rate, room under the cap, swap cost and peg health
const savings = await setsuna.ausd.getSavings();
// { netAprPct, capRemaining, roundTripCostPct, pegOk, ... }

// A saver's position
const position = await setsuna.ausd.getPosition(saver);
// { shares, value (in AUSD), redeemableShares, walletAUSD }

// In: the saver signs an AUSD ReceiveWithAuthorization naming your saving contract
const { typedData: inData } = setsuna.ausd.buildGaslessDeposit({
  owner: saver,
  to: kovaSaver,
  amount: "50",
});
const inSignature = await wallet.signTypedData(inData);
// your relayer calls KovaSaver.save(...) with inData.message and the signature

// Out: the saver signs a permit on their setsAUSD for your saving contract
const out = await setsuna.ausd.buildGaslessWithdraw({
  owner: saver,
  spender: kovaSaver,
  request: { all: true }, // or { amount: "10" } in AUSD, or { shares: "…" }
});
const outSignature = await wallet.signTypedData(out.typedData);
// your relayer calls KovaSaver.withdraw(...) with out.typedData.message and the signature
```

Both payloads are standard EIP-712 typed data, so they work with viem's `signTypedData`, ethers' `signTypedData`, or a wallet's `eth_signTypedData_v4`.

If the saver pays their own gas instead, `setsuna.ausd.prepareDeposit("50", saver)` and `setsuna.ausd.prepareWithdraw(saver, { all: true })` return the unsigned transactions in order (an exact AUSD approval when needed, then the deposit).

Package: [`@setsunaprotocol/sdk` on npm](https://www.npmjs.com/package/@setsunaprotocol/sdk) (MIT). Source: [`packages/sdk`](../../packages/sdk).

## Risk

Setsuna's contracts are unaudited and the vaults are capped, so this is a beta. If one of setsUSDC's lending markets fails to report its balance, setsUSDC pauses withdrawals until it does, by design: it never values a position it can't read. Savers should be told savings carry this risk.

Source: [`contracts/src/earn/SetsunaAUSDWrapper.sol`](../../contracts/src/earn/SetsunaAUSDWrapper.sol), mainnet-fork tests in [`contracts/test/SetsunaAUSDWrapperFork.t.sol`](../../contracts/test/SetsunaAUSDWrapperFork.t.sol).
