"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useWallet } from "./WalletProvider";
import MONEarn from "./MONEarn";
import USDCEarn from "./USDCEarn";
import type { EarnMode } from "./EarnForm";
export default function EarnApp() {
  const search = useSearchParams();
  const requestedAsset = search.get("asset");
  const requestedMode = search.get("action");
  const [asset, setAsset] = useState<"MON" | "USDC">("MON");
  const [mode, setMode] = useState<EarnMode>("deposit");
  const { deployment } = useWallet();
  useEffect(() => {
    setAsset(requestedAsset === "USDC" ? "USDC" : "MON");
    setMode(requestedMode === "withdraw" ? "withdraw" : "deposit");
  }, [requestedAsset, requestedMode]);
  useEffect(() => {
    if (deployment?.earnUSDC && !deployment.earnMON) setAsset("USDC");
  }, [deployment]);
  const controls = { setAsset, mode, setMode };
  return asset === "MON" ? (
    <MONEarn {...controls} />
  ) : (
    <USDCEarn {...controls} />
  );
}
