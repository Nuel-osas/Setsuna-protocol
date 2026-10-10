"use client";
import { useState, useEffect } from "react";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import MONEarn from "./MONEarn";
import USDCEarn from "./USDCEarn";
import type { EarnMode, EarnAsset } from "./EarnForm";
export default function EarnApp() {
  const search = useSearchParams(),
    path = usePathname(),
    router = useRouter();
  const requestedMode = search.get("action");
  const asset =
    path.startsWith("/earn/usdc") || search.get("asset") === "USDC"
      ? "USDC"
      : "MON";
  const [mode, setMode] = useState<EarnMode>(
    requestedMode === "withdraw" ? "withdraw" : "deposit",
  );
  useEffect(() => {
    setMode(requestedMode === "withdraw" ? "withdraw" : "deposit");
  }, [requestedMode]);
  const setAsset = (next: EarnAsset) =>
    router.push(`/earn/${next.toLowerCase()}/?action=${mode}`, {
      scroll: false,
    });
  const controls = { setAsset, mode, setMode };
  return asset === "MON" ? (
    <MONEarn {...controls} />
  ) : (
    <USDCEarn {...controls} />
  );
}
