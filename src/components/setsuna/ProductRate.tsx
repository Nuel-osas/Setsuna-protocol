"use client";
import { pct, useEarn } from "./useEarn";

export default function ProductRate() {
  const { data, failed } = useEarn();
  return (
    <span className="s-product-rate">
      <b>{data && !failed ? pct(data.blendedApr) : "—"}</b> estimated base APR, live
    </span>
  );
}
