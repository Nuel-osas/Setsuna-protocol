"use client";
import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import "@/styles/footer-rebound.css";

/**
 * Sui's footer rubber band: scrolling past the footer pulls a run of gradient
 * columns up out of the floor, the scroll gets heavier the further you go, and
 * once the wheel goes quiet the page eases back to the footer's resting point.
 *
 * Tuning (values match the reference):
 * - Pull distance: `.s-rebound` height in footer-rebound.css (30vh).
 * - Column heights: START_UNIFORM, END_SCALE, and the path data below.
 * - Resistance: LERP_START → LERP_END over the first RAMP of the pull.
 * - Return: QUIET_VELOCITY, QUIET_MS, RETURN_DURATION, RETURN_LERP.
 */
const START_UNIFORM = 0.8; // every column starts at 80% of the average height
const END_SCALE = 0.9; // and grows to 90% of its own height at full pull
const PROGRESS_CAP = 0.95; // the shape stops changing at 95% of the pull
const DOTS_START = 0.3; // dotted lines start at 30% of their average length
const DOTS_END = 0.8; // and reach 80% of their own length
const PAGE_LERP = 0.12; // Lenis smoothing for the rest of the page
const LERP_START = 0.15; // smoothing as the pull begins
const LERP_END = 0.05; // smoothing once RAMP of the pull is reached: lower feels heavier
const RAMP = 0.1;
const QUIET_VELOCITY = 50; // px/s under which the page counts as at rest
const QUIET_MS = 45; // how long it must stay under that before returning
const RETURN_DURATION = 1.1;
const RETURN_LERP = 0.12;
const LERP_AFTER_RETURN = 0.08;
const LERP_ON_REENTER = 0.1;

const BLOCKS = [
  { o: 0.8, d: "M634.196 152.52H846.378V535.131H634.196V222.52Z" },
  { o: 0.8, d: "M423 221.6H635V535H423V277Z" },
  { o: 0.6, d: "M211.583 284.416H423.765V535.131H211.583V330.52Z" },
  { o: 0.4, d: "M0.275879 355.52H212.458V535.131H0.275879V402.52Z" },
  { o: 0.8, d: "M1058.23 221.6H846.052V535.131H1058.23V276.52Z" },
  { o: 0.6, d: "M1269.54 284.416H1057.36V535.131H1269.54V330.52Z" },
  { o: 0.4, d: "M1480.85 355.52H1268.67V535.131H1480.85V402.52Z" },
];
const DOTS = [
  { g: 3, d: "M1269.54 238.676L1269.54 541.232" },
  { g: 2, d: "M1058.23 156.064V541.232" },
  { g: 1, d: "M846.928 0.597656V541.232" },
  { g: 1, d: "M635.621 0.597656V541.232" },
  { g: 2, d: "M424.314 156.064V541.232" },
  { g: 3, d: "M213.007 238.676L213.007 541.232" },
];

// Pixel variant: an ink skyline rising out of the landing wall's blue floor, on the
// wall's own grid. Column c mirrors wall column 31 - c, one cell shorter so the
// top row stays blue and the seam disappears.
const PIXEL_COLS = 32;
const wallHeight = (c: number) => 2 + ((c * 37 + (c >> 2) * 11) % 5) + (c % 7 === 3 ? 1 : 0);
const pixelTarget = (c: number, cols = PIXEL_COLS) => wallHeight(cols - 1 - c) - 1;
const INK = "#07080c";
const LIT = "#7b88ff";

const BLOCK_RE = /^M\s*([-\d.]+)\s*([-\d.]+)\s*H\s*([-\d.]+)\s*V\s*([-\d.]+)\s*H\s*([-\d.]+)\s*V\s*([-\d.]+)\s*Z$/i;

