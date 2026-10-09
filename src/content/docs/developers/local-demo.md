The local demo copies a pinned Monad mainnet state, deploys fresh Setsuna contracts and uses synthetic funds. It makes the full USDC flow reproducible without sending production transactions.

## Requirements

Use Node.js 24 and Foundry tools on your path. Run these commands from the `setsuna` project directory. Contract dependencies are pinned in the repository.

```sh
npm ci
npm run setup:contracts
```

## Start five-protocol Earn

For the complete product in one environment, use:

```sh
forge build --root contracts
npm run demo:unified
```

This deploys fresh setsUSDC, setsMON, Spot, Perps and faucet contracts on one fork, runs the browser acceptance journey and leaves successful services running at [port 3016](http://127.0.0.1:3016/app/). Connect a browser wallet and choose **Get test funds**. The RPC is on port 18614; signing uses the restricted app RPC. The acceptance runner requires Chrome and uses controlled time advancement. Reconnect your wallet after a full page reload.

For the earlier dedicated USDC environment:

In one terminal:

```sh
npm run usdc:demo:five
```

In another:

```sh
npm run dev:usdc-five
```

Open [the local app on port 3015](http://127.0.0.1:3015/app/), select **USDC** in the Earn card’s asset dropdown, and connect with **Try the local demo account**. The fork RPC is `http://127.0.0.1:18613`, chain ID 31337. These loopback links work on the machine running the demo.

The launcher seeds the vault using a separate account and funds the demo wallet with 10,000 synthetic USDC. Actual lending positions, rates and transactions use that same fork. An occupied RPC port is left alone rather than reset.

## Follow the complete journey

1. Deposit 100 USDC and confirm the exact approval and deposit.
2. Inspect the five protocol positions and cash buffer.
3. Open **Vault activity and public controls** to inspect observations and rebalance readiness.
4. Redeem some shares, then redeem the remaining available shares.
5. Check the receipts and returned USDC balance.

Fresh rate observations and cooldowns are enforced even in the demo. The launcher advances simulated time while preparing the initial allocation; its running keeper continues checking the vault.

## Run the checks

```sh
npm run contracts:test:usdc-five
npm run check:usdc-five
```

The browser check requires the demo and app to be running, Chrome installed, and an empty position for the test account. It exercises approval, deposit, rate observation, rebalance and partial/full redemption. It advances time on the owned fork.

## Other demos and current limits

The older four-protocol USDC demo uses app port 3014 and RPC 18612. The separately verified combined setsMON/Spot/Perps environment uses app port 3011 and its own deployment record. These are distinct chains, even though they use the same local chain ID.

The fork does not ingest future mainnet transactions. Interest can accrue as its clock advances, but prices, utilization and liquidity do not follow live mainnet automatically. Stop the fork launcher with Ctrl-C to stop its owned fork and worker. Keep `.local/` keys and machine-specific state out of public artifacts.
