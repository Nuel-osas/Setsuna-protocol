import type { Metadata } from "next";
import { pageMeta } from "@/lib/setsuna/seo";
import { Suspense } from "react";
import AppShell from "@/components/setsuna/AppShell";
import AppFallback from "@/components/setsuna/AppFallback";
export const metadata: Metadata = pageMeta({
  title: "setsMON vault",
  description:
    "The setsMON vault puts MON to work across approved Monad lending markets. Live rate, allocation, the 25,000 MON beta cap and how withdrawals work.",
  path: "/earn/mon/",
});
export default function Page() {
  return (
    <Suspense
      fallback={
        <AppFallback
          title="setsMON vault"
          text="Puts MON to work across approved Monad lending markets within published caps. Capped beta: up to 25,000 MON."
        />
      }
    >
      <AppShell />
    </Suspense>
  );
}
