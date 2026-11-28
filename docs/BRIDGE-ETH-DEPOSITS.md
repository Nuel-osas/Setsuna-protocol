# ETH deposits from Ethereum on bridge.setsuna.finance

Proposal, 11 November 2026. Not built.

bridge.setsuna.finance moves USDC with Circle's CCTP. This adds one more route: **ETH from
Ethereum to an Ethereum rollup, through that rollup's own deposit contract.** One transaction on
Ethereum, no bridge operator, no fee beyond Ethereum gas. The ETH arrives on the rollup in minutes.

It solves a problem the app already has. Someone who bridges USDC to Base or Arbitrum often has no
ETH there for gas, and the app can only tell them to go and get some. With this, they can send it
from the same page.

## What it can and can't do

- **Only from Ethereum, only to rollups built on Ethereum.** Each rollup has its own deposit
  contract on Ethereum. Monad, Solana, Sui, BNB Chain, Hyperliquid and other chains that don't
  settle on Ethereum have none; they need a third-party bridge (see the parked LI.FI plan).
- **Only ETH.** USDC keeps using CCTP.
- **Only deposits.** Coming back to Ethereum through the same contracts takes about 7 days, so the
  app won't offer it; it says so next to the route.
- **Only rollups whose gas token is ETH.**

## Destinations

A destination is offered only when its contract is in our own table and was checked as below. The
address never comes from user input or an API.

| Rollup | Kind | Deposit contract on Ethereum | How it was checked |
| --- | --- | --- | --- |
| Base | OP Stack | OptimismPortal `0x49048044D57e1C92A77f79988d21Fa8fAF74E97e` | Listed on docs.base.org (Base contracts). On Ethereum, Base's L1StandardBridge `0x3154Cf16ccdb4C6d922629664174b904d80F2C35` → messenger `0x866E82a600A1414e583f7F13623F1aC5d58b0Afa` → this portal, and the portal's `systemConfig()` is `0x73a79Fab69143498Ed3712e519A88a918e1f4072`, also on that page. viem 2.56.9 lists the same portal. **Used on mainnet**, see below. |
| Arbitrum One | Arbitrum | Delayed Inbox `0x4Dbd4fc535Ac27206064B68FfCf827b0A60BAB3f` | `bridge()` returns `0x8315177aB297bA92A06054cE80a67Ed4DBd7ed3a`, the Bridge on docs.arbitrum.io (contract addresses). Not paused. `depositEth()` estimates at 92,991 gas. |
| Robinhood Chain | Arbitrum | Delayed Inbox `0x1A07cc4BD17E0118BdB54D70990D2158AbAD7a2D` | Listed with its Bridge `0xDf8755334ce7A73cCF6b581C02eA649AE3E864b3` on docs.robinhood.com/chain/protocol-contracts, and `bridge()` returns that address. Not paused. `depositEth()` estimates at 92,957 gas. |

