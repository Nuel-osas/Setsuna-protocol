import type { Metadata } from "next";
import { faqs } from "@/lib/setsuna/content";
export const metadata: Metadata = { title: "Questions · Setsuna" };
export default function Page() {
  return (
    <main id="main" className="s-doc">
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
