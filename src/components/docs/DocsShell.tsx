"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Brand from "@/components/setsuna/Brand";
import { docs, docHref, type SearchEntry } from "@/lib/docs/catalog";

function SearchIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </svg>
  );
}
const groups = [...new Set(docs.map((d) => d.group))];

function Navigation({ close }: { close?: () => void }) {
  const path = usePathname().replace(/\/$/, "");
  return (
    <nav className="sd-navigation" aria-label="Documentation">
      {groups.map((group, index) => (
        <details className="sd-nav-group" open key={group}>
          <summary>
            <span className="sd-group-symbol" aria-hidden="true">
              {["◈", "◉", "∑", "⇄", "⌘"][index]}
            </span>
            {group}
            <span className="sd-chevron" aria-hidden="true">
              ⌄
            </span>
          </summary>
          <div>
            {docs
              .filter((d) => d.group === group)
              .map((doc) => (
                <Link
                  key={doc.slug}
                  href={docHref(doc.slug)}
                  aria-current={
                    path === docHref(doc.slug).replace(/\/$/, "")
                      ? "page"
                      : undefined
                  }
                  onClick={close}
                >
                  {doc.title}
                </Link>
              ))}
          </div>
        </details>
      ))}
      <Link href="/" className="sd-back-site" onClick={close}>
        ↖ Back to Setsuna
      </Link>
    </nav>
  );
}

export default function DocsShell({
  children,
  searchIndex,
}: {
  children: React.ReactNode;
  searchIndex: SearchEntry[];
}) {
  const path = usePathname();
  const router = useRouter();
  const search = useRef<HTMLDialogElement>(null);
  const menu = useRef<HTMLDialogElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    try {
      if (localStorage.getItem("setsuna.docs.theme") === "dark")
        setTheme("dark");
    } catch {
      /* Optional browser preference. */
    }
  }, []);
  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    try {
      localStorage.setItem("setsuna.docs.theme", next);
    } catch {
      /* Optional browser preference. */
    }
  }
  function openSearch() {
    menu.current?.close();
    setQuery("");
    setSelected(0);
    search.current?.showModal();
    searchInput.current?.focus();
  }
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        menu.current?.close();
        search.current?.showModal();
        searchInput.current?.focus();
      }
    };
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);
  useEffect(() => {
    search.current?.close();
    menu.current?.close();
  }, [path]);
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const matches = searchIndex
    .map((doc) => {
      const title = doc.title.toLowerCase(),
        body = doc.text.toLowerCase();
      return {
        ...doc,
        score: words.every((word) => `${title} ${body}`.includes(word))
          ? words.reduce(
              (sum, word) => sum + (title.includes(word) ? 10 : 1),
              0,
            )
          : -1,
      };
    })
    .filter((doc) => doc.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, words.length ? 8 : 5);
  function pick(slug: string) {
    search.current?.close();
    router.push(docHref(slug));
  }
  function excerpt(doc: SearchEntry) {
    const at = words.length ? doc.text.toLowerCase().indexOf(words[0]) : -1;
    if (at < 0) return doc.description;
    const from = Math.max(0, at - 35);
    return `${from ? "…" : ""}${doc.text.slice(from, from + 140)}…`;
  }
  return (
    <div className="sd-shell" data-theme={theme}>
      <header className="sd-header">
        <Link href="/docs/" className="sd-logo" aria-label="Setsuna Docs home">
          <Brand />
          <span className="sd-logo-divider" />
          <span className="sd-logo-label">Docs</span>
        </Link>
        <button className="sd-search-trigger" onClick={openSearch}>
          <SearchIcon />
          <span>Search documentation</span>
          <kbd>⌘ K</kbd>
        </button>
        <div className="sd-header-actions">
          <Link href="/" className="sd-website">
            Website ↗
          </Link>
          <button
            className="sd-theme"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
            title={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
          >
            {theme === "light" ? "☼" : "☾"}
          </button>
          <Link href="/app/" className="sd-open-app">
            Open app <span aria-hidden="true">↗</span>
          </Link>
          <button
            className="sd-mobile-toggle"
            aria-label="Open documentation menu"
            onClick={() => menu.current?.showModal()}
          >
            ☰
          </button>
        </div>
      </header>
      <aside className="sd-sidebar">
        <Navigation />
        <div className="sd-sidebar-note">
          <span className="sd-meta-dot" />
          <span>Built on Monad</span>
          <span className="sd-small-tag">Preview</span>
        </div>
      </aside>
      <div className="sd-page">{children}</div>
      <dialog
        ref={menu}
        className="sd-mobile-menu"
        aria-label="Documentation menu"
        onClick={(e) => {
          if (e.target === menu.current) menu.current.close();
        }}
      >
        <div className="sd-mobile-menu-top">
          <strong>Documentation</strong>
          <button
            aria-label="Close documentation menu"
            onClick={() => menu.current?.close()}
          >
            ×
          </button>
        </div>
        <Navigation close={() => menu.current?.close()} />
      </dialog>
      <dialog
        ref={search}
        className="sd-search-dialog"
        aria-label="Search documentation"
        onClick={(e) => {
          if (e.target === search.current) search.current.close();
        }}
      >
        <div className="sd-search-box">
          <SearchIcon />
          <input
            ref={searchInput}
            aria-label="Search documentation"
            placeholder="Search for vaults, withdrawals, Curvance…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setSelected((s) =>
                  Math.max(
                    0,
                    Math.min(
                      matches.length - 1,
                      s + (e.key === "ArrowDown" ? 1 : -1),
                    ),
                  ),
                );
              }
              if (e.key === "Enter" && matches[selected]) {
                e.preventDefault();
                pick(matches[selected].slug);
              }
            }}
            aria-controls="sd-search-results"
            aria-activedescendant={
              matches[selected] ? `sd-result-${selected}` : undefined
            }
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            autoComplete="off"
          />
          <button
            onClick={() => search.current?.close()}
            aria-label="Close search"
          >
            <kbd>Esc</kbd>
          </button>
        </div>
        <div className="sd-search-caption" aria-live="polite">
          {words.length
            ? `${matches.length} ${matches.length === 1 ? "result" : "results"}`
            : "Start exploring"}
        </div>
        <div id="sd-search-results" role="listbox" aria-label="Search results">
          {matches.map((doc, i) => (
            <button
              key={doc.slug}
              id={`sd-result-${i}`}
              role="option"
              aria-selected={selected === i}
              className="sd-search-result"
              onMouseMove={() => setSelected(i)}
              onClick={() => pick(doc.slug)}
            >
              <span>{doc.group}</span>
              <strong>
                {doc.title}
                <i aria-hidden="true">↗</i>
              </strong>
              <p>{excerpt(doc)}</p>
            </button>
          ))}
        </div>
        {matches.length === 0 && (
          <p className="sd-search-empty">
            No pages match “{query}”. Try “shares”, “liquidity” or a protocol
            name.
          </p>
        )}
        <footer>
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> to navigate <kbd>↵</kbd> to open
          </span>
          <span>Setsuna Docs</span>
        </footer>
      </dialog>
    </div>
  );
}
