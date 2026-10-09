"use client";
import { useEffect, useRef } from "react";

/**
 * The hero's moving background: a field of currents in ultramarine, with
 * pulses running along a few of them, like deposits flowing to markets.
 * Pauses off screen; draws one still frame under reduced motion.
 */
export default function HeroField() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0, h = 0, raf = 0, on = true;
    const LINES = 34;
    const size = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      w = cv.clientWidth;
      h = cv.clientHeight;
      cv.width = w * dpr;
      cv.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const y = (i: number, x: number, t: number) => {
      const base = h * (0.18 + (i / LINES) * 0.95);
      const k = x / w;
      return (
        base +
        Math.sin(k * 3.1 + t * 0.00021 + i * 0.37) * h * 0.05 +
        Math.sin(k * 7.3 - t * 0.00013 + i * 0.21) * h * 0.018 -
        k * k * h * 0.22
      );
    };
    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < LINES; i++) {
        const a = 0.05 + 0.13 * Math.pow(Math.sin((i / LINES) * Math.PI), 2);
        ctx.strokeStyle = `rgba(123,136,255,${a})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = 0; x <= w; x += 12) ctx[x ? "lineTo" : "moveTo"](x, y(i, x, t));
        ctx.stroke();
        if (i % 5 === 2) {
          const px = ((t * 0.06 * (1 + (i % 3) * 0.35) + i * 97) % (w + 200)) - 100;
          const g = ctx.createRadialGradient(px, y(i, px, t), 0, px, y(i, px, t), 18);
          g.addColorStop(0, "rgba(170,180,255,0.45)");
          g.addColorStop(1, "rgba(160,170,255,0)");
          ctx.fillStyle = g;
          ctx.fillRect(px - 18, y(i, px, t) - 18, 36, 36);
        }
      }
    };
    const loop = (t: number) => {
      if (on) draw(t);
      raf = requestAnimationFrame(loop);
    };
    size();
    const ro = new ResizeObserver(() => {
      size();
      if (still) draw(4000);
    });
    ro.observe(cv);
    const io = new IntersectionObserver(([e]) => (on = e.isIntersecting));
    io.observe(cv);
    if (still) draw(4000);
    else raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, []);
  return <canvas ref={ref} className="s-stage-field" aria-hidden="true" />;
}
