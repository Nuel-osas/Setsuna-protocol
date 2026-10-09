import Link from "next/link";
import AuroraHero from "@/components/setsuna/AuroraHero";
import VaultFlow from "@/components/setsuna/VaultFlow";
import FlowSculpture from "@/components/setsuna/FlowSculpture";
import { Mark } from "@/components/setsuna/Brand";

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
    "Yes, in the local fork demo with synthetic funds. Public deposits and trading are not open. The Perps demo uses a disclosed historical-price fixture; the app shows its environment before you transact.",
  ],
];

export default function Home() {
  return (
    <main id="main" className="m-home">
      <AuroraHero />
      <section
        className="m-venues"
        aria-label="Connected lending and trading venues"
      >
        <span>Built around Monad’s markets</span>
        <div>
          <b>Neverland</b>
          <b className="m-euler-word">Euler</b>
          <b>
            Kuru<span>↗</span>
          </b>
          <b className="m-perpl-word">perpl</b>
        </div>
        <p>Protocol integrations · independent venues</p>
      </section>

      <section id="flow" className="m-intro m-section">
        <span className="m-section-label">
          A little less managing. A little more living.
        </span>
        <h2>
          Your capital has places to go.
          <br />
          <em>Give it a way to get there.</em>
        </h2>
        <p>
          Keeping up with markets shouldn’t become your second job.
          <br />
          Deposit once. Setsuna allocates across approved lending markets,
          <br className="m-desktop-break" /> with clear limits and every move
          visible onchain.
        </p>
        <VaultFlow />
      </section>

      <section
        className="m-products m-section"
        id="products"
        aria-labelledby="products-title"
      >
        <div className="m-heading-row">
          <div>
            <span className="m-section-label">One place. Your next move.</span>
            <h2 id="products-title">
              Find your <em>flow.</em>
            </h2>
          </div>
          <p>
            Earn when you’re holding.
            <br />
            Trade when you’re ready.
          </p>
        </div>
        <div className="m-product-grid">
          <Link className="m-product m-product-earn" href="/app/">
            <div className="m-product-top">
              <span>01 / EARN</span>
              <i aria-hidden="true">↗</i>
            </div>
            <div className="m-product-art m-art-earn" aria-hidden="true">
              <div className="m-stack m-stack-back" />
              <div className="m-stack m-stack-middle" />
              <div className="m-stack m-stack-front">
                <Mark size={66} />
                <span>setsMON</span>
              </div>
            </div>
            <h3>Let your assets work.</h3>
            <p>
              MON and USDC vaults with published allocation rules, cash buffers
              and protocol exposure caps.
            </p>
            <span className="m-product-link">
              Explore Earn <span aria-hidden="true">→</span>
            </span>
          </Link>
          <Link className="m-product m-product-spot" href="/app/?tab=spot">
            <div className="m-product-top">
              <span>02 / SPOT</span>
              <i aria-hidden="true">↗</i>
            </div>
            <div className="m-product-art m-art-spot" aria-hidden="true">
              <div className="m-swap-coin m-swap-mon">M</div>
              <span className="m-swap-arrows">⇄</span>
              <div className="m-swap-coin m-swap-usdc">$</div>
            </div>
            <h3>Make your next move.</h3>
            <p>
              Swap MON and USDC through Kuru, with a clear quote and a minimum
              receive amount before you sign.
            </p>
            <span className="m-product-link">
              Open Spot <span aria-hidden="true">→</span>
            </span>
          </Link>
          <Link className="m-product m-product-perps" href="/app/?tab=perps">
            <div className="m-product-top">
              <span>03 / PERPS</span>
              <i aria-hidden="true">↗</i>
            </div>
            <div className="m-product-art m-art-perps" aria-hidden="true">
              <div className="m-candles">
                {[36, 61, 45, 90, 63, 116, 95].map((h, i) => (
                  <i key={i} style={{ height: h }} />
                ))}
              </div>
              <span className="m-price-label">
                BTC-PERP <b>↗</b>
              </span>
            </div>
            <h3>Trade on your terms.</h3>
            <p>
              AUSD-funded BTC perpetuals on Perpl, with an optional, capped
              reserve for margin top-ups.
            </p>
            <span className="m-product-link">
              Open Perps <span aria-hidden="true">→</span>
            </span>
          </Link>
        </div>
        <p className="m-product-note">
          <i /> Try all three in the local demo. Public deposits and trading
          remain closed.
        </p>
      </section>

      <section className="m-how m-section" id="how" aria-labelledby="how-title">
        <div className="m-heading-row">
          <div>
            <span className="m-section-label">
              Simple on the surface. Transparent underneath.
            </span>
            <h2 id="how-title">
              Deposit. Let it work.
              <br />
              <em>Stay in control.</em>
            </h2>
          </div>
          <Link className="m-button m-button-outline" href="/earn/">
            Inside Earn <span aria-hidden="true">↗</span>
          </Link>
        </div>
        <div className="m-how-grid">
          {[
            [
              "01",
              "Start with what you hold.",
              "Choose the MON or USDC vault. Your receipt shares represent your portion of that asset’s pool.",
            ],
            [
              "02",
              "Follow published rules.",
              "The vault reads supply rates and computes allocations within its limits. Anyone can trigger a valid rebalance.",
            ],
            [
              "03",
              "See where it goes.",
              "Inspect holdings, share value and available liquidity. Redeem your shares when the vault can satisfy the withdrawal.",
            ],
          ].map(([n, title, body]) => (
            <article key={n}>
              <span>{n}</span>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="m-principles" aria-labelledby="principles-title">
        <div className="m-principles-inner">
          <div className="m-principles-copy">
            <span className="m-section-label">
              The freedom of clear boundaries
            </span>
            <h2 id="principles-title">
              Built to move.
              <br />
              <em>Bound by rules.</em>
            </h2>
            <p>
              Good automation starts with limits you can inspect. The vault
              enforces them onchain.
            </p>
            <Link className="m-button m-button-glass" href="/docs/how-it-works/rebalancing/">
              Read the allocation rules <span aria-hidden="true">↗</span>
            </Link>
            <div className="m-principles-mark">
              <FlowSculpture />
            </div>
          </div>
          <div className="m-principle-list">
            <article>
              <strong>
                60<span>%</span>
              </strong>
              <div>
                <h3>A limit on concentration.</h3>
                <p>
                  A maximum allocation per destination, so the vault can’t put
                  its entire pool into one protocol.
                </p>
              </div>
            </article>
            <article>
              <strong>
                10<span>%</span>
              </strong>
              <div>
                <h3>Room for withdrawals.</h3>
                <p>
                  A target cash buffer alongside deployed capital. Withdrawals
                  remain subject to available liquidity.
                </p>
              </div>
            </article>
            <article>
              <strong>
                10<span>%</span>
              </strong>
              <div>
                <h3>Deliberate steps.</h3>
                <p>
                  Bounded movement per rebalance, with rate observations and a
                  cooldown between reallocations.
                </p>
              </div>
            </article>
            <p className="m-risk-note">
              Smart-contract, market and liquidity risks remain. Published rules
              don’t guarantee returns or protect against every loss.
            </p>
          </div>
        </div>
      </section>

      <section
        className="m-questions m-section"
        aria-labelledby="questions-title"
      >
        <div>
          <span className="m-section-label">A few things worth knowing</span>
          <h2 id="questions-title">
            Let’s make
            <br />
            <em>it clear.</em>
          </h2>
          <Link className="m-text-link" href="/faq/">
            All questions <span aria-hidden="true">↗</span>
          </Link>
        </div>
        <div className="m-answers">
          {questions.map(([q, a]) => (
            <details key={q}>
              <summary>
                {q}
                <span aria-hidden="true">+</span>
              </summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="m-final">
        <div className="m-final-halo" aria-hidden="true" />
        <Mark size={48} />
        <span className="m-section-label">Your assets. Your direction.</span>
        <h2>
          A little more
          <br />
          <em>possibility.</em>
        </h2>
        <Link className="m-button m-button-light" href="/app/">
          Find your flow <span aria-hidden="true">↗</span>
        </Link>
        <p>Explore Setsuna’s development preview.</p>
      </section>
    </main>
  );
}
