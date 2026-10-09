"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import EarnApp from "./EarnApp";
import App from "./App";
import SpotApp from "./SpotApp";
import Portfolio from "./Portfolio";

type Tab = "earn" | "spot" | "perps" | "portfolio";

export default function AppShell() {
  const path = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const selected = search.get("tab");
  const tab: Tab =
    path.startsWith("/portfolio") || selected === "portfolio"
      ? "portfolio"
      : selected === "spot"
        ? "spot"
        : selected === "trade" || selected === "perps"
          ? "perps"
          : "earn";
  const go = (t: Tab) => {
    router.push(
      t === "portfolio"
        ? "/portfolio/"
        : t === "earn"
          ? "/app/"
          : `/app/?tab=${t}`,
    );
  };
  return (
    <div
      className={
        tab === "spot" || tab === "perps"
          ? "s-app-shell t-shell"
          : "s-app-shell"
      }
    >
      <nav className="s-tabs" aria-label="App sections">
        {(["earn", "spot", "perps", "portfolio"] as const).map((t) => (
          <button
            key={t}
            className={tab === t ? "is-on" : ""}
            aria-current={tab === t ? "page" : undefined}
            onClick={() => go(t)}
          >
            {t === "earn"
              ? "Earn"
              : t === "spot"
                ? "Spot"
                : t === "perps"
                  ? "Perps"
                  : "Portfolio"}
          </button>
        ))}
      </nav>
      {tab === "earn" ? (
        <EarnApp />
      ) : tab === "spot" ? (
        <SpotApp />
      ) : tab === "perps" ? (
        <App />
      ) : (
        <Portfolio />
      )}
    </div>
  );
}
