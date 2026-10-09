import type { Metadata } from "next";
import { Suspense } from "react";
import AppShell from "@/components/setsuna/AppShell";

export const metadata: Metadata = { title: "Portfolio · Setsuna" };
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
