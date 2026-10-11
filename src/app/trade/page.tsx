import type { Metadata } from "next";
import { Suspense } from "react";
import AppShell from "@/components/setsuna/AppShell";

export const metadata: Metadata = { title: "Trade · Setsuna" };

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
