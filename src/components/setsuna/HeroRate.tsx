"use client";
import { useEarn } from "./useEarn";

/** The live blended rate, set as the headline. */
export default function HeroRate() {
  const { data, failed } = useEarn();
  const v = data && !failed ? (data.blendedApr * 100).toFixed(2) : null;
  return (
    <span className={`s-hero-rate ${v ? "" : "is-loading"}`} aria-live="polite">
      {v ?? "—.——"}
      <i>%</i>
      <small>estimated base APR · live from Monad</small>
    </span>
  );
}
