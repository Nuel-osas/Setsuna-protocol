Lending creates a claim on assets that borrowers may currently be using. Setsuna distinguishes that claim from the cash it can return immediately.

## The buffer comes first

The allocator targets a 10% idle buffer. Withdrawals consume it before the vault requests funds from lending markets.

The buffer belongs to all shareholders. It is not an individually reserved amount for each user, and earlier withdrawals can use it before later users arrive.

## Then the lending markets

Adapters limit withdrawal quotes by the vault's position and the destination's available cash. Protocol pause state and operation controls can reduce that amount further.

For Curvance, the adapter checks the manager's redemption pause and the smaller of reported cash and actual USDC token cash. A pause does not erase the accounting value of the position, but can prevent an immediate exit.

## When available is below your position value

The app may show a position worth more than the amount available now. That is a liquidity constraint, not necessarily a realized loss.

You can attempt a partial redemption within the quoted limit. There is no automatic withdrawal queue. Protocol repayments, additional cash or changed pause conditions may improve availability later; none is guaranteed.

## When accounting cannot be read

Failed position valuation is different from a healthy but cash-limited market. If the vault cannot establish healthy accounting, new deposits and redemptions are blocked rather than priced against cached values.

## Restoring the buffer

After a withdrawal, the cash percentage can fall below target. An eligible rebalance withdraws available assets to repair the buffer, subject to the cooldown, liquidity and movement budget. The system cannot create cash that the lending protocols do not have.
