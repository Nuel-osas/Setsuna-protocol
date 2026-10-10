import { Suspense } from "react";
import AppShell from "@/components/setsuna/AppShell";
export const metadata = { title: "setsMON · Setsuna" };
export default function Page() {
  return (
    <Suspense
      fallback={
        <main id="main" className="s-app">
          Loading vault…
        </main>
      }
    >
      <AppShell />
    </Suspense>
  );
}
