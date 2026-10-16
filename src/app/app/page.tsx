import type { Metadata } from "next";
import { pageMeta } from "@/lib/setsuna/seo";
import AppShell from "@/components/setsuna/AppShell";
import { Suspense } from "react";

export const metadata: Metadata = pageMeta({
  title: "App",
  description:
    "Open Setsuna: Earn vaults, spot swaps and perpetuals on Monad in one app.",
  path: "/app/",
  index: false,
});

export default function Page() {
  return (
    <Suspense
      fallback={
        <main id="main" className="s-page">
          Loading app…
        </main>
      }
    >
      <AppShell />
    </Suspense>
  );
}
