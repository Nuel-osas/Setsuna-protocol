#!/usr/bin/env bash
# Earn destination probe: deposit 1,000 USDC, advance 7 days, withdraw everything.
# Runs only against a LOCAL anvil fork of Monad mainnet. Synthetic funding via
# impersonating Aave's aUSDC (which holds USDC). No mainnet transactions.
set -euo pipefail
UP=${UPSTREAM_RPC:-https://rpc-mainnet.monadinfra.com}
PORT=${PORT:-18600}; R=http://127.0.0.1:$PORT
USDC=0x754704Bc059F8C67012fEd69BC8A327a5aafb603
AUSDC=0x35a73BAcb179d3740395A3ceCc87FF2e581d6042
ME=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
EULER=0x1905EDDF5943ef6C92Ccf1469bd40fC2cB4A77b0          # EVK eUSDC-12, governed perspective
NEVER_POOL=0x80F00661b13CC5F6ccd3885bE7b4C9c67545D585     # Neverland Pool (Aave V3 fork)
NEVER_DP=0xfd0b6b6F736376F7B99ee989c749007c7757fDba
MORPHO=0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee
MKT=0x9e8441e7af65860feac831ebc117473e3033321abf528ebc8fbde1eeaaa3a626   # USDC market, aHYPER collateral
AMT=1000000000; MAX=115792089237316195423570985008687907853269984665640564039457584007913129639935

BLOCK=$(cast block-number --rpc-url $UP)
anvil --fork-url $UP --fork-block-number $BLOCK --port $PORT --chain-id 143 --silent & AP=$!
trap 'kill $AP 2>/dev/null' EXIT
until cast chain-id --rpc-url $R >/dev/null 2>&1; do sleep 1; done
echo "fork block $BLOCK hash $(cast block $BLOCK -f hash --rpc-url $R)"
send(){ local out; out=$(cast send --rpc-url $R --private-key $PK --gas-limit 1500000 "$@" 2>&1) || { echo "FAILED: $*"; echo "$out" | tail -3; exit 1; }
  echo "$out" | grep -q "status.*1 (success)" || { echo "REVERTED: $*"; local h; h=$(echo "$out" | awk '/transactionHash/{print $2}');
    cast run --rpc-url $R $h 2>&1 | grep -iE "revert|error|\[Revert\]" | head -5; exit 1; }; }
bal(){ cast call --rpc-url $R $USDC "balanceOf(address)(uint256)" $ME | awk '{print $1}'; }
fund(){ cast rpc --rpc-url $R anvil_impersonateAccount $AUSDC >/dev/null; cast rpc --rpc-url $R anvil_setBalance $AUSDC 0x56BC75E2D63100000 >/dev/null
  cast send --rpc-url $R --unlocked --from $AUSDC $USDC "transfer(address,uint256)" $ME $AMT >/dev/null; cast rpc --rpc-url $R anvil_stopImpersonatingAccount $AUSDC >/dev/null; }
warp(){ cast rpc --rpc-url $R evm_increaseTime 604800 >/dev/null; cast rpc --rpc-url $R evm_mine >/dev/null; }
snap(){ cast rpc --rpc-url $R evm_snapshot | tr -d '"'; }
revert(){ cast rpc --rpc-url $R evm_revert $1 >/dev/null; }
report(){ python3 -c "a=$2/1e6;b=$3/1e6;print(f'$1: deposited {a:,.6f} withdrew {b:,.6f} USDC after 7 simulated days -> {b-a:+.6f} ({(b/a-1)*100*52.14:.2f}% annualised)')"; }

S=$(snap)
echo "== Euler eUSDC-12"; fund; B0=$(bal)
send $USDC "approve(address,uint256)" $EULER $AMT
send $EULER "deposit(uint256,address)" $AMT $ME
SH=$(cast call --rpc-url $R $EULER "balanceOf(address)(uint256)" $ME | awk '{print $1}'); echo "shares $SH"
warp; send $EULER "redeem(uint256,address,address)" $SH $ME $ME
B1=$(bal); echo "shares left $(cast call --rpc-url $R $EULER 'balanceOf(address)(uint256)' $ME | awk '{print $1}')"; report "Euler" $((AMT)) $((B1-B0+AMT))
revert $S; S=$(snap)

echo "== Neverland USDC"; fund; B0=$(bal)
AT=$(cast call --rpc-url $R $NEVER_DP "getReserveTokensAddresses(address)(address,address,address)" $USDC | head -1)
send $USDC "approve(address,uint256)" $NEVER_POOL $AMT
send $NEVER_POOL "supply(address,uint256,address,uint16)" $USDC $AMT $ME 0
echo "aToken $AT balance $(cast call --rpc-url $R $AT 'balanceOf(address)(uint256)' $ME | awk '{print $1}')"
warp; send $NEVER_POOL "withdraw(address,uint256,address)" $USDC $MAX $ME
B1=$(bal); echo "aToken left $(cast call --rpc-url $R $AT 'balanceOf(address)(uint256)' $ME | awk '{print $1}')"; report "Neverland" $((AMT)) $((B1-B0+AMT))
revert $S; S=$(snap)

echo "== Morpho Blue aHYPER/USDC"; fund; B0=$(bal)
P=$(cast call --rpc-url $R $MORPHO "idToMarketParams(bytes32)(address,address,address,address,uint256)" $MKT | awk '{print $1}' | paste -sd, -)
echo "params ($P)"; [ "$(echo $P | cut -d, -f1 | tr A-F a-f)" = "$(echo $USDC | tr A-F a-f)" ] || { echo "loan token mismatch"; exit 1; }
send $USDC "approve(address,uint256)" $MORPHO $AMT
send $MORPHO "supply((address,address,address,address,uint256),uint256,uint256,address,bytes)" "($P)" $AMT 0 $ME 0x
SS=$(cast call --rpc-url $R $MORPHO "position(bytes32,address)(uint256,uint128,uint128)" $MKT $ME | head -1 | awk '{print $1}'); echo "supply shares $SS"
warp; send $MORPHO "withdraw((address,address,address,address,uint256),uint256,uint256,address,address)" "($P)" 0 $SS $ME $ME
B1=$(bal); echo "shares left $(cast call --rpc-url $R $MORPHO 'position(bytes32,address)(uint256,uint128,uint128)' $MKT $ME | head -1 | awk '{print $1}')"; report "Morpho aHYPER" $((AMT)) $((B1-B0+AMT))