Checked on 11 November 2026. OP Mainnet, Unichain, Ink, World Chain, Soneium and Arbitrum Nova use
the same two designs and can be added the same way: take the address from the chain's own docs,
confirm it on Ethereum as above, then list it. (viem lists OP Mainnet's portal as
`0xbEb5Fc579115071764c7423A4f12eDde41f106Ed`; not yet checked against Optimism's docs.)

## How a deposit works

### OP Stack: `OptimismPortal.depositTransaction`

```solidity
depositTransaction(address _to, uint256 _value, uint64 _gasLimit, bool _isCreation, bytes _data) payable
```

Send the amount as `msg.value` and as `_value`, with `_to` = recipient, `_gasLimit` = 50,000 (the
portal's `minimumGasLimit(0)` is 21,000), `_isCreation` = false and empty `_data`.

- The recipient can be any address.
- The rollup first credits the ETH to the sender's address there, then moves it to `_to`. If that
  move fails, the ETH stays with the sender on the rollup. It isn't lost.
- When the deposit doesn't come straight from the wallet (another contract or a bundler calls the
  portal), the rollup shifts ("aliases") the sender's address. Then a failed move leaves the ETH at
  an address the user may not control. The app always sends the deposit as a plain transaction from
  the wallet, and keeps `_gasLimit` well above what a plain transfer needs so the move doesn't fail.
- The portal burns some extra Ethereum gas in proportion to `_gasLimit`, so keep it modest.
- Don't use Base's L1StandardBridge `depositETHTo` instead. It ends in the same portal but estimated
  at 662,804 gas against 79,456 for the portal directly.

viem already has this: `walletActionsL1().depositTransaction` and `buildDepositTransaction` in
`viem/op-stack`, and `getL2TransactionHashes` to turn the Ethereum receipt into the rollup's
transaction hash for tracking.

### Arbitrum family: `Inbox.depositEth`

```solidity
depositEth() payable
```

- Credits the **sender's own address** on the rollup. There is no recipient field.
- Nitro's Inbox aliases the sender when its address has code or it isn't the transaction's origin,
  and then the ETH lands somewhere the user can't reach. Version one refuses any sender whose
  address has code on Ethereum, including MetaMask smart accounts. Before relaxing that, read what
  the deployed Inbox (implementation `0x7c058ad1d0ee415f7e7f30e62db1bcf568470a10` for Arbitrum
  One, `0x8d3b93dffff4842e7b61fb553b383db2c6bc91c6` for Robinhood Chain) does with them.
- Sending to a different address takes `createRetryableTicket`, which needs a submission fee, a
  gas limit and a gas price for the rollup. Arbitrum's SDK estimates these (`EthBridger.depositTo`),
  but it brings in ethers v5. That's version two.
- Tracking: the Ethereum receipt holds the message number. Either use the SDK's receipt helpers or
  compute the rollup transaction hash from it; decide when building.

## Proof on mainnet

On 11 November 2026, the deployer `0x6915…c92C` deposited 0.00002 ETH to `0x9C05…D262` on Base
through the portal: Ethereum transaction
`0xe402afbf379d1f23fb24a34a9632ae87494377c9ceaf239506aa2c33506564d9`, 79,456 gas, a fee of
0.0000123 ETH at about 0.18 gwei. It arrived on Base within a few minutes.

## Changes to the app

Everything in the app today assumes USDC and a CCTP burn. The new route sits beside that, not
inside it.

1. **`bridge/src/lib/deposits.ts` (new).** The destinations table above; `quoteDeposit(dest,
   amount)` returns the Ethereum gas, its cost and the expected arrival time; `deposit(wallet, dest,
   recipient, amount)` switches the wallet to Ethereum and sends; `trackDeposit(dest, hash)` returns
   the rollup transaction once it lands. Amounts stay in wei.
2. **Token picker in `Bridge.tsx`.** USDC or ETH. ETH can be picked only when the source is
   Ethereum mainnet and the destination is in the table. Anything else says "ETH moves only from
   Ethereum to its rollups".
3. **`Transfer` in `src/lib/bridge.ts`.** Add `asset: "USDC" | "ETH"`. ETH transfers have two
   steps, *Deposit on Ethereum* and *Arrives on {chain}*, not approve/burn/attest/mint. Records
   without `asset` stay USDC, so saved history keeps working.
4. **Amount and balance.** ETH balance from `getBalance`. Max is the balance minus the estimated gas
   with a margin. If the estimate fails, the button stays off.
5. **Recipient.** On OP Stack chains, any address, defaulting to the connected one. On the Arbitrum
   family in version one, the sender's own address only.
6. **Tracker.** While the rollup hasn't credited it, the deposit shows as pending, never failed.
   Base usually takes a few minutes; Arbitrum about 10 to 15.
7. **History across devices.** `lookup.ts` and the stats record read Circle, which knows nothing
   about these deposits. Version one keeps them in `localStorage` only. Adding them to "Transfers
   follow the wallet" needs a stats endpoint that checks the Ethereum receipt itself (contract,
   value, sender) before recording.
8. **Copy.** The headline stays about USDC. The README's Chains table gets an "ETH from Ethereum"
   row.

## Rules

- The contract comes from our table only. Read `paused()` before sending and refuse if paused.
- Never send with a guessed gas limit. A failed estimate means no button.
- Arbitrum family: refuse a sender with code until the explicit-recipient path exists.
- Show the 7-day withdrawal time and the Ethereum fee before the user signs.

## Testing

- Sepolia first: Base Sepolia's portal is `0x49f53e41452C74589E85cA1677426Ba426459e85` (docs.base.org);
  take Arbitrum Sepolia's Inbox from docs.arbitrum.io.
- On mainnet, one small deposit per destination before it's listed, with the transaction hashes
  added to this page.
- Unit tests: the wei maths for Max, and every refusal (paused, failed estimate, sender with code,
  destination not in the table).

## Still open

- Which rollups first. Base, Arbitrum One and Robinhood Chain are checked; OP Mainnet next.
- Whether ETH deposits count toward Setsuna's bridge volume, and what USD price to use.
- Arbitrum's SDK for explicit recipients, or our own fee estimates.
