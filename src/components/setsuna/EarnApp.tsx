"use client";
import { useState, useEffect } from "react";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import MONEarn from "./MONEarn";
import USDCEarn from "./USDCEarn";
import type { EarnMode, PickerAsset } from "./EarnForm";
export default function EarnApp() {
  const search = useSearchParams(),
    path = usePathname(),
    router = useRouter();
  const requestedMode = search.get("action");
  const onUSDC =
    path.startsWith("/earn/usdc") || search.get("asset") === "USDC";
  // AUSD is saved in the setsUSDC vault (through setsAUSD), so it lives on the USDC page.
  const asset: PickerAsset = !onUSDC
    ? "MON"
    : search.get("pay") === "ausd"
      ? "AUSD"
      : "USDC";
  const [mode, setMode] = useState<EarnMode>(
    requestedMode === "withdraw" ? "withdraw" : "deposit",
  );
  useEffect(() => {
    setMode(requestedMode === "withdraw" ? "withdraw" : "deposit");
  }, [requestedMode]);
  const setAsset = (next: PickerAsset) =>
    router.push(
      next === "AUSD"
        ? `/earn/usdc/?action=${mode}&pay=ausd`
        : `/earn/${next.toLowerCase()}/?action=${mode}`,
      { scroll: false },
    );
  const controls = { setAsset, mode, setMode };
  return asset === "MON" ? (
    <MONEarn {...controls} />
  ) : (
    <USDCEarn {...controls} ausd={asset === "AUSD"} />
  );
}
