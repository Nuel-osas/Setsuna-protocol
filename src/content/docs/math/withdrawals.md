A withdrawal calculation has two parts: the value represented by the owner's shares and the underlying cash the system can currently deliver.

## Available underlying

```text
cashAvailable = vault cash + sum(adapter available liquidity)
ownerClaim = convertToAssets(ownerShares)
maxWithdraw = min(ownerClaim, cashAvailable)
```

A failed adapter liquidity read contributes no invented cash. If overall position accounting is unhealthy, the vault reports zero maximum withdrawal and redemption.

## Redeemable shares

When the owner's full converted claim fits within available cash, the full share balance can be offered for redemption. Otherwise, the available cash is converted to a bounded share amount using the vault's rounding rules.

The maximum is a snapshot, not a reservation. Other withdrawals or changes in venue liquidity can occur before execution.

## Example

Suppose your shares represent 500 USDC. The vault has 100 USDC in cash and can currently withdraw 250 USDC from its lending positions. Your maximum asset withdrawal is at most **350 USDC**.

The remaining claim still exists, but the entire 500 cannot be delivered from the currently available cash. A submitted full redemption can revert even though the shares retain accounting value.

## Execution checks

The vault refreshes accounting, consumes cash, and withdraws the additional amount from adapters. It verifies the recipient's exact token increase and checks the accounting outcome after settlement.

The implementation allows four underlying base units of accounting-rounding difference per operation. For USDC, that is 0.000004 USDC; for WMON, it is four wei. This is a fixed rounding tolerance, not a percentage loss allowance.

The app's minimum-output bound is a separate user-transaction check. Neither replaces protocol liquidity requirements.
