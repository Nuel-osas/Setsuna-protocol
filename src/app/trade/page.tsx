import type { Metadata } from "next";
import { pageMeta } from "@/lib/setsuna/seo";
import { Suspense } from "react";
import AppShell from "@/components/setsuna/AppShell";

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
        <main id="main" className="s-app">
          Loading trading…
        </main>
      }
    >
      <AppShell />
    </Suspense>
  );
}
