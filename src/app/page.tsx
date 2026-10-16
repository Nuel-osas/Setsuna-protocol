import type { CSSProperties, ReactNode } from "react";
import type { Metadata } from "next";
import { Geist_Pixel } from "next/font/google";
import { Mark } from "@/components/setsuna/Brand";
import TokenIcon from "@/components/setsuna/TokenIcon";
import ProtocolIcon from "@/components/setsuna/ProtocolIcon";
import LandingMotion from "@/components/landing/LandingMotion";
import PixelGrid from "@/components/landing/PixelGrid";
import { LiveAllocation, LiveBlock } from "@/components/landing/Live";
import HeroHexes from "@/components/landing/HeroHexes";
import { HexCell, hexStyle, type Fill, type Hex } from "@/components/landing/Hex";
import { DELTAV_URL, jsonLd, REPO_URL, SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/setsuna/seo";
import "@/styles/landing.css";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

const pixel = Geist_Pixel({
  subsets: ["latin"],
  weight: "variable",
  axes: ["ELSH"],
  variable: "--f-pixel",
  display: "swap",
});

const venues = ["Aave", "Morpho", "Euler", "Neverland", "Curvance", "Kuru", "Perpl"];

const questions = [
  [
    "What does Setsuna do?",
    "Setsuna brings automated Earn vaults, spot swaps and perpetual trading into one app on Monad. Earn is the core: deposit an asset, receive vault shares, and let published allocation rules guide where it is supplied.",
  ],
  [
    "What are setsMON and setsUSDC?",
    "They are receipt shares in two independent Earn vaults. setsMON represents a share of the MON vault; setsUSDC represents a share of the USDC vault. Their value reflects the underlying holdings, including interest or losses.",
  ],
  [
    "Can I withdraw whenever I need to?",
    "You can request a withdrawal at any time. Completion depends on available liquidity and healthy vault accounting. The cash buffer helps with exits, but it cannot guarantee an instant full withdrawal.",
  ],
  [
    "Does trading use my Earn deposits?",
    "No. Spot uses wallet tokens. Perpl trading and the optional protection reserve use AUSD. Your Earn shares are not automatically redeemed or used as trading collateral.",
  ],
  [
    "Can I try it today?",
    "Yes. Everything runs on Monad mainnet with real funds. Earn is a capped beta: setsUSDC holds at most 2,000 USDC and setsMON 25,000 MON, allocated across the live Aave, Morpho, Euler, Neverland and Curvance markets. Spot and Perps trade on Kuru and Perpl at live prices. Setsuna’s contracts are unaudited, so start small.",
  ],
];

const steps = [
  {
    n: "01",
    title: "Start with what you hold.",
    body: "Choose the MON or USDC vault. Your receipt shares represent your portion of that asset’s pool.",
  },
  {
    n: "02",
    title: "Follow published rules.",
    body: "The vault reads supply rates and computes allocations within its limits. Anyone can trigger a valid rebalance.",
  },
  {
    n: "03",
    title: "See where it goes.",
    body: "Inspect holdings, share value and available liquidity. Redeem your shares when the vault can satisfy the withdrawal.",
  },
];

const rules = [
  { value: 60, title: "A limit on concentration.", body: "A maximum allocation per destination, so the vault can’t put its entire pool into one protocol." },
  { value: 10, title: "Room for withdrawals.", body: "A target cash buffer alongside deployed capital. Withdrawals remain subject to available liquidity." },
  { value: 10, title: "Deliberate steps.", body: "Bounded movement per rebalance, with rate observations and a cooldown between reallocations." },
];

const tileFills: Fill[] = ["blue", "paper", "grid", "glass", "deep", "paper", "ink", "blue", "glass", "grid"];
const tileLogos = ["Aave", "Morpho", "Euler", "Neverland", "Curvance"];
const ruleTiles: Hex[] = Array.from({ length: 5 }, (_, r) =>
  Array.from({ length: 5 }, (_, c) => ({ r, c })),
)
  .flat()
  .map(({ r, c }, i) => {
    if (r === 2 && c === 2) return { r, c, fill: "ink" as Fill, kind: "mark" as const };
    const logo = (r * 5 + c) % 6 === 1 ? tileLogos[(r + c) % tileLogos.length] : undefined;
    return { r, c, fill: logo ? ("ink" as Fill) : tileFills[(i * 7) % tileFills.length], logo };
  });

// The pixel wall above the footer: a skyline that is dense at the bottom and ragged on top.
const WALL_COLS = 32;
const WALL_ROWS = 7;
const wall = Array.from({ length: WALL_ROWS * WALL_COLS }, (_, i) => {
  const r = Math.floor(i / WALL_COLS);
  const c = i % WALL_COLS;
  const height = 2 + ((c * 37 + (c >> 2) * 11) % 5) + (c % 7 === 3 ? 1 : 0);
  return WALL_ROWS - r <= height || (r === WALL_ROWS - height - 1 && (c * 13) % 5 === 0);
});

function PixelBar({ className = "" }: { className?: string }) {
  return (
    <div className={`lx-pbar ${className}`} aria-hidden="true" data-pbar>
      <i />
      <i />
      <i />
      <b />
    </div>
  );
}

function Lines({ count }: { count: number }) {
  return (
    <div className="lx-vlines" aria-hidden="true" data-vlines>
      {Array.from({ length: count }, (_, i) => (
        <i key={i} />
      ))}
    </div>
  );
}

function Button({
  href,
  children,
  tone = "light",
}: {
  href: string;
  children: ReactNode;
  tone?: "light" | "dark" | "blue";
}) {
  return (
    <a className={`lx-btn is-${tone}`} href={href}>
      <span className="lx-btn-bg" aria-hidden="true" />
      <span className="lx-btn-label">{children}</span>
      <span className="lx-btn-icon" aria-hidden="true">
        <span className="lx-btn-icon-bg" />
        <span className="lx-btn-arrows">
          <svg viewBox="0 0 12 12"><path d="M3 9 9 3M4 3h5v5" /></svg>
          <svg viewBox="0 0 12 12"><path d="M3 9 9 3M4 3h5v5" /></svg>
        </span>
      </span>
    </a>
  );
}

export default function Home() {
  return (
    <main id="main" className={`lx ${pixel.variable}`}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd([
            {
              "@context": "https://schema.org",
              "@type": "Organization",
              "@id": `${SITE_URL}/#organization`,
              name: SITE_NAME,
              url: SITE_URL,
              logo: `${SITE_URL}/icon-512.png`,
              description: SITE_DESCRIPTION,
              sameAs: [REPO_URL, DELTAV_URL],
            },
            {
              "@context": "https://schema.org",
              "@type": "WebSite",
              "@id": `${SITE_URL}/#website`,
              name: SITE_NAME,
              url: SITE_URL,
              description: SITE_DESCRIPTION,
              inLanguage: "en",
              publisher: { "@id": `${SITE_URL}/#organization` },
            },
            {
              "@context": "https://schema.org",
              "@type": "WebApplication",
              name: SITE_NAME,
              url: `${SITE_URL}/earn/`,
              applicationCategory: "FinanceApplication",
              operatingSystem: "Web",
              description: SITE_DESCRIPTION,
              publisher: { "@id": `${SITE_URL}/#organization` },
            },
          ]),
        }}
      />
      <script
        dangerouslySetInnerHTML={{
          // Injects a stylesheet rather than touching <html>, whose attributes React hydrates and checks.
          __html: `(function(){var c=".lx:not(.is-ready) .lx-hero :is([data-roll],[data-type],[data-fade],[data-hex],.lx-hero-bar>*){visibility:hidden;animation:lx-failsafe 0s 3s forwards}";try{if(sessionStorage.getItem("lx-loaded"))c+=".lx-loader{display:none}"}catch(e){}var s=document.createElement("style");s.textContent="@media (prefers-reduced-motion:no-preference){"+c+"}@media (prefers-reduced-motion:reduce){.lx-loader{display:none}}";document.head.appendChild(s)})()`,
        }}
      />
      <div className="lx-loader" aria-hidden="true" data-loader>
        <div className="lx-loader-screen">
          <div className="lx-loader-top">
            <Mark size={40} color="#7b88ff" />
            <span data-type>Putting your assets in motion</span>
          </div>
          <div className="lx-loader-progress" />
        </div>
      </div>

      {/* ─────────── Hero ─────────── */}
      <section className="lx-hero m-hero-frame" data-hero>
        <PixelGrid />
        <Lines count={6} />
        <div className="lx-hero-inner">
          <div className="lx-hero-copy">
            <p className="lx-eyebrow" data-type>
              Earn · Spot · Perps on Monad
            </p>
            <h1 className="lx-pixel lx-hero-title" data-roll>
              Put your assets
              <br />
              in motion
            </h1>
            <PixelBar />
            <p className="lx-hero-lede" data-fade>
              One deposit. Transparent rules. More room to earn. Setsuna puts
              your MON and USDC to work across Monad’s lending markets.
            </p>
          </div>
          <HeroHexes />
        </div>
        <div className="lx-hero-bar">
          <p>
            Automated MON and USDC vaults with published allocation rules —
            every move visible onchain.
          </p>
          <Button href="/earn/" tone="dark">Explore Earn</Button>
          <Button href="/app/" tone="blue">Open app</Button>
        </div>
      </section>

      {/* ─────────── Venue marquee ─────────── */}
      <section className="lx-marquee" aria-label="Built on Monad’s markets" data-marquee>
        <p className="lx-marquee-label">Built on Monad’s markets</p>
        <div className="lx-marquee-track" data-marquee-track>
          {[0, 1].map((copy) => (
            <ul className="lx-marquee-list" key={copy} aria-hidden={copy === 1} data-marquee-list>
              {venues.map((v) => (
                <li key={v}>
                  <ProtocolIcon name={v} size={26} />
                  <span>{v}</span>
                </li>
              ))}
            </ul>
          ))}
        </div>
      </section>

      {/* ─────────── Grid room ─────────── */}
      <section className="lx-room" data-room>
        <svg className="lx-room-svg" viewBox="0 0 1600 900" preserveAspectRatio="none" aria-hidden="true">
          <RoomLines />
        </svg>
        <div className="lx-cover is-h" aria-hidden="true"><i /><i /></div>
        <div className="lx-room-content" data-room-content>
          <p className="lx-eyebrow" data-type-room>A little less managing</p>
          <h2 className="lx-h2" data-scrub-chars>
            Your capital has places to go. Setsuna gives it a way to get there.
          </h2>
          <PixelBar className="is-room" />
          <p className="lx-room-p">
            Keeping up with markets shouldn’t become your second job. Deposit
            once. Setsuna allocates across approved lending markets, with clear
            limits and every move visible onchain.
          </p>
        </div>
        <div className="lx-cover is-v" aria-hidden="true"><i /><i /></div>
      </section>

      {/* ─────────── Products ─────────── */}
      <section className="lx-products" aria-labelledby="lx-products-title">
        <Lines count={4} />
        <div className="lx-head">
          <p className="lx-eyebrow" data-type>One place. Your next move.</p>
          <h2 id="lx-products-title" className="lx-pixel lx-h-pixel" data-roll>
            Find your flow
          </h2>
          <p className="lx-head-p" data-fade>Earn when you’re holding. Trade when you’re ready.</p>
        </div>
        <div className="lx-cards" data-reveal-wrap>
          <a className="lx-card is-earn" href="/earn/" data-reveal-item>
            <span className="lx-card-dot" />
            <div className="lx-card-art"><EarnArt /></div>
            <div className="lx-card-copy">
              <span className="lx-card-tag">01 / Earn</span>
              <h3>Let your assets work.</h3>
              <p>MON and USDC vaults with published allocation rules, cash buffers and protocol exposure caps.</p>
              <span className="lx-card-link">Explore Earn <ArrowIcon /></span>
            </div>
          </a>
          <a className="lx-card is-spot" href="/trade/?mode=spot" data-reveal-item>
            <span className="lx-card-dot" />
            <div className="lx-card-art"><SpotArt /></div>
            <div className="lx-card-copy">
              <span className="lx-card-tag">02 / Spot</span>
              <h3>Make your next move.</h3>
              <p>Swap MON and USDC through Kuru, with a clear quote and a minimum receive amount before you sign.</p>
              <span className="lx-card-link">Open Spot <ArrowIcon /></span>
            </div>
          </a>
          <a className="lx-card is-perps" href="/trade/?mode=perps" data-reveal-item>
            <span className="lx-card-dot" />
            <div className="lx-card-art"><PerpsArt /></div>
            <div className="lx-card-copy">
              <span className="lx-card-tag">03 / Perps</span>
              <h3>Trade on your terms.</h3>
              <p>AUSD-funded BTC perpetuals on Perpl, with an optional, capped reserve for margin top-ups.</p>
              <span className="lx-card-link">Open Perps <ArrowIcon /></span>
            </div>
          </a>
        </div>
        <p className="lx-note">
          <i /> Live on Monad mainnet with real funds. Earn is a capped beta;
          Setsuna’s contracts are unaudited.
        </p>
      </section>

      {/* ─────────── How it works: pinned switcher ─────────── */}
      <section className="lx-steps" aria-labelledby="lx-steps-title" data-steps>
        <Lines count={6} />
        <div className="lx-steps-inner" data-steps-pin>
          <div className="lx-steps-side">
            <p className="lx-eyebrow" data-type>Simple on the surface</p>
            <h2 id="lx-steps-title" className="lx-h2" data-lines>
              Deposit. Let it work. Stay in control.
            </h2>
            <ol className="lx-rail" aria-hidden="true">
              {steps.map((s, i) => (
                <li key={s.n} className={i === 0 ? "is-active" : ""} data-rail-item>
                  {s.n}
                </li>
              ))}
              <span className="lx-rail-fill" data-rail-fill />
            </ol>
          </div>
          <div className="lx-steps-stage">
            {steps.map((s, i) => (
              <article className="lx-step" key={s.n} data-step>
                <div className="lx-step-visual" data-step-visual>
                  {i === 0 && <StepDeposit />}
                  {i === 1 && <LiveAllocation />}
                  {i === 2 && <StepLedger />}
                </div>
                <div className="lx-step-copy">
                  <span className="lx-pixel lx-step-n" data-step-detail>{s.n}</span>
                  <h3 data-step-detail>{s.title}</h3>
                  <p data-step-detail>{s.body}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────── Rules: pinned hexagon tiles ─────────── */}
      <section className="lx-rules" aria-labelledby="lx-rules-title" data-rules>
        <div className="lx-rules-inner" data-rules-pin>
          <div className="lx-rules-copy">
            <p className="lx-eyebrow" data-type>The freedom of clear boundaries</p>
            <h2 id="lx-rules-title" className="lx-pixel lx-h-pixel" data-roll>
              Built to move.
              <br />
              Bound by rules.
            </h2>
            <ul className="lx-rule-list">
              {rules.map((r) => (
                <li key={r.title} data-rule>
                  <strong className="lx-pixel">
                    <span data-count={r.value}>{r.value}</span>%
                  </strong>
                  <div>
                    <h3>{r.title}</h3>
                    <p>{r.body}</p>
                  </div>
                </li>
              ))}
            </ul>
            <Button href="/docs/how-it-works/rebalancing/" tone="dark">Read the allocation rules</Button>
          </div>
          <div className="lx-tiles" aria-hidden="true">
            {ruleTiles.map((h, i) => (
              <div className="lx-hex-slot" key={i} style={hexStyle(h, "var(--tw)")} data-tile>
                <svg className="lx-hex-outline" viewBox="0 0 100 115.47" preserveAspectRatio="none">
                  <polygon points="50,0.8 99.2,29.3 99.2,86.2 50,114.7 0.8,86.2 0.8,29.3" />
                </svg>
                <div className="lx-tile-fill" data-tile-fill>
                  <HexCell hex={h} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <p className="lx-risk">
          Smart-contract, market and liquidity risks remain. Published rules
          don’t guarantee returns or protect against every loss.
        </p>
      </section>

      {/* ─────────── Statement ─────────── */}
      <section className="lx-statement" data-statement>
        <Lines count={5} />
        <div className="lx-statement-inner">
          <p className="lx-eyebrow" data-type>Every move, onchain</p>
          <h2 className="lx-h2 lx-h2-big" data-scrub-chars-light>
            Deposit once. Watch every allocation, rebalance and withdrawal settle on Monad.
          </h2>
          <PixelBar className="is-light" />
        </div>
      </section>

      {/* ─────────── FAQ ─────────── */}
      <section className="lx-faq" aria-labelledby="lx-faq-title">
        <div className="lx-faq-head">
          <p className="lx-eyebrow" data-type>A few things worth knowing</p>
          <h2 id="lx-faq-title" className="lx-pixel lx-h-pixel" data-roll>
            Let’s make it clear
          </h2>
          <a className="lx-text-link" href="/faq/">All questions <ArrowIcon /></a>
        </div>
        <div className="lx-faq-list" data-reveal-wrap>
          {questions.map(([q, a], i) => (
            <details key={q} data-reveal-item>
              <summary>
                <span className="lx-faq-n lx-pixel">{String(i + 1).padStart(2, "0")}</span>
                <span className="lx-faq-q">{q}</span>
                <span className="lx-faq-icon" aria-hidden="true" />
              </summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* ─────────── CTA + pixel wall ─────────── */}
      <section className="lx-cta" aria-labelledby="lx-cta-title" data-cta>
        <div className="lx-cta-inner">
          <h2 id="lx-cta-title" className="lx-pixel lx-h-pixel" data-roll>
            Ready when you are
          </h2>
          <p data-fade>Start small with the capped beta. Withdraw on your schedule.</p>
          <div className="lx-cta-actions">
            <Button href="/app/" tone="blue">Open app</Button>
            <Button href="/docs/" tone="light">Read the docs</Button>
          </div>
        </div>
        <div className="lx-wall" aria-hidden="true" data-wall style={{ "--cols": WALL_COLS } as CSSProperties}>
          {wall.map((on, i) => (
            <i key={i} className={on ? "is-on" : ""} />
          ))}
        </div>
      </section>

      <LandingMotion />
    </main>
  );
}

function ArrowIcon() {
  return (
    <svg className="lx-arrow" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M3 9 9 3M4 3h5v5" />
    </svg>
  );
}

/** A perspective room: depth frames that shrink toward a vanishing rectangle, joined by rays. */
function RoomLines() {
  const outer = { x: 0, y: 0, w: 1600, h: 900 };
  const inner = { x: 560, y: 330, w: 480, h: 240 };
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const frames = Array.from({ length: 9 }, (_, i) => {
    const t = 1 - Math.pow(1 - (i + 1) / 9, 1.8);
    return {
      x: lerp(outer.x, inner.x, t),
      y: lerp(outer.y, inner.y, t),
      w: lerp(outer.w, inner.w, t),
      h: lerp(outer.h, inner.h, t),
    };
  });
  const rays: [number, number, number, number][] = [];
  const n = 8;
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    rays.push([lerp(0, 1600, t), 0, lerp(inner.x, inner.x + inner.w, t), inner.y]);
    rays.push([lerp(0, 1600, t), 900, lerp(inner.x, inner.x + inner.w, t), inner.y + inner.h]);
  }
  for (let k = 1; k < 5; k++) {
    const t = k / 5;
    rays.push([0, lerp(0, 900, t), inner.x, lerp(inner.y, inner.y + inner.h, t)]);
    rays.push([1600, lerp(0, 900, t), inner.x + inner.w, lerp(inner.y, inner.y + inner.h, t)]);
  }
  return (
    <g>
      {rays.map(([x1, y1, x2, y2], i) => (
        <line key={`r${i}`} x1={x1} y1={y1} x2={x2} y2={y2} pathLength={1} data-room-line />
      ))}
      {frames.map((f, i) => (
        <rect key={`f${i}`} x={f.x} y={f.y} width={f.w} height={f.h} pathLength={1} data-room-line />
      ))}
    </g>
  );
}

/** Columns of pixels that fill bottom-up, each taller than the last: compounding. */
function EarnArt() {
  const cols = [3, 4, 4, 5, 6, 7, 8, 10];
  return (
    <svg viewBox="0 0 160 120" className="lx-art" aria-hidden="true">
      {cols.map((h, c) =>
        Array.from({ length: h }, (_, r) => (
          <rect
            key={`${c}-${r}`}
            x={8 + c * 18}
            y={108 - r * 10}
            width={14}
            height={8}
            style={{ animationDelay: `${(c * 0.12 + r * 0.06).toFixed(2)}s` }}
          />
        )),
      )}
    </svg>
  );
}

/** Two pixel coins trading places. */
function SpotArt() {
  const coin = [
    [0, 1, 1, 1, 0],
    [1, 1, 0, 1, 1],
    [1, 0, 1, 0, 1],
    [1, 1, 0, 1, 1],
    [0, 1, 1, 1, 0],
  ];
  const draw = (ox: number) =>
    coin.flatMap((row, r) =>
      row.map((on, c) => (on ? <rect key={`${ox}-${r}-${c}`} x={ox + c * 9} y={34 + r * 9} width={8} height={8} /> : null)),
    );
  return (
    <svg viewBox="0 0 160 120" className="lx-art" aria-hidden="true">
      <g className="lx-coin is-a">{draw(14)}</g>
      <g className="lx-coin is-b">{draw(102)}</g>
      <g className="lx-swap-arrows">
        <path d="M66 52h28l-6-6M94 68H66l6 6" />
      </g>
    </svg>
  );
}

/** Pixel candles ticking. */
function PerpsArt() {
  const candles = [
    [70, 30, 1],
    [62, 24, 0],
    [58, 34, 1],
    [44, 30, 1],
    [50, 22, 0],
    [36, 40, 1],
    [28, 30, 1],
  ];
  return (
    <svg viewBox="0 0 160 120" className="lx-art" aria-hidden="true">
      {candles.map(([y, h, up], i) => (
        <g key={i} className={`lx-candle ${up ? "is-up" : "is-down"}`} style={{ animationDelay: `${i * 0.18}s` }}>
          <rect x={14 + i * 20} y={y - 8} width={2} height={h + 16} />
          <rect x={9 + i * 20} y={y} width={12} height={h} />
        </g>
      ))}
    </svg>
  );
}

function StepDeposit() {
  return (
    <div className="lx-deposit">
      <div className="lx-deposit-assets">
        <span><TokenIcon asset="MON" size={30} /> MON</span>
        <span><TokenIcon asset="USDC" size={30} /> USDC</span>
      </div>
      <div className="lx-deposit-flow" aria-hidden="true">
        {Array.from({ length: 9 }, (_, i) => (
          <i key={i} style={{ animationDelay: `${i * 0.12}s` }} />
        ))}
      </div>
      <div className="lx-deposit-shares">
        <span className="lx-pixel">setsMON</span>
        <span className="lx-pixel">setsUSDC</span>
        <small>Receipt shares · your portion of the pool</small>
      </div>
    </div>
  );
}

function StepLedger() {
  const rows = [
    ["Deposit", "USDC → setsUSDC"],
    ["Rebalance", "Rates read · caps checked"],
    ["Allocate", "Aave · Morpho · Euler"],
    ["Buffer", "10% held for exits"],
    ["Redeem", "Shares → USDC"],
  ];
  return (
    <div className="lx-ledger">
      <div className="lx-ledger-head">
        <span>Onchain activity</span>
        <LiveBlock />
      </div>
      {rows.map(([a, b], i) => (
        <div className="lx-ledger-row" key={a} style={{ animationDelay: `${i * 0.35}s` }}>
          <span className="lx-pixel">{a}</span>
          <span>{b}</span>
          <i />
        </div>
      ))}
    </div>
  );
}
