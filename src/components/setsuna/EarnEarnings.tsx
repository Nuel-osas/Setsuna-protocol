"use client";
import { useEffect, useState } from "react";
import { useWallet } from "./WalletProvider";
import { earnAmount, type EarnAsset } from "./EarnForm";
import { readOwnerFlows } from "@/lib/setsuna/earn-history";
import { reconcileEarn } from "@/lib/setsuna/earn-accounting";

type Result = ReturnType<typeof reconcileEarn>;
export default function EarnEarnings({
  asset,
  shares,
  worth,
  block,
}: {
  asset: EarnAsset;
  shares?: bigint;
  worth?: bigint;
  block?: bigint;
}) {
  const { deployment: d, address } = useWallet();
  const vault = asset === "MON" ? d?.earnMON : d?.earnUSDC;
  const key = `${d?.rpc}:${d?.chainId}:${vault?.vault}:${address}:${shares}:${worth}:${block}`;
  const [state, setState] = useState<{ key: string; result: Result }>();
  const result = state?.key === key ? state.result : undefined;
  useEffect(() => {
    if (!d || !address || !vault || shares === undefined || block === undefined)
      return;
    let cancelled = false;
    void readOwnerFlows(d, asset, address, block)
      .then((flows) => reconcileEarn(flows, address, shares, worth, true))
      .catch(() => reconcileEarn([], address, shares, worth, false))
      .then((result) => {
        if (!cancelled) setState({ key, result });
      });
    return () => {
      cancelled = true;
    };
  }, [d, address, vault, asset, shares, worth, block, key]);
  const decimals = asset === "MON" ? 18 : 6;
  return (
    <div className="e-earnings" aria-label={`${asset} earnings`}>
      <dl>
        <div>
          <dt>Total deposited</dt>
          <dd>
            {earnAmount(result?.deposited, decimals, 6)} <small>{asset}</small>
          </dd>
        </div>
        <div>
          <dt>Total withdrawn</dt>
          <dd>
            {earnAmount(result?.withdrawn, decimals, 6)} <small>{asset}</small>
          </dd>
        </div>
        <div>
          <dt>Net earnings</dt>
          <dd
            className={
              result?.earnings !== undefined && result.earnings >= BigInt(0)
                ? "e-positive"
                : ""
            }
            data-testid={`earnings-${asset.toLowerCase()}`}
          >
            {result?.earnings !== undefined && result.earnings > BigInt(0)
              ? "+"
              : ""}
            {earnAmount(result?.earnings, decimals, 6)} <small>{asset}</small>
          </dd>
        </div>
      </dl>
      <p>
        {!address
          ? "Connect to see your earnings."
          : !result
            ? "Reading your vault history…"
            : (result.reason ??
              "Lifetime earnings = current value + withdrawals − deposits. Excludes gas and changes in token market price.")}
      </p>
    </div>
  );
}
