import type { Metadata } from "next";
import { pageMeta } from "@/lib/setsuna/seo";
export const metadata: Metadata = pageMeta({
  title: "Terms of use",
  description:
    "The terms for using Setsuna, a hackathon build on Monad mainnet with real funds: the capped Earn beta, unaudited contracts, approvals and dependencies.",
  path: "/terms-of-use/",
});
export default function Page() {
  return (
    <main id="main" className="s-doc">
      <div className="s-doc-head">
        <div>
          <p className="s-eyebrow">DEVELOPMENT PREVIEW · SEPTEMBER 2026</p>
          <h1>
            Know the
            <br />
            boundaries.
          </h1>
        </div>
      </div>
      <article className="s-prose">
        <h2>About this build</h2>
        <p>
          Setsuna is a hackathon build running on Monad mainnet with real funds.
          Earn is a capped beta, and no Setsuna contract has completed a
          security audit. Use only amounts you can afford to lose.
        </p>
        <h2>What a policy authorizes</h2>
        <p>
          A policy authorizes eligible top-ups from its reserve within a
          cumulative spending cap that includes keeper fees. It does not insure
          a position, guarantee execution or limit total trading losses.
        </p>
        <h2>Your account and approvals</h2>
        <p>
          Review each transaction, reserve amount and policy before confirming.
          You control your connected account and must retain access to your
          wallet or passkey. A passkey created on localhost is scoped to that
          domain.
        </p>
        <h2>External dependencies</h2>
        <p>
          Execution depends on the chain, Perpl, AUSD, price freshness and
          available keepers. Their behavior and availability can affect your
          position. Demo results do not establish live performance.
        </p>
      </article>
    </main>
  );
}