// Safari 18 and earlier render the mix-blend-mode overlay badly, so it is skipped there.
function oldSafari() {
  const ua = navigator.userAgent;
  if (!/^((?!chrome|android).)*safari/i.test(ua)) return false;
  const v = ua.match(/version\/(\d+)/i);
  return v ? parseInt(v[1], 10) <= 18 : false;
}

/** Animated film grain over the graphic: four frames of random black pixels, cycled each frame. */
function startNoise(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};
  let frames: ImageData[] = [];
  let frame = Math.floor(Math.random() * 4);
  let raf = 0;
  let visible = false;
  const make = (w: number, h: number) => {
    const img = ctx.createImageData(w, h);
    const px = new Uint32Array(img.data.buffer);
    for (let i = 0; i < px.length; i++) px[i] = Math.random() < 0.5 ? 0xff000000 : 0;
    return img;
  };
  const size = () => {
    const w = canvas.offsetWidth || 100;
    const h = canvas.offsetHeight || 100;
    canvas.width = w;
    canvas.height = h;
    frames = Array.from({ length: 4 }, () => make(w, h));
  };
  const draw = () => {
    frame = (frame + 1) % 4;
    if (frames[frame]) ctx.putImageData(frames[frame], 0, 0);
    raf = visible ? requestAnimationFrame(draw) : 0;
  };
  // The reference draws every frame forever; this only runs while the graphic is on screen.
  const io = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible && !raf) raf = requestAnimationFrame(draw);
  });
  let timer: ReturnType<typeof setTimeout>;
  const resize = () => {
    clearTimeout(timer);
    timer = setTimeout(size, 200);
  };
  size();
  io.observe(canvas);
  addEventListener("resize", resize);
  return () => {
    cancelAnimationFrame(raf);
    clearTimeout(timer);
    io.disconnect();
    removeEventListener("resize", resize);
  };
}

/** Draws the pixel variant at a pull progress; returns a resize hook. */
function pixelRenderer(canvas: HTMLCanvasElement, cols = PIXEL_COLS) {
  const ctx = canvas.getContext("2d")!;
  let w = 0;
  let h = 0;
  let cell = 0;
  let rows = 0;
  const size = () => {
    const dpr = Math.min(2, devicePixelRatio || 1);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cell = w / cols;
    rows = Math.floor(h / cell);
  };
  const draw = (progress: number) => {
    ctx.clearRect(0, 0, w, h);
    if (progress <= 0) return;
    // Like the reference: everything starts level, then each column heads for its own height.
    const t = Math.min(progress, PROGRESS_CAP) / PROGRESS_CAP;
    for (let c = 0; c < cols; c++) {
      const target = Math.min(pixelTarget(c, cols), rows - 1);
      const n = Math.max(1, Math.round(gsap.utils.interpolate(START_UNIFORM, target, t)));
      const x = Math.round(c * cell);
      const cw = Math.round((c + 1) * cell) - x;
      const top = Math.round(h - n * cell);
      ctx.fillStyle = INK;
      ctx.fillRect(x, top, cw, h - top);
      // A lit cell caps every few columns once they are tall, echoing the wall's flashing tops.
      if (c % 4 === 1 && n >= 2 && n === target) {
        ctx.fillStyle = LIT;
        ctx.fillRect(x, Math.round(top - cell), cw, Math.round(cell));
      }
    }
  };
  size();
  return { draw, size };
}

// Touch version (phones, home page only). Lenis is not used: scrolling stays native
// and only a pull past the bottom is handled. The wall shows 16 columns there.
const TOUCH_COLS = 16;
const TOUCH_MAX = 0.3; // pull distance as a share of the viewport, like the desktop strip
const TOUCH_GIVE = 1.1; // resistance: higher lets the finger travel further before the pull tops out
const TOUCH_RETURN = 0.8; // seconds to spring back after release

/**
 * At the bottom of the page, pulling up lifts the page and raises the pixel
 * skyline underneath, with resistance; letting go springs it back. iOS's own
 * bounce is blocked only during this pull, so pull-to-refresh is unaffected.
 */
