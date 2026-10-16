import type { Metadata } from "next";
import { pageMeta } from "@/lib/setsuna/seo";
import { Suspense } from "react";
import AppShell from "@/components/setsuna/AppShell";
import AppFallback from "@/components/setsuna/AppFallback";
export const metadata: Metadata = pageMeta({
  title: "Earn",
  description:
    "Deposit MON or USDC into Setsuna’s Earn vaults on Monad. See live supply rates, the target split, caps and the cash buffer before you sign.",
  path: "/earn/",
});
export default function Page() {
  return (
    <Suspense
      fallback={
        <AppFallback
          title="Earn on Monad"
          text="MON and USDC vaults that supply approved Monad lending markets under published caps, with a cash buffer for withdrawals."
        />
      }
    >
      <AppShell />
    </Suspense>
  );
}
