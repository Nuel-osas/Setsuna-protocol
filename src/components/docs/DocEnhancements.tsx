"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Mark } from "@/components/setsuna/Brand";
import type { DocHeading } from "@/lib/docs/catalog";

export function DocActions({ source }: { source: string }) {
  const [message, setMessage] = useState("Copy page");
  const path = usePathname();
  useEffect(() => setMessage("Copy page"), [source]);
  useEffect(() => {
    if (message === "Copy page") return;
    const timeout = window.setTimeout(() => setMessage("Copy page"), 2500);
    return () => window.clearTimeout(timeout);
  }, [message]);
  useEffect(() => {
    const listener = async (event: MouseEvent) => {
      const target =
        event.target instanceof Element
          ? event.target.closest<HTMLButtonElement>("[data-copy-code]")
          : null;
      if (!target) return;
      const code = target
        .closest(".sd-code")
        ?.querySelector("code")?.textContent;
      if (!code) return;
      try {
        await navigator.clipboard.writeText(code);
        target.textContent = "Copied";
      } catch {
        target.textContent = "Select to copy";
      }
    };
    document.addEventListener("click", listener);
    return () => document.removeEventListener("click", listener);
  }, [path]);
  return (
    <button
      type="button"
      className="sd-copy-page"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(source);
          setMessage("Copied");
        } catch {
          setMessage("Copy unavailable");
        }
      }}
      aria-label="Copy page as Markdown"
      title={message === "Copy page" ? "Copy page as Markdown" : message}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {message === "Copied" ? (
          <path d="m5 12 4 4L19 6" />
        ) : message === "Copy unavailable" ? (
          <>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v6m0 4h.01" />
          </>
        ) : (
          <>
            <rect x="9" y="9" width="12" height="12" rx="2" />
            <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
          </>
        )}
      </svg>
      <span aria-live="polite" aria-atomic="true">{message}</span>
    </button>
  );
}

export function DocContents({ headings }: { headings: DocHeading[] }) {
  const [active, setActive] = useState("");
  useEffect(() => {
    const nodes = headings
      .map((h) => document.getElementById(h.id))
      .filter((x): x is HTMLElement => !!x);
    const update = () => {
      const past = nodes.filter(
        (node) => node.getBoundingClientRect().top <= 155,
      );
      setActive((past.at(-1) ?? nodes[0])?.id ?? "");
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [headings]);
  return (
    <aside className="sd-contents">
      <nav aria-label="On this page">
        <h2>On this page</h2>
        {headings
          .filter((h) => h.depth === 2)
          .map((heading) => (
            <a
              key={heading.id}
              href={`#${heading.id}`}
              aria-current={active === heading.id ? "location" : undefined}
            >
              {heading.text}
            </a>
          ))}
      </nav>
      <div className="sd-toc-help">
        <span>Keep exploring</span>
        <Link href="/docs/getting-started/faq/">Questions? Start here ↗</Link>
        <Link href="/docs/developers/local-demo/">Try the local demo ↗</Link>
      </div>
    </aside>
  );
}

export function VaultIllustration() {
  return (
    <div
      className="sd-vault-illustration"
      aria-label="Deposit MON or USDC, receive Setsuna vault shares, and earn lending interest"
    >
      <div className="sd-flow-label">LESS TO MANAGE. MORE IN MOTION.</div>
      <div className="sd-flow">
        <div className="sd-flow-node">
          <span className="sd-token-pair">
            <b>M</b>
            <b>$</b>
          </span>
          <strong>One deposit</strong>
          <small>MON or USDC</small>
        </div>
        <span className="sd-flow-line" aria-hidden="true" />
        <div className="sd-flow-vault">
          <Mark size={40} />
          <strong>Setsuna</strong>
          <small>Transparent onchain rules</small>
        </div>
        <span className="sd-flow-line" aria-hidden="true" />
        <div className="sd-flow-node">
          <span className="sd-yield-glyph" aria-hidden="true">
            ↗
          </span>
          <strong>Your share of the yield</strong>
          <small>setsMON or setsUSDC</small>
        </div>
      </div>
    </div>
  );
}

export function ShareCalculator() {
  const [deposit, setDeposit] = useState("1000");
  const [change, setChange] = useState("5");
  const amount = Number(deposit),
    percent = Number(change);
  const valid =
    deposit !== "" &&
    change !== "" &&
    Number.isFinite(amount) &&
    amount >= 0 &&
    amount <= 1000000 &&
    Number.isFinite(percent) &&
    percent >= -99 &&
    percent <= 100;
  return (
    <section className="sd-calculator" aria-labelledby="share-example-title">
      <span className="sd-calculator-label">EXPLORE THE MATH</span>
      <h2 id="share-example-title">The balance stays. The value moves.</h2>
      <p>
        An illustration at an initial price of 1 USDC per share, ignoring
        base-unit rounding. This is a change in vault value, not an APR or
        forecast.
      </p>
      <div className="sd-calculator-inputs">
        <label>
          Deposit (USDC)
          <input
            type="number"
            min="0"
            max="1000000"
            value={deposit}
            onChange={(e) => setDeposit(e.target.value)}
          />
        </label>
        <label>
          Change in vault value (%)
          <input
            type="number"
            min="-99"
            max="100"
            value={change}
            onChange={(e) => setChange(e.target.value)}
          />
        </label>
      </div>
      <div className="sd-calculator-results" aria-live="polite">
        <div>
          <small>Shares held</small>
          <strong>
            {valid
              ? amount.toLocaleString("en-US", { maximumFractionDigits: 2 })
              : "—"}
          </strong>
          <span>setsUSDC</span>
        </div>
        <div>
          <small>Value of your shares</small>
          <strong>
            {valid
              ? (amount * (1 + percent / 100)).toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })
              : "—"}
          </strong>
          <span>USDC, before withdrawal limits</span>
        </div>
      </div>
      {!valid && (
        <p role="alert">
          Enter a deposit from 0 to 1,000,000 and a value change from −99% to
          100%.
        </p>
      )}
    </section>
  );
}