function useTouchRebound(enabled: boolean, strip: React.RefObject<HTMLDivElement | null>, canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  useEffect(() => {
    const el = strip.current;
    const canvas = canvasRef.current;
    const page = document.querySelector<HTMLElement>("main#main");
    if (!enabled || !el || !canvas || !page) return;
    if (innerWidth > 768 || !("ontouchstart" in window) || matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // Sized from innerHeight rather than vh, which on phones ignores the browser bars.
    let max = innerHeight * TOUCH_MAX;
    canvas.style.height = `${max}px`;
    const pixel = pixelRenderer(canvas, TOUCH_COLS);
    const state = { pull: 0 };
    let startY: number | null = null;
    let lastY = 0;
    let tween: gsap.core.Tween | undefined;

    const apply = () => {
      // Whole pixels, or the wall's cell rows show hairline seams while it moves.
      const p = Math.round(state.pull);
      el.style.height = `${p}px`;
      page.style.transform = p ? `translate3d(0, ${-p}px, 0)` : "";
      pixel.draw(p / max);
    };
    const atBottom = () => scrollY + innerHeight >= document.documentElement.scrollHeight - 2;

    const onStart = (e: TouchEvent) => {
      tween?.kill();
      lastY = e.touches[0].clientY;
      // Keep any pull still springing back, so a second pull picks up where it is.
      startY = atBottom() ? lastY + (state.pull ? invert(state.pull) : 0) : null;
    };
    // Rubber band: the pull approaches max as the finger travels, never past it.
    const band = (d: number) => max * (1 - Math.exp(-d / (max * TOUCH_GIVE)));
    const invert = (p: number) => -max * TOUCH_GIVE * Math.log(1 - Math.min(p, max * 0.999) / max);
    const onMove = (e: TouchEvent) => {
      const y = e.touches[0].clientY;
      // A fling can reach the bottom mid-gesture; start the pull from there.
      if (startY === null && atBottom() && y < lastY) startY = y;
      lastY = y;
      if (startY === null) return;
      const d = startY - y;
      if (d <= 0) {
        if (state.pull) {
          state.pull = 0;
          apply();
        }
        return;
      }
      e.preventDefault(); // our pull, not the browser's bounce
      state.pull = band(d);
      apply();
    };
    const onEnd = () => {
      startY = null;
      if (!state.pull) return;
      tween = gsap.to(state, { pull: 0, duration: TOUCH_RETURN, ease: "power4.out", onUpdate: apply });
    };
    const onResize = () => {
      max = innerHeight * TOUCH_MAX;
      canvas.style.height = `${max}px`;
      pixel.size();
    };

    addEventListener("touchstart", onStart, { passive: true });
    addEventListener("touchmove", onMove, { passive: false });
    addEventListener("touchend", onEnd);
    addEventListener("touchcancel", onEnd);
    addEventListener("resize", onResize);
    return () => {
      tween?.kill();
      removeEventListener("touchstart", onStart);
      removeEventListener("touchmove", onMove);
      removeEventListener("touchend", onEnd);
      removeEventListener("touchcancel", onEnd);
      removeEventListener("resize", onResize);
      state.pull = 0;
      el.style.height = "";
      page.style.transform = "";
    };
  }, [enabled, strip, canvasRef]);
}

export default function FooterRebound({ variant = "gradient" }: { variant?: "gradient" | "pixel" }) {
  const root = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const noiseRef = useRef<HTMLCanvasElement>(null);
  const pixelRef = useRef<HTMLCanvasElement>(null);
  const touchRef = useRef<HTMLDivElement>(null);
  const touchCanvasRef = useRef<HTMLCanvasElement>(null);
  useTouchRebound(variant === "pixel", touchRef, touchCanvasRef);

  useEffect(() => {
    const stopNoise = noiseRef.current ? startNoise(noiseRef.current) : () => {};
    const svg = svgRef.current;
    const pixels = pixelRef.current;
    // Desktop only, decided once on load as in the reference (≤768px stays static).
    if (!root.current || (!svg && !pixels) || innerWidth <= 768 || matchMedia("(prefers-reduced-motion: reduce)").matches)
      return stopNoise;

    gsap.registerPlugin(ScrollTrigger);
    const lenis = new Lenis({ lerp: PAGE_LERP, syncTouch: true, autoRaf: false });
    const tick = (time: number) => lenis.raf(time * 1000);
    lenis.on("scroll", ScrollTrigger.update);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);

    const pixel = pixels ? pixelRenderer(pixels) : null;
    const host = svg ?? document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const blockEls = Array.from(host.querySelectorAll<SVGPathElement>(".s-rebound-blocks path"));
    const dotEls = Array.from(host.querySelectorAll<SVGPathElement>(".s-rebound-dots path"));
    const blocks = blockEls.map((el) => {
      const m = el.getAttribute("d")!.trim().replace(/\s+/g, " ").match(BLOCK_RE);
      if (!m) return null;
      const [x1, top, x2, bottom] = [m[1], m[2], m[3], m[4]].map(parseFloat);
      return { el, height: bottom - top, bottom, d: (y: number) => `M${x1} ${y}H${x2}V${bottom}H${x1}V${y}Z` };
    });
    const dots = dotEls.map((el) => {
      const n = el.getAttribute("d")!.match(/[-\d.]+/g);
      if (!n || n.length < 3) return null;
      const x = parseFloat(n[0]);
      const top = parseFloat(n[1]);
      const bottom = parseFloat(n[n.length - 1]);
      return { el, length: bottom - top, bottom, d: (y: number) => `M${x} ${y}L${x} ${bottom}` };
    });
    const valid = <T,>(a: (T | null)[]) => a.filter((v): v is T => v !== null);

    // Each block is cloned with a transparent→blue gradient blended in "color" mode, except on old Safari.
    const group = host.querySelector(".s-rebound-blocks");
    const overlays = !group || oldSafari()
      ? []
      : blockEls.map((el) => {
          const clone = el.cloneNode(true) as SVGPathElement;
          clone.setAttribute("fill", "url(#s-rebound-overlay)");
          clone.removeAttribute("opacity");
          clone.style.mixBlendMode = "color";
          group!.appendChild(clone);
          return clone;
        });

    const okBlocks = valid(blocks);
    const okDots = valid(dots);
    const avgHeight = okBlocks.reduce((s, b) => s + b.height, 0) / (okBlocks.length || 1);
    const startHeight = START_UNIFORM * avgHeight;
    const dotStart = DOTS_START * (okDots.reduce((s, d) => s + d.length, 0) / (okDots.length || 1));

    const render = (progress: number) => {
      if (pixel) return pixel.draw(progress);
      const t = Math.min(progress, PROGRESS_CAP);
      blocks.forEach((b, i) => {
        if (!b) return;
        const y = b.bottom - gsap.utils.interpolate(startHeight, b.height * END_SCALE, t);
        b.el.setAttribute("d", b.d(y));
        overlays[i]?.setAttribute("d", b.d(y));
      });
      dots.forEach((d) => {
        if (!d) return;
        const len = t === 0 ? dotStart : gsap.utils.interpolate(dotStart, d.length * DOTS_END, t);
        d.el.setAttribute("d", d.d(d.bottom - len));
      });
    };
    render(0);

    let timer: ReturnType<typeof setTimeout> | undefined;
    let returning = false;
    const trigger = ScrollTrigger.create({
      trigger: root.current,
      start: "top bottom", // the footer's resting position
      end: "bottom bottom", // fully pulled
      scrub: true,
      invalidateOnRefresh: true,
      refreshPriority: -1, // after the landing page's pins, which move this down the page
      onEnter: () => render(0),
      onEnterBack: () => {
        lenis.options.lerp = LERP_ON_REENTER;
        render(0);
      },
      onLeaveBack: () => {
        clearTimeout(timer);
        render(0);
      },
      onUpdate: (self) => {
        const ramp = Math.min(1, self.progress / RAMP);
        // Resistance: Lenis follows the wheel more lazily the further you pull.
        lenis.options.lerp = gsap.utils.interpolate(LERP_START, LERP_END, ramp);
        lenis.options.duration = gsap.utils.interpolate(0.6, 0.5, ramp);
        render(self.progress);
        clearTimeout(timer);
        if (returning || Math.abs(self.getVelocity()) >= QUIET_VELOCITY) return;
        timer = setTimeout(() => {
          if (Math.abs(self.getVelocity()) >= QUIET_VELOCITY) return;
          returning = true;
          lenis.scrollTo(self.start, {
            duration: RETURN_DURATION,
            lerp: RETURN_LERP,
            lock: true,
            onComplete: () => {
              render(0);
              returning = false;
              lenis.options.lerp = LERP_AFTER_RETURN;
            },
          });
        }, QUIET_MS);
      },
    });
    const onRefreshInit = () => {
      clearTimeout(timer);
      pixel?.size();
      render(0);
    };
    ScrollTrigger.addEventListener("refreshInit", onRefreshInit);

    return () => {
      clearTimeout(timer);
      ScrollTrigger.removeEventListener("refreshInit", onRefreshInit);
      trigger.kill();
      overlays.forEach((o) => o.remove());
      blocks.forEach((b, i) => b && b.el.setAttribute("d", BLOCKS[i].d));
      dots.forEach((d, i) => d && d.el.setAttribute("d", DOTS[i].d));
      gsap.ticker.remove(tick);
      gsap.ticker.lagSmoothing(500, 33);
      lenis.destroy();
      stopNoise();
    };
  }, []);

  if (variant === "pixel")
    return (
      <>
        <div className="s-rebound is-pixel" ref={root} aria-hidden="true">
          <canvas ref={pixelRef} className="s-rebound-pixels" />
        </div>
        <div className="s-rebound-touch" ref={touchRef} aria-hidden="true">
          <canvas ref={touchCanvasRef} />
        </div>
      </>
    );

  return (
    <div className="s-rebound" ref={root} aria-hidden="true">
      <div className="s-rebound-expander">
        <svg ref={svgRef} className="s-rebound-graphic" width="100%" viewBox="0 0 1481 535" fill="none">
          <defs>
            {/* Column fill: fades in from the footer, Setsuna blue at 70%, light at the floor. */}
            <linearGradient id="s-rebound-fill" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#07080c" stopOpacity="0" />
              <stop offset="70%" stopColor="#2338ff" />
              <stop offset="100%" stopColor="#f2efe8" />
            </linearGradient>
            <linearGradient id="s-rebound-overlay" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#2338ff" stopOpacity="0" />
              <stop offset="100%" stopColor="#2338ff" stopOpacity="1" />
            </linearGradient>
            {[0, 20, 40].map((y, i) => (
              <linearGradient key={y} id={`s-rebound-stroke${i + 1}`} x1="0%" y1={`${y}%`} x2="0" y2="100%" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#f2efe8" stopOpacity="0" />
                <stop offset="100%" stopColor="#f2efe8" stopOpacity="1" />
              </linearGradient>
            ))}
          </defs>
          <g className="s-rebound-blocks">
            {BLOCKS.map((b) => (
              <path key={b.d} d={b.d} opacity={b.o} fill="url(#s-rebound-fill)" />
            ))}
          </g>
          <g className="s-rebound-dots">
            {DOTS.map((d) => (
              <path key={d.d} d={d.d} stroke={`url(#s-rebound-stroke${d.g})`} strokeWidth="2" strokeDasharray="2 10" fill="none" />
            ))}
          </g>
        </svg>
        <canvas ref={noiseRef} className="s-rebound-noise" />
      </div>
    </div>
  );
}
