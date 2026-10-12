"use client";
import { useEffect, useRef } from "react";

const vertex = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

// A grid of fine dots on near-black. A slow glow wanders under the flow
// diagram, and the cursor lights, enlarges and nudges the dots around it.
const fragment = `
precision highp float;
uniform vec2 uSize;
uniform float uTime;
uniform float uGap;
uniform float uScale;
uniform vec2 uMouse;
uniform float uHover;

float glow(vec2 q, float t) {
  vec2 a = (q - vec2(0.5 + 0.12 * sin(t * 0.09), 0.92)) / vec2(0.42, 0.34);
  vec2 b = (q - vec2(0.18 + 0.06 * cos(t * 0.07), 0.62 + 0.05 * sin(t * 0.05))) / vec2(0.22, 0.26);
  vec2 c = (q - vec2(0.84 + 0.05 * sin(t * 0.06 + 2.0), 0.70)) / vec2(0.20, 0.24);
  return 0.85 * exp(-dot(a, a)) + 0.35 * exp(-dot(b, b)) + 0.30 * exp(-dot(c, c));
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uSize.y - gl_FragCoord.y);
  vec2 cell = floor(p / uGap);
  vec2 centre = (cell + 0.5) * uGap;

  // The cursor pushes nearby dots outward and lights them.
  vec2 away = centre - uMouse;
  float reach = 150.0 * uScale;
  float near = uHover * exp(-dot(away, away) / (reach * reach));
  centre += normalize(away + 0.0001) * uGap * 0.45 * near;

  float field = glow(centre / uSize, uTime);
  float light = clamp(0.10 + 0.75 * field + 0.9 * near, 0.0, 1.0);

  float radius = (0.7 + 1.5 * light) * uScale;
  float disc = 1.0 - smoothstep(radius - 0.75 * uScale, radius + 0.75 * uScale, length(p - centre));

  vec3 base = vec3(0.016, 0.019, 0.040);
  vec3 haze = vec3(0.030, 0.045, 0.150) * field * 0.55;
  vec3 dim = vec3(0.20, 0.23, 0.36);
  vec3 lit = mix(vec3(0.20, 0.32, 1.00), vec3(0.78, 0.83, 1.00), smoothstep(0.75, 1.0, light));
  vec3 ink = mix(dim, lit, smoothstep(0.15, 0.85, light));
  vec3 col = base + haze + ink * disc * (0.25 + 0.75 * light);

  // Fade toward the top and sides so the headline sits on black.
  vec2 v = (gl_FragCoord.xy / uSize - vec2(0.5, 0.35)) * vec2(1.0, 1.25);
  col *= 1.0 - 0.5 * dot(v, v);
  gl_FragColor = vec4(col, 1.0);
}
`;

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  gl.deleteShader(shader);
  return null;
}

export default function DotField({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const gl = canvas?.getContext("webgl", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "low-power",
    });
    if (!canvas || !gl) return;
    const vs = compile(gl, gl.VERTEX_SHADER, vertex);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fragment);
    const program = gl.createProgram();
    if (!vs || !fs || !program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(program, "aPos");
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    const u = (name: string) => gl.getUniformLocation(program, name);
    const uSize = u("uSize");
    const uTime = u("uTime");
    const uGap = u("uGap");
    const uScale = u("uScale");
    const uMouse = u("uMouse");
    const uHover = u("uHover");

    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    let ratio = 1;
    let time = 4;
    let last = 0;
    let frame = 0;
    let onScreen = true;
    let lost = false;
    // Pointer target and eased position, in canvas pixels.
    const target = { x: -1e4, y: -1e4, hover: 0 };
    const eased = { x: -1e4, y: -1e4, hover: 0 };

    const draw = () => {
      if (lost) return;
      gl.uniform1f(uTime, time);
      gl.uniform2f(uMouse, eased.x, eased.y);
      gl.uniform1f(uHover, eased.hover);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const resize = () => {
      ratio = Math.min(devicePixelRatio || 1, 1.5);
      const w = Math.max(1, Math.round(canvas.clientWidth * ratio));
      const h = Math.max(1, Math.round(canvas.clientHeight * ratio));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uSize, w, h);
      gl.uniform1f(uGap, 22 * ratio);
      gl.uniform1f(uScale, ratio);
      draw();
    };
    const tick = (now: number) => {
      const dt = last ? Math.min(now - last, 100) / 1000 : 0;
      last = now;
      if (!motion.matches) time += dt;
      const k = 1 - Math.exp(-dt * 9);
      if (eased.hover === 0 && target.hover > 0) {
        eased.x = target.x;
        eased.y = target.y;
      }
      eased.x += (target.x - eased.x) * k;
      eased.y += (target.y - eased.y) * k;
      eased.hover += (target.hover - eased.hover) * (1 - Math.exp(-dt * 5));
      if (eased.hover < 0.002 && target.hover === 0) eased.hover = 0;
      draw();
      frame = requestAnimationFrame(tick);
    };
    const schedule = () => {
      const run = onScreen && !document.hidden && !lost;
      if (run && !frame) {
        last = 0;
        frame = requestAnimationFrame(tick);
      } else if (!run && frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    };

    const onPointer = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const rect = canvas.getBoundingClientRect();
      const inside =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
      target.x = (event.clientX - rect.left) * ratio;
      target.y = (event.clientY - rect.top) * ratio;
      target.hover = inside ? 1 : 0;
    };
    const onLeave = () => {
      target.hover = 0;
    };

    const visibility = new IntersectionObserver(([entry]) => {
      onScreen = !!entry?.isIntersecting;
      schedule();
    });
    visibility.observe(canvas);
    const size = new ResizeObserver(resize);
    size.observe(canvas);
    const onLost = (event: Event) => {
      event.preventDefault();
      lost = true;
      schedule();
    };
    canvas.addEventListener("webglcontextlost", onLost);
    addEventListener("pointermove", onPointer, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    document.addEventListener("visibilitychange", schedule);
    resize();
    schedule();

    return () => {
      cancelAnimationFrame(frame);
      visibility.disconnect();
      size.disconnect();
      canvas.removeEventListener("webglcontextlost", onLost);
      removeEventListener("pointermove", onPointer);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", schedule);
    };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
