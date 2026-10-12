"use client";
import { GrainGradient } from "@paper-design/shaders-react";
import { useEffect, useRef, useState } from "react";

// Flowing wave gradient behind the footer wordmark. Pauses off-screen,
// in background tabs and under reduced motion.
export default function WordmarkGlow() {
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [still, setStill] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries.some((e) => e.isIntersecting)),
      { threshold: 0.01 },
    );
    observer.observe(element);
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const onMotion = () => setStill(motion.matches);
    const onVisibility = () => setHidden(document.hidden);
    onMotion();
    motion.addEventListener("change", onMotion);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      observer.disconnect();
      motion.removeEventListener("change", onMotion);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <div ref={root} className="m-wordmark-glow" aria-hidden="true">
      <GrainGradient
        style={{ width: "100%", height: "100%" }}
        minPixelRatio={1}
        maxPixelCount={1_600_000}
        speed={visible && !hidden && !still ? 0.8 : 0}
        scale={1.82}
        rotation={-360}
        offsetX={-0.1}
        offsetY={0.27}
        softness={1}
        intensity={0.05}
        noise={0}
        shape="wave"
        colors={["#3d5bff", "#1a22d6", "#a3b2ff"]}
        colorBack="#060709"
      />
    </div>
  );
}
