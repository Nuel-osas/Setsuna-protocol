# Kova Bridge with Setsuna

How to let Kova users send AUSD or USDC from Monad to another chain, with no gas anywhere:

1. The user signs once.
2. Setsuna pays the Monad gas.
3. Circle delivers on the destination and takes its fee from the USDC.

Kova deploys nothing and holds no MON.

## What happens

```
User's AUSD on Monad
   │ 1 signature (EIP-3009, no approval, no MON)
   ▼
Setsuna relayer ──pays MON──► SetsunaBridgeSponsor
                                 │ swap AUSD → USDC on Curve (never below 99.8%)
                                 │ burn USDC through Circle CCTP V2
                                 ▼
                      Circle Forwarding Service
                                 │ mints on the destination, fee taken in USDC
                                 ▼
                      USDC in the recipient's wallet on Base / Arbitrum / Solana / …
```

| | |
|---|---|
| Contract | [`SetsunaBridgeSponsor`](https://monadscan.com/address/0xeabF1Aa629a686C9E5862b316F954bF2C0b68DBe) `0xeabF1Aa629a686C9E5862b316F954bF2C0b68DBe` on Monad mainnet (chain 143). Source verified on Sourcify (exact match). |
| Tokens in | AUSD [`0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a`](https://monadscan.com/address/0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a) or USDC [`0x754704Bc059F8C67012fEd69BC8A327a5aafb603`](https://monadscan.com/address/0x754704Bc059F8C67012fEd69BC8A327a5aafb603) |
| Swap | AUSD → USDC on the Curve pool setsAUSD uses, [`0x9426…91ab`](https://monadscan.com/address/0x942644106B073E30D72c2C5D7529D5C296ea91ab), about 0.02% today (25 AUSD gave 24.9958 USDC). A swap under 99.8% of one-for-one reverts. |
| Bridge | Circle CCTP V2 (TokenMessengerV2 `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d`), with Circle's Forwarding Service |
| Relayer | `https://setsuna-relayer-production.up.railway.app`, `POST /v1/bridge` (CORS open) |
| Admin | None. No owner, no fee, no upgrade. Holds nothing between transfers. |

**What Kova's users pay:** nothing in gas. Circle's delivery fee comes out of the USDC on arrival: about $0.06 to Base, Arbitrum or OP, $0.12 to Solana, and $1.05 to Ethereum. Setsuna charges nothing.

## Switching it on (with the SDK, recommended)

```sh
npm install @setsunaprotocol/sdk viem
```

```ts
import { createSetsuna } from "@setsunaprotocol/sdk";

const setsuna = createSetsuna(); // Monad mainnet, no key

// 1. The chain dropdown.
const chains = setsuna.bridge.chains();
// [{ domain: 6, name: "Base", ecosystem: "evm", chainId: 8453,
//    icon: "https://bridge.setsuna.finance/icons/base.svg", gasInUSDC: true }, ...]

// 2. The quote, as the user types an amount and picks a chain.
const quote = await setsuna.bridge.quote({ token: "AUSD", amount: "25", destinationDomain: 6 });
// quote.ok, quote.problems, quote.receive.formatted ("24.937811"), quote.maxFee.formatted ("0.057981")

// 3. What the user signs. No approval, no MON.
const request = setsuna.bridge.buildSponsored({ owner: wallet, recipient: wallet, quote });
const signature = await walletClient.signTypedData({ account: wallet, ...request.typedData });

// 4. Setsuna's relayer burns it on Monad and pays the gas. It answers once the burn is confirmed.
const sent = await setsuna.bridge.submitSponsored({ ...request, signature, app: "kova" });
// sent.burnTx (Monad), sent.burned (USDC that went into the bridge)

// 5. Delivery, usually within a couple of minutes.
const status = await setsuna.bridge.waitForDelivery(sent.burnTx);
// status.state: "pending" | "attested" | "delivered", status.destinationTx (the mint on Base)
```

`setsuna.bridge.balances(wallet)` returns the wallet's AUSD and USDC on Monad, for the "max" button.

**Signing with other wallet libraries.** `request.typedData` is standard EIP-712 typed data with bigint values:

| Library | Call |
|---|---|
| viem | `walletClient.signTypedData({ account, ...request.typedData })` |
| wagmi | `signTypedDataAsync(request.typedData)` |
| ethers v6 | `signer.signTypedData(request.typedData.domain, request.typedData.types, request.typedData.message)` |
| Privy / raw `eth_signTypedData_v4` | Add `EIP712Domain` to `types` and send bigints as decimal strings |

Pass `app: "kova"` so Kova's volume appears on [stats.setsuna.finance](https://stats.setsuna.finance) as `sponsored:kova`, credited to each user's own wallet.

## Switching it on without the SDK

If Kova's API builds its own signatures, as it does for savings, this is the whole protocol.

**1. Quote Circle's fee.** `GET https://iris-api.circle.com/v2/burn/USDC/fees/15/{destinationDomain}?forward=true`. Take the entry with `finalityThreshold: 2000`; its `forwardFee.med` is the delivery fee in USDC base units. Set `maxFee = ceil(med × 1.05)`. Circle keeps the whole `maxFee`, so don't add more margin than that. For AUSD, read `get_dy(0, 1, amount)` on the Curve pool and set `minUsdcOut` slightly under it, never below `amount × 0.998`.

**2. Build the transfer:**

| Field | Value |
|---|---|
| `owner` | the user's address |
| `value` | amount in base units (6 decimals for both AUSD and USDC) |
| `validAfter` | `0` |
| `validBefore` | now + 600 (seconds) |
| `salt` | 32 random bytes |
| `destinationDomain` | Circle domain (Base 6, Arbitrum 3, OP 2, Solana 5, Ethereum 0, …) |
| `mintRecipient` | the recipient as bytes32. EVM: the address left-padded. Solana: the wallet's **USDC token account** (ATA), not the wallet. |
| `maxFee` | from step 1 |
| `minFinalityThreshold` | `2000` |
| `forward` | `true` (Circle delivers and takes the gas in USDC) |
| `minUsdcOut` | AUSD: from step 1. USDC: `0` |

**3. The nonce.** It commits the signature to every field, so nobody can change the destination or recipient:

```
nonce = keccak256(abi.encode(
  keccak256("SetsunaBridge(address sponsor,uint256 chainId,address token,uint32 destinationDomain,bytes32 mintRecipient,uint256 maxFee,uint32 minFinalityThreshold,bool forward,uint256 minUsdcOut,bytes32 salt)"),
  0xeabF1Aa629a686C9E5862b316F954bF2C0b68DBe,  // sponsor
  143,                                          // chainId
  token,                                        // AUSD or USDC address
  destinationDomain, mintRecipient, maxFee, minFinalityThreshold, forward, minUsdcOut, salt
))
```

The contract's `authorizationNonce(token, transfer)` view returns the same value, so it can be checked.

**4. The signature.** The token's `ReceiveWithAuthorization`, the same type Kova's savings already uses:

```
domain: AUSD → { name: "Agora Dollar", version: "1", chainId: 143, verifyingContract: AUSD }
        USDC → { name: "USDC",         version: "2", chainId: 143, verifyingContract: USDC }
ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)
message: { from: owner, to: 0xeabF1Aa629a686C9E5862b316F954bF2C0b68DBe, value, validAfter, validBefore, nonce }
```

AUSD's EIP-712 name is "Agora Dollar", even though its `name()` returns "AUSD".

**5. Send it to Setsuna's relayer:**

```ts
const res = await fetch("https://setsuna-relayer-production.up.railway.app/v1/bridge", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    token: "AUSD", // or "USDC"
    transfer: { owner, value: "25000000", validAfter: "0", validBefore: "1793990000", salt,
                destinationDomain: 6, mintRecipient, maxFee: "58000", minFinalityThreshold: 2000,
                forward: true, minUsdcOut: "24970000" },
    signature, // 65-byte hex
    app: "kova",
  }),
});
const out = await res.json();
// 200: { txHash, block, gasPaidMON, burned, destinationDomain, sourceDomain: 15 }
// otherwise: { error: "plain-English reason" }
```

**6. Follow delivery.** `GET https://iris-api.circle.com/v2/messages/15?transactionHash={txHash}`. `status: "complete"` means attested, and `forwardTxHash` is the mint on the destination.

## Chains

The user can choose any of 27 chains from Monad.

**Gas paid in USDC on arrival (19 chains):** Ethereum, Base, Arbitrum, Solana, OP Mainnet, Polygon PoS, Avalanche, Unichain, Linea, HyperEVM, World Chain, Sonic, Sei, Ink, Arc, Codex, Plume, XDC, Edge.

**The recipient claims with their own gas (8 chains):** Sui, Aptos, Cronos, Plasma, X Layer, Injective, Morph, Pharos. Circle doesn't deliver on these. The USDC is burned on Monad, and the recipient claims it on that chain; `getStatus` returns the `message` and `attestation` they need. Kova may prefer to leave these out of its dropdown: show only `chains().filter(c => c.gasInUSDC)`.

## Behaviour to expect

- **Limits**, so the sponsorship can't be drained:
  - at least 1 AUSD or USDC;
  - 10 sponsored bridges per wallet per day;
  - a daily Monad gas budget. When it's used up, the relayer answers `503`; nothing is lost, and the bridge can be retried later.

  `GET /health` shows `bridging: true` and today's remaining budget.
- **Every request is simulated first.** A bad, replayed, expired or tampered signature is refused with a plain-English `error` and costs nothing. Messages Kova may show:
  - "Sponsored bridges start at 1 USDC or AUSD."
  - "This wallet holds 3 AUSD, less than the 25 AUSD it's trying to bridge."
  - "The signature doesn't match this request, or it has expired."
  - "The fee ceiling is below Circle's delivery fee … Get a fresh quote." Circle's fee moves a little: quote again and ask for a new signature.
  - "The AUSD swap would return less than the signed minimum. Get a fresh quote."
  - "This wallet has used today's sponsored bridges. Try again tomorrow."
- **Quote just before signing.** The signature is valid for 10 minutes, but Circle's fee and the pool move. The relayer accepts a fee ceiling down to 5% under Circle's current fee, which the 5% margin in the quote covers.
- **Depeg pause.** If AUSD trades under 99.8% of USDC, AUSD bridges revert and nothing moves. `quote` reports it in `problems`.
- **Wallets.**
  - **Normal wallets** (Privy embedded, MetaMask, Rabby): work. Proven on mainnet.
  - **EIP-7702 smart accounts** (MetaMask's): work. Checked on a mainnet fork for both AUSD and USDC.
  - **Pure contract wallets with no owner key** (Safe, ERC-4337 accounts): not supported yet.

## Proof on mainnet

A test wallet that only signed, and spent 0 MON, bridged to its own address on Base. Setsuna's relayer key submitted and paid the Monad gas:

| | Burn on Monad | Delivered on Base | Relayer paid | Circle kept |
|---|---|---|---|---|
| 0.5 USDC | [`0xd40fb085…`](https://monadscan.com/tx/0xd40fb085d1471f31dce30ade458d19d05aadef2970d51240973e41854fa58c88) | [`0xd314d023…`](https://basescan.org/tx/0xd314d02372dd95dae79036e12aa4c187522cfeb506042ac46844155e31295b96) | 0.051 MON | 0.0688 USDC |
| 0.79 AUSD → 0.789869 USDC | [`0x12e3b456…`](https://monadscan.com/tx/0x12e3b45659143c2375c6d7fbaf92e597580b2a74dad091292a5d754a0f831080) | [`0xc6f33898…`](https://basescan.org/tx/0xc6f33898a48cfd951f1fe46884bcdfd26091b2bfe5da8e4b3a142336a3a67af5) | 0.070 MON | 0.0699 USDC |

1.151162 USDC arrived on Base. Both were delivered by Circle within a couple of minutes of the burn.

## Safety

- **The signature is the whole permission.** It's a one-time `ReceiveWithAuthorization` naming the sponsor contract, which is the only thing that can use it. Its nonce covers every detail (destination, recipient, fee ceiling, forwarding, swap minimum), so neither Setsuna's relayer nor anyone else can change where the money goes. A changed detail makes the signature invalid.
- **No approvals are left behind.** Each signature works once and expires.
- **Unaudited.** Setsuna's contracts, this one included, are unaudited. The bridge itself is Circle's CCTP V2, and the sponsor holds nothing between transfers.

Questions: [@Setsunaprotocol](https://x.com/Setsunaprotocol) · source: [`contracts/src/bridge/SetsunaBridgeSponsor.sol`](https://github.com/Nuel-osas/Setsuna-protocol/blob/main/contracts/src/bridge/SetsunaBridgeSponsor.sol) · SDK: [`@setsunaprotocol/sdk`](https://www.npmjs.com/package/@setsunaprotocol/sdk)
