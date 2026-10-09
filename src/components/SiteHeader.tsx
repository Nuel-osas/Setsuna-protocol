"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Brand from "@/components/setsuna/Brand";
import { useWallet } from "@/components/setsuna/WalletProvider";
import { shortAddress } from "@/lib/setsuna/format";
import { productLinks } from "@/lib/setsuna/site";

export default function SiteHeader() {
  const path = usePathname();
  const app = path.startsWith("/app");
  const wallet = useWallet();
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
          <button className="s-btn is-small" onClick={wallet.openConnect}>
            {wallet.address ? shortAddress(wallet.address) : "Connect"}
          </button>
        ) : (
          <Link className="s-btn is-small is-primary" href="/app/">
            Open app <span aria-hidden="true">↗</span>
          </Link>
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
