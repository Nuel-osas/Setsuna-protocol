"use client";
import { useLayoutEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";

const DESKTOP = "(min-width: 900px)";
const MOBILE = "(max-width: 899px)";
const ease = { expo: "expo.inOut", out: "power3.out" };

/**
 * All landing motion in one place. Unifi supplies the loader, line slide-ins,
 * typewriter labels, vertical rules, pinned grid room, scrubbed text colour and
 * hexagon tiles; Walrus supplies the rolling pixel letters, card reveals,
 * scroll-direction marquee, pinned clip-path switcher and flashing pixel wall.
 */
export default function LandingMotion() {
  useLayoutEffect(() => {
    const root = document.querySelector<HTMLElement>(".lx");
    if (!root) return;
    const loader = root.querySelector<HTMLElement>("[data-loader]");
    // React owns the loader node, so it is hidden rather than removed.
    const hide = () => loader?.setAttribute("hidden", "");
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      hide();
      root.classList.add("is-ready");
      return;
    }
    gsap.registerPlugin(ScrollTrigger, SplitText);
    let seen = false;
    try {
      seen = !!sessionStorage.getItem("lx-loaded");
      sessionStorage.setItem("lx-loaded", "1");
    } catch {}

    let ctx: gsap.Context | undefined;
    let cancelled = false;

    const start = () => {
      if (cancelled) return;
      ctx = gsap.context(() => {
        const q = <T extends Element = HTMLElement>(sel: string, scope: ParentNode = root) =>
          Array.from(scope.querySelectorAll<T>(sel) as NodeListOf<T>);

        /* ── text helpers ───────────────────────────────────────── */
        // Walrus heading reveal: each letter sits in a clipping box with two
        // text-shadow copies to its left; sliding 1.4em rolls the copies through.
        const rollSplit = (el: HTMLElement) => {
          const split = SplitText.create(el, { type: "words,chars", wordsClass: "lx-wd", charsClass: "lx-ch" });
          split.chars.forEach((ch, i) => {
            const wrap = document.createElement("span");
            wrap.className = "lx-lw";
            ch.parentNode?.insertBefore(wrap, ch);
            wrap.appendChild(ch);
            (ch as HTMLElement).style.setProperty("--i", String(i));
          });
          gsap.set(split.chars, { autoAlpha: 0 });
          return split.chars;
        };
        const roll = (chars: Element[]) =>
          gsap.fromTo(
            chars,
            { x: "0em", autoAlpha: 0 },
            { x: "1.4em", autoAlpha: 1, duration: 0.65, ease: "power2.out", stagger: { amount: 0.8, from: "random" } },
          );
        // Unifi typewriter: characters switch on one after another.
        const typeSplit = (el: HTMLElement) => {
          const { chars } = SplitText.create(el, { type: "chars", charsClass: "lx-tc" });
          gsap.set(chars, { opacity: 0 });
          return chars;
        };
        const type = (chars: Element[]) =>
          gsap.fromTo(chars, { opacity: 0 }, { opacity: 1, duration: 0.01, ease: "none", stagger: 0.035 });
        const pbar = (el: Element) => {
          const tl = gsap.timeline();
          tl.fromTo(el.querySelectorAll("i"), { scale: 0 }, { scale: 1, duration: 0.01, stagger: 0.12 });
          tl.fromTo(el.querySelector("b"), { scaleX: 0 }, { scaleX: 1, duration: 1.1, ease: ease.expo }, "<0.2");
          return tl;
        };
        const lines = (el: Element) =>
          gsap.fromTo(el.querySelectorAll("i"), { scaleY: 0 }, { scaleY: 1, duration: 1.5, ease: ease.expo, stagger: 0.05 });
        const once = (trigger: Element, anim: gsap.core.Animation, startAt = "top 85%") => {
          anim.pause();
          ScrollTrigger.create({ trigger, start: startAt, once: true, onEnter: () => void anim.play() });
        };

        /* ── hero intro (after the loader on a first visit) ──────── */
        const hero = root.querySelector<HTMLElement>("[data-hero]")!;
        const heroTitle = hero.querySelector<HTMLElement>("[data-roll]")!;
        const heroChars = rollSplit(heroTitle);
        const heroType = typeSplit(hero.querySelector<HTMLElement>("[data-type]")!);
        const hexes = q("[data-hex]", hero);
        gsap.set(hexes, { y: "8vw", autoAlpha: 0 });
        gsap.set(q("[data-fade]", hero), { autoAlpha: 0, y: 16 });
        gsap.set(hero.querySelectorAll(".lx-hero-bar > *"), { yPercent: 100, autoAlpha: 0 });
        gsap.set(hero.querySelectorAll("[data-vlines] i"), { scaleY: 0 });
        gsap.set(hero.querySelectorAll("[data-pbar] i"), { scale: 0 });
        gsap.set(hero.querySelectorAll("[data-pbar] b"), { scaleX: 0 });
        root.classList.add("is-ready");

        const intro = gsap.timeline({ paused: true });
        intro
          .add(roll(heroChars), 0)
          .add(type(heroType), 0)
          .add(lines(hero.querySelector("[data-vlines]")!), 0)
          .to(hexes, { y: 0, autoAlpha: 1, duration: 1.6, ease: ease.out, stagger: -0.05 }, 0.1)
          .add(pbar(hero.querySelector("[data-pbar]")!), 0.6)
          .to(q("[data-fade]", hero), { autoAlpha: 1, y: 0, duration: 0.8, ease: ease.out }, 0.7)
          .to(hero.querySelectorAll(".lx-hero-bar > *"), { yPercent: 0, autoAlpha: 1, duration: 0.9, ease: ease.out, stagger: 0.08 }, 0.8);

        if (loader && !seen) {
          const loaderType = typeSplit(loader.querySelector<HTMLElement>("[data-type]")!);
          const tl = gsap.timeline({ onComplete: hide });
          document.documentElement.style.cursor = "wait";
          tl.add(type(loaderType), 0.2)
            .fromTo(loader.querySelector(".lx-loader-progress"), { scaleX: 0 }, { scaleX: 1, duration: 1.9, ease: ease.expo }, 0)
            .to(loader.querySelector(".lx-loader-screen"), { yPercent: -125, duration: 1, ease: ease.expo })
            .to(loader.querySelector(".lx-loader-top"), { yPercent: 125, duration: 1, ease: ease.expo }, "<")
            .call(() => {
              document.documentElement.style.cursor = "";
              intro.play();
            }, undefined, "<0.45");
        } else {
          hide();
          intro.play();
        }

        // Unifi's header parallax: the cluster climbs as you leave, alternate cells faster.
        gsap.to(hero.querySelector("[data-hexes]"), {
          yPercent: -22,
          ease: "none",
          scrollTrigger: { trigger: hero, start: "top top", end: "bottom top", scrub: 0.5 },
        });
        hexes.forEach((hex, i) =>
          gsap.to(hex.firstElementChild, {
            yPercent: i % 3 === 0 ? -40 : i % 3 === 1 ? -14 : -26,
            ease: "none",
            scrollTrigger: { trigger: hero, start: "top top", end: "bottom top", scrub: 0.5 },
          }),
        );

        /* ── generic scroll reveals ─────────────────────────────── */
        q("[data-roll]").forEach((el) => el !== heroTitle && once(el, roll(rollSplit(el))));
        q("[data-type]").forEach((el) => !hero.contains(el) && !loader?.contains(el) && once(el, type(typeSplit(el))));
        q("[data-lines]").forEach((el) => {
          const split = SplitText.create(el, { type: "lines", mask: "lines", linesClass: "lx-line" });
          once(el, gsap.fromTo(split.lines, { yPercent: 110 }, { yPercent: 0, duration: 0.8, ease: ease.out, stagger: 0.2 }));
        });
        q("[data-vlines]").forEach((el) => !hero.contains(el) && once(el, lines(el), "top 80%"));
        q("[data-pbar]").forEach((el) => !hero.contains(el) && !el.closest("[data-room]") && once(el, pbar(el), "top 90%"));
        q("[data-fade]").forEach((el) => !hero.contains(el) && once(el, gsap.fromTo(el, { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.8 })));
        q("[data-reveal-wrap]").forEach((wrap) => {
          const items = q("[data-reveal-item]", wrap);
          gsap.set(items, { autoAlpha: 0 });
          once(wrap, gsap.fromTo(items, { yPercent: 35, autoAlpha: 0 }, { yPercent: 0, autoAlpha: 1, duration: 0.7, stagger: 0.14 }), "top 80%");
        });

        /* ── marquee that follows your scroll direction ─────────── */
        const marquee = root.querySelector<HTMLElement>("[data-marquee]");
        if (marquee) {
          const loop = gsap.to(q("[data-marquee-list]", marquee), { xPercent: -100, repeat: -1, duration: 28, ease: "none" });
          ScrollTrigger.create({
            trigger: marquee,
            start: "top bottom",
            end: "bottom top",
            onUpdate: (self) => {
              gsap.to(loop, { timeScale: self.direction, duration: 0.6, overwrite: true });
              marquee.dataset.dir = self.direction === 1 ? "normal" : "inverted";
            },
          });
          gsap.fromTo(
            marquee.querySelector("[data-marquee-track]"),
            { x: "4vw" },
            { x: "-4vw", ease: "none", scrollTrigger: { trigger: marquee, start: "top bottom", end: "bottom top", scrub: 0 } },
          );
        }

        const mm = gsap.matchMedia();

        /* ── grid room ──────────────────────────────────────────── */
        const room = root.querySelector<HTMLElement>("[data-room]")!;
        const roomChars = SplitText.create(room.querySelector("[data-scrub-chars]")!, { type: "words,chars", charsClass: "lx-sc" }).chars;
        const roomType = typeSplit(room.querySelector<HTMLElement>("[data-type-room]")!);
        const roomBar = room.querySelector("[data-pbar]")!;
        const roomLines = q<SVGElement>("[data-room-line]", room);
        mm.add(DESKTOP, () => {
          const typeIn = type(roomType).pause();
          const barIn = pbar(roomBar).pause();
          const tl = gsap.timeline({
            scrollTrigger: {
              trigger: room,
              start: "top top",
              end: "+=220%",
              scrub: 0.5,
              pin: true,
              onUpdate: (self) => {
                if (self.progress > 0.3) typeIn.play();
                else typeIn.reverse();
                if (self.progress > 0.85) barIn.play();
                else barIn.reverse();
              },
            },
          });
          tl.fromTo(room.querySelectorAll(".lx-cover.is-h i"), { scaleY: 0.9 }, { scaleY: 0, duration: 0.75, ease: "none" }, 0)
            .fromTo(room.querySelectorAll(".lx-cover.is-v i"), { scaleX: 0.9 }, { scaleX: 0, duration: 0.75, ease: "none" }, 0)
            .fromTo(room.querySelector("[data-room-content]"), { scale: 0.82 }, { scale: 1, duration: 0.75, ease: "none" }, 0)
            .fromTo(room.querySelector("[data-room-content]"), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.35, ease: "none" }, 0.2)
            .fromTo(roomLines, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.6, ease: "none", stagger: 0.008 }, 0.05)
            .fromTo(roomChars, { color: "#4a4d5c" }, { color: "#f2efe8", duration: 0.01, ease: "none", stagger: 0.02 }, 0.75)
            .fromTo(room.querySelector(".lx-room-p"), { autoAlpha: 0, y: 20 }, { autoAlpha: 1, y: 0, duration: 0.3 }, ">-0.2");
        });
        mm.add(MOBILE, () => {
          once(room, type(roomType));
          once(roomBar, pbar(roomBar), "top 90%");
          gsap.set(roomLines, { strokeDashoffset: 0 });
          gsap.fromTo(roomChars, { color: "#4a4d5c" }, {
            color: "#f2efe8",
            ease: "none",
            stagger: 0.02,
            scrollTrigger: { trigger: room.querySelector("[data-scrub-chars]"), start: "top 80%", end: "bottom 45%", scrub: 0.5 },
          });
        });

        /* ── steps: pinned clip-path switcher ───────────────────── */
        const stepsEl = root.querySelector<HTMLElement>("[data-steps]")!;
        const steps = q("[data-step]", stepsEl);
        const rail = q("[data-rail-item]", stepsEl);
        mm.add(DESKTOP, () => {
          let current = 0;
          gsap.set(steps, { clipPath: "inset(50% 50% 50% 50%)" });
          gsap.set(steps[0], { clipPath: "inset(0% 0% 0% 0%)" });
          steps.forEach((s, i) => i && gsap.set(q("[data-step-detail]", s), { autoAlpha: 0 }));
          const go = (from: number, to: number) => {
            if (to > from) gsap.to(steps[to], { clipPath: "inset(0% 0% 0% 0%)", duration: 0.8, ease: "power3.inOut", overwrite: "auto" });
            else gsap.to(steps[from], { clipPath: "inset(50% 50% 50% 50%)", duration: 0.8, ease: "power3.inOut", overwrite: "auto" });
            gsap.to(q("[data-step-detail]", steps[from]), { autoAlpha: 0, y: -20, duration: 0.4, overwrite: "auto" });
            gsap.fromTo(q("[data-step-detail]", steps[to]), { autoAlpha: 0, y: 20 }, { autoAlpha: 1, y: 0, duration: 0.5, delay: 0.25, stagger: 0.08, overwrite: "auto" });
            rail.forEach((r, i) => r.classList.toggle("is-active", i === to));
            current = to;
          };
          ScrollTrigger.create({
            trigger: stepsEl.querySelector("[data-steps-pin]"),
            start: "center center",
            end: "+=200%",
            pin: true,
            onUpdate: (self) => {
              const target = self.progress >= 0.66 ? 2 : self.progress >= 0.33 ? 1 : 0;
              while (current !== target) go(current, current + Math.sign(target - current));
              gsap.set(stepsEl.querySelector("[data-rail-fill]"), { scaleY: self.progress });
            },
          });
        });

        /* ── rules: pinned hexagon tiles ────────────────────────── */
        const rulesEl = root.querySelector<HTMLElement>("[data-rules]")!;
        const fills = q("[data-tile-fill]", rulesEl);
        const outlines = q(".lx-hex-outline", rulesEl);
        const order = gsap.utils.shuffle(fills.map((_, i) => i));
        const counters = q("[data-count]", rulesEl);
        counters.forEach((el) => (el.textContent = "0"));
        const count = () =>
          counters.forEach((el, i) =>
            gsap.fromTo(el, { textContent: 0 }, { textContent: Number(el.dataset.count), duration: 1.4, delay: i * 0.25, ease: "power2.out", snap: { textContent: 1 } }),
          );
        ScrollTrigger.create({ trigger: rulesEl, start: "top 60%", once: true, onEnter: count });
        gsap.set(fills, { autoAlpha: 0, scale: 0.86 });
        mm.add(DESKTOP, () => {
          const tl = gsap.timeline({
            scrollTrigger: { trigger: rulesEl.querySelector("[data-rules-pin]"), start: "center center", end: "+=150%", scrub: 0.5, pin: true },
          });
          order.forEach((idx, k) => {
            tl.to(fills[idx], { autoAlpha: 1, scale: 1, duration: 0.12, ease: "back.out(2)" }, k * 0.06);
            tl.to(outlines[idx], { autoAlpha: 0, duration: 0.01 }, k * 0.06);
          });
          q("[data-rule]", rulesEl).forEach((r, i) => tl.fromTo(r, { autoAlpha: 0.25 }, { autoAlpha: 1, duration: 0.2 }, i * 0.45));
        });
        mm.add(MOBILE, () => {
          gsap.to(order.map((i) => fills[i]), {
            autoAlpha: 1,
            scale: 1,
            stagger: 0.05,
            ease: "none",
            scrollTrigger: { trigger: rulesEl.querySelector(".lx-tiles"), start: "top 85%", end: "bottom 40%", scrub: 0.5 },
          });
        });

        /* ── statement: Unifi's scrubbed text fill on light ─────── */
        const statement = root.querySelector<HTMLElement>("[data-statement]")!;
        const stChars = SplitText.create(statement.querySelector("[data-scrub-chars-light]")!, { type: "words,chars", charsClass: "lx-sc" }).chars;
        mm.add(DESKTOP, () => {
          gsap.fromTo(stChars, { color: "#b4b0a6" }, {
            color: "#0d0f12",
            ease: "none",
            stagger: 0.02,
            scrollTrigger: { trigger: statement, start: "top top", end: "+=100%", scrub: 0.5, pin: true },
          });
        });
        mm.add(MOBILE, () => {
          gsap.fromTo(stChars, { color: "#b4b0a6" }, {
            color: "#0d0f12",
            ease: "none",
            stagger: 0.02,
            scrollTrigger: { trigger: statement, start: "top 70%", end: "bottom 50%", scrub: 0.5 },
          });
        });

        /* ── pixel wall: random blocks pulse while it is on screen ─ */
        const wall = root.querySelector<HTMLElement>("[data-wall]");
        if (wall) {
          const cells = q("i:not(.is-on)", wall);
          let pulses: gsap.core.Tween[] = [];
          let cycle: gsap.core.Tween | undefined;
          const stop = () => {
            cycle?.kill();
            pulses.forEach((p) => p.kill());
            gsap.set(pulses.flatMap((p) => p.targets()), { backgroundColor: "transparent" });
            pulses = [];
          };
          const run = () => {
            stop();
            pulses = gsap.utils
              .shuffle(cells.slice())
              .slice(0, Math.max(16, Math.floor(cells.length * 0.15)))
              .map((cell) =>
                gsap.fromTo(cell, { backgroundColor: "rgba(123,136,255,0)" }, {
                  backgroundColor: "rgba(123,136,255,1)",
                  duration: 0.5 + Math.random(),
                  delay: Math.random() * 4,
                  repeat: -1,
                  yoyo: true,
                }),
              );
            cycle = gsap.delayedCall(5, run);
          };
          ScrollTrigger.create({ trigger: wall, start: "top bottom", end: "bottom top", onToggle: (self) => (self.isActive ? run() : stop()) });
        }
      }, root);
      requestAnimationFrame(() => ScrollTrigger.refresh());
    };

    void document.fonts.ready.then(start);
    return () => {
      cancelled = true;
      document.documentElement.style.cursor = "";
      ctx?.revert();
    };
  }, []);

  return null;
}
