"use client";
import { useEffect, useState } from "react";
import { useWallet } from "./WalletProvider";
import MONEarn from "./MONEarn";
import USDCEarn from "./USDCEarn";
import type { EarnMode } from "./EarnForm";
export default function EarnApp() {
  const [asset, setAsset] = useState<"MON" | "USDC">("MON");
  const [mode, setMode] = useState<EarnMode>("deposit");
  const { deployment } = useWallet();
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
