"use client";
import { useEffect, useRef, useState } from "react";
import { useWallet } from "./WalletProvider";
import { readPortfolio, type PortfolioSnapshot } from "@/lib/setsuna/portfolio";

export function usePortfolio() {
  const { deployment, address } = useWallet();
  const key = `${deployment?.rpc}:${deployment?.chainId}:${deployment?.earnMON?.vault}:${deployment?.earnUSDC?.vault}:${deployment?.factory}:${deployment?.collateral}:${address}`;
  const [state, setState] = useState<{
    key: string;
    data?: PortfolioSnapshot;
    loading: boolean;
    error?: string;
  }>();
  const run = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    let cancelled = false,
      reading = false;
    const refresh = async () => {
      if (!deployment || !address || cancelled || reading) return;
      reading = true;
      setState((previous) => ({
        key,
        data: previous?.key === key ? previous.data : undefined,
        loading: true,
      }));
      try {
        const data = await readPortfolio(deployment, address);
        if (!cancelled) setState({ key, data, loading: false });
      } catch {
        if (!cancelled)
          setState({
            key,
            loading: false,
            error:
              "Portfolio data is unavailable. Check the demo connection and refresh.",
          });
      } finally {
        reading = false;
      }
    };
    run.current = refresh;
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [deployment, address, key]);

  // Never render the previous account's data while a new owner is loading.
  const current = state?.key === key ? state : undefined;
  return {
    data: current?.data,
    loading: !!address && (!current || current.loading),
    error: current?.error,
    refresh: () => void run.current(),
  };
}
