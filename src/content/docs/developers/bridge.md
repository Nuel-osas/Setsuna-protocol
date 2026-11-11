Let your users send USDC, or AUSD, from Monad to any chain Circle's CCTP V2 reaches. They sign once; Setsuna's relayer pays the Monad gas, and on most chains Circle delivers the USDC and takes its gas from it, so they need no gas there either. Nothing to deploy and no MON to hold.

## Contracts

| Contract | Address on Monad mainnet (143) |
| --- | --- |
| SetsunaBridgeSponsor | `0xeabF1Aa629a686C9E5862b316F954bF2C0b68DBe` |
| USDC | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` |
| AUSD | `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a` |
| Curve AUSD/USDC/USDT0 pool | `0x942644106B073E30D72c2C5D7529D5C296ea91ab` |
| Circle TokenMessengerV2 | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` |

SetsunaBridgeSponsor has no owner, admin or fee, holds nothing between transfers and is verified on [Sourcify](https://sourcify.dev/) (exact match). Monad's CCTP domain is 15.

## How it works

1. The user signs an EIP-3009 `ReceiveWithAuthorization` on USDC or AUSD, with the sponsor as recipient. No approval, no MON.
2. Setsuna's relayer submits it and pays the gas.
3. For AUSD, the sponsor swaps it to USDC on the Curve pool setsAUSD uses. The swap never fills below 99.8% of one-for-one.
4. The sponsor burns the USDC through Circle's CCTP V2 for the destination and recipient the user signed.
5. Circle attests the burn and, on chains it delivers to, mints to the recipient and takes its fee in USDC.

The signature's nonce is a hash of every bridge detail: destination, recipient, fee ceiling, finality, forwarding and swap minimum. Neither the relayer nor anyone else can change where the money goes; a changed detail makes the signature invalid. Only the sponsor can use it, it works once, and it expires after 10 minutes by default.

## Install the SDK

```sh
npm install @setsunaprotocol/sdk
```

```ts
import { createSetsuna } from "@setsunaprotocol/sdk";

const setsuna = createSetsuna(); // Monad mainnet

// A chain picker: name, CCTP domain, logo URL, and whether Circle delivers (gasInUSDC).
const chains = setsuna.bridge.chains();

// What happens: the swap (AUSD), Circle's fee, what arrives. Show `problems` when !ok.
const quote = await setsuna.bridge.quote({ token: "AUSD", amount: "25", destinationDomain: 6 }); // Base

// One signature.
const request = setsuna.bridge.buildSponsored({ owner: user, recipient, quote });
const signature = await wallet.signTypedData(request.typedData);

// Setsuna's relayer burns it on Monad and pays the gas.
const sent = await setsuna.bridge.submitSponsored({ ...request, signature, app: "your-app" });

// Follow it: pending, attested, delivered (with the destination transaction).
const status = await setsuna.bridge.waitForDelivery(sent.burnTx);
```

The typed data works with viem's `signTypedData`, ethers' `signTypedData` or a wallet's `eth_signTypedData_v4`. `setsuna.bridge.balances(user)` returns the wallet's USDC and AUSD on Monad. `setsuna.bridge.getStatus(burnTx)` checks once instead of waiting.

## Destinations

**Circle delivers, gas paid in USDC (19 chains):** Ethereum, Base, Arbitrum, Solana, OP Mainnet, Polygon PoS, Avalanche, Unichain, Linea, HyperEVM, World Chain, Sonic, Sei, Ink, Arc, Codex, Plume, XDC and Edge.

**The recipient claims (8 chains):** Sui, Aptos, Cronos, Plasma, X Layer, Injective, Morph and Pharos. Circle doesn't deliver to these from Monad, so the USDC is burned on Monad and the recipient mints it on the destination with their own gas. `getStatus` returns the `message` and `attestation` for that claim, and [bridge.setsuna.finance](https://bridge.setsuna.finance) can finish it from the burn's transaction hash.

**Recipients.** EVM chains take an address. Solana takes the wallet address; the SDK works out its USDC token account, which is where Circle mints. Sui and Aptos take a 32-byte address.

## Fees

Setsuna charges nothing. Circle keeps the whole fee ceiling (`quote.maxFee`), which the quote sets at Circle's delivery fee plus 5%, so `quote.receive` is what arrives. Circle's fee moves with the destination's gas price. Quoted for 10 USDC on 11 November 2026:

| Destination | Circle's fee | Arrives |
| --- | --- | --- |
| OP Mainnet | 0.053 USDC | 9.947 USDC |
| Base | 0.056 USDC | 9.944 USDC |
| Arbitrum | 0.075 USDC | 9.925 USDC |
| Solana | 0.115 USDC | 9.885 USDC |
| Ethereum | 0.913 USDC | 9.087 USDC |

On chains where the recipient claims, Circle's fee is zero and the recipient pays that chain's gas. AUSD also pays the Curve swap, which the quote includes.

## Relayer API

Base URL: `https://setsuna-relayer-production.up.railway.app`. The SDK calls it for you; the raw API is below for other languages.

| Endpoint | Body |
| --- | --- |
| `POST /v1/bridge` | `token` (`"USDC"` or `"AUSD"`), `transfer` (`owner`, `value`, `validAfter`, `validBefore`, `salt`, `destinationDomain`, `mintRecipient`, `maxFee`, `minFinalityThreshold`, `forward`, `minUsdcOut`), `signature`, and optionally `app` |
| `GET /health` | Whether sponsored bridging is on (`bridging`), and today's remaining budget (`bridgeBudgetLeftTodayMON`) |

A success returns `{ txHash, block, gasPaidMON, burned, sourceDomain, destinationDomain }`, where `burned` is the USDC burned, in base units. A failure returns `{ error }` in plain English, for example when the fee ceiling is out of date or the wallet holds too little.

## Limits

So the sponsorship can't be drained, or a user overcharged:

- Bridges from **1 USDC or AUSD**.
- **10** sponsored bridges per wallet per day.
- A daily gas budget. When it's used up the relayer answers `503`; nothing has moved and the bridge can be retried later.
- Every request is simulated first, so a bad, replayed or expired signature is refused and costs nothing.
- The fee ceiling must sit between 95% and about twice Circle's live delivery fee. Circle keeps all of it, so a stale or mistyped ceiling is refused.
- Forwarding is refused to chains Circle doesn't deliver to.

Pass `app` to label your transfers in Setsuna's usage record.

## Running your own relayer

Anyone can call SetsunaBridgeSponsor directly and pay the gas: `bridgeUSDC(transfer, v, r, s)` and `bridgeAUSD(transfer, v, r, s)`, with `authorizationNonce(token, transfer)` giving the nonce to sign. Allow about **500,000 gas** for USDC and **700,000** for AUSD, which includes the swap.

## Proof on mainnet

A wallet signed and Setsuna's relayer paid the gas; Circle delivered on Base:

| Transfer | Burn on Monad | Delivered on Base |
| --- | --- | --- |
| 0.5 USDC | [`0xd40fb085…`](https://monadscan.com/tx/0xd40fb085d1471f31dce30ade458d19d05aadef2970d51240973e41854fa58c88) | [`0xd314d023…`](https://basescan.org/tx/0xd314d02372dd95dae79036e12aa4c187522cfeb506042ac46844155e31295b96) |
| 0.79 AUSD, swapped to 0.789869 USDC | [`0x12e3b456…`](https://monadscan.com/tx/0x12e3b45659143c2375c6d7fbaf92e597580b2a74dad091292a5d754a0f831080) | [`0xc6f33898…`](https://basescan.org/tx/0xc6f33898a48cfd951f1fe46884bcdfd26091b2bfe5da8e4b3a142336a3a67af5) |

These ran before the 1 USDC minimum was set. Package: [`@setsunaprotocol/sdk` on npm](https://www.npmjs.com/package/@setsunaprotocol/sdk).

SetsunaBridgeSponsor is unaudited. Tell your users to start with small amounts.
