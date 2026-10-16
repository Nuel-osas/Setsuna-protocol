"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Brand from "@/components/setsuna/Brand";
import AccountMenu from "@/components/setsuna/AccountMenu";
import { productLinks } from "@/lib/setsuna/site";
import { X_URL } from "@/lib/setsuna/seo";

export default function SiteHeader() {
  const path = usePathname();
  const app =
    path.startsWith("/app") ||
    path.startsWith("/trade") ||
    path.startsWith("/portfolio") ||
    path.startsWith("/earn");
  const [open, setOpen] = useState(false);
  const [over, setOver] = useState(path === "/");
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    // Transparent over the home hero, solid once the hero scrolls away.
    const stage = path === "/" ? document.querySelector(".m-hero-frame") : null;
    if (!stage) return setOver(false);
    const check = () => setOver(stage.getBoundingClientRect().bottom > 72);
    check();
    addEventListener("scroll", check, { passive: true });
    return () => removeEventListener("scroll", check);
  }, [path]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, []);
  if (path === "/docs" || path.startsWith("/docs/")) return null;
  return (
    <header
      className={`s-header ${app ? "is-app" : ""} ${open ? "is-open" : ""} ${over && !open ? "is-over" : ""}`}
    >
      <Link className="s-home" href="/" aria-label="Setsuna home">
        <Brand />
      </Link>
      <nav aria-label="Primary" id="s-nav">
        {productLinks.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            onClick={() => setOpen(false)}
            aria-current={
              path.startsWith(l.href.slice(0, -1)) ? "page" : undefined
            }
          >
            {l.label}
          </Link>
        ))}
      </nav>
      <div className="s-header-end">
        {app ? (
          <AccountMenu />
        ) : (
          <>
            <a className="s-x-link" href={X_URL} target="_blank" rel="noopener noreferrer" aria-label="Setsuna on X">
              <svg viewBox="0 0 16 15" aria-hidden="true">
                <path d="M12.32.62h2.36L9.53 6.56l6.09 8.05H10.83L7.1 9.73l-4.29 4.88H.45l5.53-6.34L.14.62h4.91l3.39 4.48L12.32.62Zm-.84 12.56h1.31L4.34 1.96H2.91l8.57 11.22Z" />
              </svg>
            </a>
            <Link className="s-btn is-small is-primary" href="/app/">
              Open app <span aria-hidden="true">↗</span>
            </Link>
          </>
        )}
        <button
          className="s-menu"
          aria-expanded={open}
          aria-controls="s-nav"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen(!open)}
        >
          <span />
          <span />
        </button>
      </div>
    </header>
  );
}
