"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import EarnOverview from "./EarnOverview";
import EarnApp from "./EarnApp";
import App from "./App";
import SpotApp from "./SpotApp";
import Portfolio from "./Portfolio";

type Tab = "earn" | "spot" | "perps" | "portfolio";

function TabIcon({ tab }: { tab: Tab }) {
  const paths = {
    earn: "M12 3v18M16 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H7M4 8a9 9 0 0 1 16 0M4 16a9 9 0 0 0 16 0",
    spot: "M4 8h16m-4-4 4 4-4 4M20 16H4m4-4-4 4 4 4",
    perps: "M5 3v18M2 8h6v7H2M12 2v18M9 5h6v6H9M19 6v16M16 12h6v6h-6",
    portfolio: "M3 7h18v14H3V7Zm4 0V3h10v4M3 12h18M10 12v3h4v-3",
  };
  return (
    <svg
      className="b-tab-icon"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[tab]} />
    </svg>
  );
}

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
          ? "/earn/"
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
            <TabIcon tab={t} />
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
        path.startsWith("/earn/mon") ||
        path.startsWith("/earn/usdc") ||
        search.has("asset") ||
        search.has("action") ? (
          <EarnApp />
        ) : (
          <EarnOverview />
        )
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
