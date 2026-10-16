"use client";
import { useEffect, useRef } from "react";

const COLORS = ["#2338ff", "#4a5cff", "#7b88ff", "#b9c2ff", "#f2efe8"];
const LINE = "rgba(242, 239, 232, 0.07)";

type Cell = { x: number; y: number; color: string; alpha: number; fade: number };

/**
 * Walrus's hover grid, retuned for Setsuna: cells light up under the pointer in
 * the blue range and fade out; touch screens get a slow random shimmer instead.
 */
export default function PixelGrid() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const host = canvas?.parentElement;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !host || !ctx) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const touch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    let cells: Cell[] = [];
    // Cells the touch shimmer may light: none under the headline or copy, so
    // the squares never sit on top of words.
    let open: Cell[] = [];
    let size = 0;
    let cols = 0;
    let raf = 0;
    let last = -1;
    let stroke = 0;
    let color = COLORS[0];
    let visible = true;

    const layout = () => {
      const dpr = Math.min(2, devicePixelRatio || 1);
      const w = host.offsetWidth;
      const h = host.offsetHeight;
      cols = w < 768 ? 9 : 22;
      size = w / cols;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const rows = Math.ceil(h / size);
      cells = [];
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) cells.push({ x: c * size, y: r * size, color: COLORS[0], alpha: 0, fade: 0 });
      quiet();
      draw(performance.now());
    };

    const quiet = () => {
      const box = host.getBoundingClientRect();
      const text = [...host.querySelectorAll(".lx-hero-copy > :is(p, h1)")].map((el) => {
        const r = el.getBoundingClientRect();
        return { l: r.left - box.left, t: r.top - box.top, r: r.right - box.left, b: r.bottom - box.top };
      });
      open = cells.filter((c) => !text.some((t) => c.x < t.r && c.x + size > t.l && c.y < t.b && c.y + size > t.t));
    };

    const draw = (now: number) => {
      raf = 0;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let active = false;
      for (const cell of cells) {
        if (cell.alpha > 0) {
          // Hold briefly at full strength, then ease out over ~1.6s.
          const age = now - cell.fade;
          cell.alpha = age < 350 ? 1 : Math.max(0, 1 - (age - 350) / 1600);
          ctx.globalAlpha = cell.alpha * 0.9;
          ctx.fillStyle = cell.color;
          ctx.fillRect(cell.x, cell.y, size, size);
          active ||= cell.alpha > 0;
        }
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = LINE;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= canvas.width; x += size) {
        ctx.moveTo(Math.round(x) + 0.5, 0);
        ctx.lineTo(Math.round(x) + 0.5, canvas.height);
      }
      for (let y = 0; y <= canvas.height; y += size) {
        ctx.moveTo(0, Math.round(y) + 0.5);
        ctx.lineTo(canvas.width, Math.round(y) + 0.5);
      }
      ctx.stroke();
      if (active) raf = requestAnimationFrame(draw);
    };

    const light = (cell: Cell, c: string) => {
      cell.color = c;
      cell.alpha = 1;
      cell.fade = performance.now();
      if (!raf && visible) raf = requestAnimationFrame(draw);
    };

    const move = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (x < 0 || y < 0 || x > rect.width || y > rect.height) return (last = -1);
      const i = Math.floor(y / size) * cols + Math.floor(x / size);
      const cell = cells[i];
      if (!cell || i === last) return;
      // Like the source, the colour changes every few cells so a stroke reads as one gesture.
      if (stroke++ % 5 === 0) color = COLORS[Math.floor(Math.random() * COLORS.length)];
      light(cell, color);
      last = i;
    };

    const observer = new IntersectionObserver(([entry]) => (visible = entry.isIntersecting));
    observer.observe(host);
    layout();
    // Web fonts change the copy's size once they load.
    document.fonts?.ready.then(quiet);
    const resize = () => layout();
    addEventListener("resize", resize);
    let timer: ReturnType<typeof setInterval> | undefined;
    if (!reduced) {
      if (touch)
        timer = setInterval(() => {
          if (!visible || !open.length) return;
          light(open[Math.floor(Math.random() * open.length)], COLORS[Math.floor(Math.random() * COLORS.length)]);
        }, 180);
      else addEventListener("pointermove", move, { passive: true });
    }
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(timer);
      observer.disconnect();
      removeEventListener("resize", resize);
      removeEventListener("pointermove", move);
    };
  }, []);

  return <canvas ref={ref} className="lx-grid" aria-hidden="true" />;
}
