"use client";

import { useEffect, useRef } from "react";

// Two pixel towers with square packets hopping between them. Packets speed up while a
// transfer is live and settle into the destination tower when it lands.
export function RouteViz({ from, to, fromHue, toHue, live }: { from: string; to: string; fromHue: number; toHue: number; live: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef(live);
  liveRef.current = live;

  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext("2d")!;
    let raf = 0;
    let w = 0;
    let h = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      w = cv.clientWidth;
      h = cv.clientHeight;
      cv.width = w * dpr;
      cv.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(cv);

    const P = 6; // pixel size
    type Pk = { t: number; v: number; lane: number };
    const packets: Pk[] = [];
    let spawn = 0;
    let last = performance.now();

    const tower = (x: number, hue: number, glow: number) => {
      const cols = 4;
      const rows = Math.floor((h - 44) / P);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const lit = (r * 7 + c * 3 + Math.floor(performance.now() / 260)) % 9 === 0;
          const a = 0.18 + (r / rows) * 0.25 + (lit ? 0.35 * glow + 0.15 : 0);
          ctx.fillStyle = `hsla(${hue} 75% 62% / ${a})`;
          ctx.fillRect(x + c * P, h - 34 - (r + 1) * P, P - 1, P - 1);
        }
      }
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ctx.clearRect(0, 0, w, h);
      const x0 = 26;
      const x1 = w - 26 - 4 * P;
      const isLive = liveRef.current;

      tower(x0, fromHue, isLive ? 1 : 0.4);
      tower(x1, toHue, isLive ? 1 : 0.4);

      // the rail
      ctx.fillStyle = "rgba(242,239,232,0.08)";
      for (let x = x0 + 5 * P; x < x1 - P; x += P * 2) ctx.fillRect(x, h / 2 - 1, P - 2, 2);

      spawn -= dt;
      if (spawn <= 0) {
        packets.push({ t: 0, v: isLive ? 0.9 + Math.random() * 0.5 : 0.18 + Math.random() * 0.1, lane: Math.floor(Math.random() * 5) - 2 });
        spawn = isLive ? 0.08 : 0.9;
      }
      for (let i = packets.length - 1; i >= 0; i--) {
        const p = packets[i];
        p.t += p.v * dt;
        if (p.t >= 1) { packets.splice(i, 1); continue; }
        const sx = x0 + 4 * P + 4;
        const ex = x1 - 4;
        const x = sx + (ex - sx) * p.t;
        const arc = Math.sin(p.t * Math.PI) * (h * 0.28);
        const y = h / 2 - arc + p.lane * P;
        const hue = fromHue + (toHue - fromHue) * p.t;
        // trail
        for (let k = 1; k < 5; k++) {
          ctx.fillStyle = `hsla(${hue} 80% 70% / ${0.14 * (5 - k) / 4})`;
          const tt = Math.max(0, p.t - k * 0.012);
          ctx.fillRect(sx + (ex - sx) * tt, h / 2 - Math.sin(tt * Math.PI) * (h * 0.28) + p.lane * P, P - 1, P - 1);
        }
        ctx.fillStyle = `hsl(${hue} 85% 76%)`;
        ctx.fillRect(Math.round(x), Math.round(y), P, P);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [fromHue, toHue]);

  return (
    <div className="viz" aria-hidden="true">
      <canvas ref={ref} />
      <div className="viz-labels">
        <span>{from} · burn</span>
        <span>{live ? "attesting" : "cctp v2"}</span>
        <span>mint · {to}</span>
      </div>
    </div>
  );
}
