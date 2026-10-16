import type { Metadata } from "next";
import { pageMeta } from "@/lib/setsuna/seo";
import { Suspense } from "react";
import AppShell from "@/components/setsuna/AppShell";
import AppFallback from "@/components/setsuna/AppFallback";
export const metadata: Metadata = pageMeta({
  title: "setsUSDC vault",
  description:
    "The setsUSDC vault supplies USDC to Aave, Morpho, Euler and Neverland on Monad within published caps. Live rate, split and the 2,000 USDC beta cap.",
  path: "/earn/usdc/",
});
export default function Page() {
  return (
    <Suspense
      fallback={
        <AppFallback
          title="setsUSDC vault"
          text="Supplies USDC to Aave, Morpho, Euler and Neverland on Monad within published caps. Capped beta: up to 2,000 USDC."
        />
      }
    >
      <AppShell />
    </Suspense>
  );
}
