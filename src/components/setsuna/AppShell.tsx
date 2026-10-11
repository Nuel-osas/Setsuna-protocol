"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import EarnOverview from "./EarnOverview";
import EarnApp from "./EarnApp";
import App from "./App";
import SpotApp from "./SpotApp";
import Portfolio from "./Portfolio";
import { EarnScope, TradingScope } from "./WalletProvider";

type Tab = "earn" | "trade" | "portfolio";
type TradeMode = "spot" | "perps";
function TabIcon({ tab }: { tab: Tab }) {
  const paths = {
    earn: "M12 3v18M16 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H7M4 8a9 9 0 0 1 16 0M4 16a9 9 0 0 0 16 0",
    trade: "M5 3v18M2 8h6v7H2M12 2v18M9 5h6v6H9M19 6v16M16 12h6v6h-6",
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
      : path.startsWith("/trade") ||
          selected === "spot" ||
          selected === "perps" ||
          selected === "trade"
        ? "trade"
        : "earn";
  // Keep existing /app/?tab=spot and /app/?tab=perps bookmarks working.
  const mode = search.get("mode");
  const tradeMode: TradeMode =
    mode === "perps" ||
    (mode !== "spot" && (selected === "perps" || selected === "trade"))
      ? "perps"
      : "spot";
  const go = (t: Tab) => {
    if (t === "trade" && tab === "trade") return;
    router.push(
      t === "portfolio" ? "/portfolio/" : t === "earn" ? "/earn/" : "/trade/",
    );
  };
  return (
    <div className={tab === "trade" ? "s-app-shell t-shell" : "s-app-shell"}>
      <nav className="s-tabs" aria-label="App sections">
        {(["earn", "trade", "portfolio"] as const).map((t) => (
          <button
            key={t}
            className={tab === t ? "is-on" : ""}
            aria-current={tab === t ? "page" : undefined}
            onClick={() => go(t)}
          >
            <TabIcon tab={t} />
            {t === "earn" ? "Earn" : t === "trade" ? "Trade" : "Portfolio"}
          </button>
        ))}
      </nav>
      {tab === "trade" && (
        <div className="t-trade-toolbar">
          <span className="t-trade-heading">Trade</span>
          <div className="t-trade-modes" role="group" aria-label="Trading mode">
            {(["spot", "perps"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={tradeMode === value}
                onClick={() => {
                  if (value !== tradeMode)
                    router.push(`/trade/?mode=${value}`, { scroll: false });
                }}
              >
                {value === "spot" ? "Spot" : "Perps"}
              </button>
            ))}
          </div>
        </div>
      )}
      {tab === "earn" ? (
        <EarnScope>
          {path.startsWith("/earn/mon") ||
          path.startsWith("/earn/usdc") ||
          search.has("asset") ||
          search.has("action") ? (
            <EarnApp />
          ) : (
            <EarnOverview />
          )}
        </EarnScope>
      ) : tab === "trade" ? (
        // Spot and Perps settle on Monad mainnet.
        <TradingScope>
          {tradeMode === "spot" ? <SpotApp /> : <App />}
        </TradingScope>
      ) : (
        <Portfolio />
      )}
    </div>
  );
}
