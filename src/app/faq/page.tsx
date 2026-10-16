import type { Metadata } from "next";
import { jsonLd, pageMeta } from "@/lib/setsuna/seo";
import { faqs } from "@/lib/setsuna/content";
export const metadata: Metadata = pageMeta({
  title: "Questions",
  description:
    "Answers about Setsuna’s MON and USDC vaults on Monad: how shares work, where funds go, withdrawals, fees, risks and the capped mainnet beta.",
  path: "/faq/",
});
export default function Page() {
  return (
    <main id="main" className="s-doc">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: faqs.map(([q, a]) => ({
              "@type": "Question",
              name: q,
              acceptedAnswer: { "@type": "Answer", text: a },
            })),
          }),
        }}
      />
      <div className="s-doc-head">
        <div>
          <p className="s-eyebrow">THE DETAILS MATTER</p>
          <h1>
            Your questions.
            <br />
            Clear answers.
          </h1>
        </div>
      </div>
      <div className="s-faq-list">
        {faqs.map(([q, a]) => (
          <details key={q}>
            <summary>
              {q}
              <span>+</span>
            </summary>
            <p>{a}</p>
          </details>
        ))}
      </div>
    </main>
  );
}
