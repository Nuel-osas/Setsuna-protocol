"use client";

import { useEffect, useState } from "react";
import { clientFor, useWallet } from "./WalletProvider";

/**
 * Monad keeps 10 MON in any EIP-7702-delegated wallet (e.g. a MetaMask smart account): a
 * transaction that moves MON out and leaves it under 10 MON is refused. Plain wallets have no
 * such floor. https://docs.monad.xyz/developer-essentials/eip-7702
 */
export const SMART_ACCOUNT_RESERVE = BigInt("10000000000000000000"); // 10 MON

export function useMonReserve() {
  const { deployment: d, address } = useWallet();
  const [delegated, setDelegated] = useState(false);
  useEffect(() => {
    setDelegated(false);
    if (!d || !address || d.chainId !== 143) return;
    let live = true;
    clientFor(d)
      .getCode({ address })
      .then((code) => live && setDelegated(!!code && code.toLowerCase().startsWith("0xef0100")))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [d, address]);
  return {
    /** True for a smart-account (EIP-7702) wallet. */
    delegated,
    /** MON that must stay in the wallet on top of gas when moving MON out. */
    reserve: delegated ? SMART_ACCOUNT_RESERVE : BigInt(0),
  };
}

export const smartAccountHint =
  "Your wallet is a smart account, and Monad keeps 10 MON in smart accounts when MON is moved out. Switch it to a standard account in your wallet to use all of it.";
