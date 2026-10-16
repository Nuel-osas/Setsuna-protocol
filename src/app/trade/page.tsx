import type { Metadata } from "next";
import { pageMeta } from "@/lib/setsuna/seo";
import { Suspense } from "react";
import AppShell from "@/components/setsuna/AppShell";
import AppFallback from "@/components/setsuna/AppFallback";

export const metadata: Metadata = pageMeta({
  title: "Trade",
  description:
    "Swap MON and USDC through Kuru and trade AUSD-funded BTC perpetuals on Perpl, with a clear quote and minimum receive amount before you sign.",
  path: "/trade/",
});

export default function Page() {
  return (
    <Suspense
      fallback={
        <AppFallback
          title="Trade on Monad"
          text="Swap MON and USDC through Kuru, or trade AUSD-funded BTC perpetuals on Perpl."
        />
      }
    >
      <AppShell />
    </Suspense>
  );
}
