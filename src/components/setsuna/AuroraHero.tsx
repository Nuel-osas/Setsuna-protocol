"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";
import FlowSculpture from "./FlowSculpture";

export default function AuroraHero() {
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    const update = () => {
      frame = 0;
      const progress = motion.matches
        ? 0
        : Math.min(
            1,
            Math.max(
              0,
              -element.getBoundingClientRect().top / (innerHeight * 0.8),
            ),
          );
      element.style.setProperty("--hero-progress", String(progress));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    addEventListener("scroll", schedule, { passive: true });
    addEventListener("resize", schedule);
    motion.addEventListener("change", schedule);
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener("scroll", schedule);
      removeEventListener("resize", schedule);
      motion.removeEventListener("change", schedule);
    };
  }, []);
  return (
    <section ref={root} className="m-hero" aria-labelledby="hero-title">
      <div className="m-hero-frame">
        <div className="m-aurora" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <div className="m-hero-grid" aria-hidden="true" />
        <div className="m-hero-copy">
          <span className="m-kicker">
            <i className="m-monad-symbol" /> Built on Monad <span>•</span> Made
            for your next move
          </span>
          <h1 id="hero-title">
            Put your assets
            <br />
            <em>in motion.</em>
          </h1>
          <p>
            One deposit. Transparent rules.
            <br className="m-mobile-break" /> More room to earn.
            <br />
            Let Setsuna put your MON and USDC to work.
          </p>
          <div className="m-hero-actions">
            <Link className="m-button m-button-light" href="/app/">
              Explore Earn <span aria-hidden="true">↗</span>
            </Link>
            <a className="m-text-link" href="#how">
              See how it works <span aria-hidden="true">↓</span>
            </a>
          </div>
        </div>
        <div className="m-hero-art">
          <div className="m-orbit m-orbit-one" />
          <div className="m-orbit m-orbit-two" />
          <FlowSculpture />
          <span className="m-asset-tag m-asset-mon">
            <i className="m-token m-token-mon">M</i> MON <span>→ setsMON</span>
          </span>
          <span className="m-asset-tag m-asset-usdc">
            <i className="m-token m-token-usdc">$</i> USDC{" "}
            <span>→ setsUSDC</span>
          </span>
        </div>
        <div className="m-hero-bottom">
          <span>
            <i /> Development preview · local demo available
          </span>
          <a href="#flow" aria-label="Discover Setsuna">
            Scroll to discover <span aria-hidden="true">↓</span>
          </a>
        </div>
      </div>
    </section>
  );
}
