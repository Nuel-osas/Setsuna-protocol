import type { Metadata } from "next";
import { pageMeta } from "@/lib/setsuna/seo";
import { Suspense } from "react";
import AppShell from "@/components/setsuna/AppShell";

export const metadata: Metadata = pageMeta({
  title: "Portfolio",
  description:
    "Your Setsuna vault shares, balances and trading positions on Monad, read from your connected wallet.",
  path: "/portfolio/",
  index: false,
});
export default function Page() {
  return (
    <Suspense
      fallback={
        <main id="main" className="s-page">
          Loading portfolio…
        </main>
      }
    >
      <AppShell />
    </Suspense>
  );
}
