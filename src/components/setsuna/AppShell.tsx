"use client";
import { useEffect, useState } from "react";
import EarnApp from "./EarnApp";
import App from "./App";
import SpotApp from "./SpotApp";

type Tab = "earn" | "spot" | "perps";

export default function AppShell() {
  const [tab, setTab] = useState<Tab>("earn");
  useEffect(() => {
    const selected = new URLSearchParams(window.location.search).get("tab");
    if (selected === "trade" || selected === "perps") setTab("perps");
    if (selected === "spot") setTab("spot");
  }, []);
  const go = (t: Tab) => {
    setTab(t);
    const url = new URL(window.location.href);
    if (t === "earn") url.searchParams.delete("tab");
    else url.searchParams.set("tab", t);
    window.history.replaceState(null, "", url);
  };
  return (
    <div className={tab === "earn" ? "s-app-shell" : "s-app-shell t-shell"}>
      <nav className="s-tabs" aria-label="App sections">
        {(["earn", "spot", "perps"] as const).map((t) => (
          <button
            key={t}
            className={tab === t ? "is-on" : ""}
            aria-current={tab === t ? "page" : undefined}
            onClick={() => go(t)}
          >
            {t === "earn" ? "Earn" : t === "spot" ? "Spot" : "Perps"}
          </button>
        ))}
      </nav>
      {tab === "earn" ? <EarnApp /> : tab === "spot" ? <SpotApp /> : <App />}
    </div>
  );
}
