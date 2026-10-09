import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { docs, docHref } from "@/lib/docs/catalog";
import { getDoc } from "@/lib/docs/content";
import {
  DocActions,
  DocContents,
  VaultIllustration,
  ShareCalculator,
} from "@/components/docs/DocEnhancements";

type Props = { params: Promise<{ slug?: string[] }> };
export const dynamicParams = false;
export function generateStaticParams() {
  return docs.map((doc) => ({ slug: doc.slug ? doc.slug.split("/") : [] }));
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const doc = await getDoc((await params).slug?.join("/") ?? "");
  return {
    title: `${doc?.title ?? "Page not found"} · Setsuna Docs`,
    description: doc?.description,
  };
}

export default async function DocPage({ params }: Props) {
  const slug = (await params).slug?.join("/") ?? "";
  const doc = await getDoc(slug);
  if (!doc) notFound();
  const index = docs.findIndex((d) => d.slug === slug);
  const prev = docs[index - 1],
    next = docs[index + 1];
  return (
    <div className="sd-reading">
      <main id="main" className="sd-main">
        <div className="sd-breadcrumb">
          <Link href="/docs/">Docs</Link>
          <span>/</span>
          <span>{doc.group}</span>
        </div>
        <header className="sd-title">
          <div>
            <h1>{doc.title}</h1>
            <p>{doc.description}</p>
          </div>
          <DocActions source={`# ${doc.title}\n\n${doc.source}`} />
        </header>
        <div className="sd-meta">
          <span className="sd-meta-dot" /> Setsuna on Monad <span>·</span>{" "}
          {doc.minutes} min read
        </div>
        {slug === "" && <VaultIllustration />}
        <article
          className="sd-prose"
          dangerouslySetInnerHTML={{ __html: doc.html }}
        />
        {slug === "math/exchange-rate" && <ShareCalculator />}
        {slug === "" && (
          <div className="sd-start-cards">
            <Link href={docHref("getting-started/deposit")}>
              <span>01 / START HERE</span>
              <strong>
                Make your first deposit <i>↗</i>
              </strong>
              <p>From assets to vault shares, step by step.</p>
            </Link>
            <Link href={docHref("how-it-works/overview")}>
              <span>02 / GO DEEPER</span>
              <strong>
                Understand the engine <i>↗</i>
              </strong>
              <p>Follow the rules that move your capital.</p>
            </Link>
          </div>
        )}
        <nav className="sd-pagination" aria-label="Documentation pages">
          {prev ? (
            <Link href={docHref(prev.slug)}>
              <small>← Previous</small>
              <strong>{prev.title}</strong>
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link href={docHref(next.slug)}>
              <small>Next →</small>
              <strong>{next.title}</strong>
            </Link>
          )}
        </nav>
        <footer className="sd-page-footer">
          <span>Updated October 8, 2026</span>
          <Link href="/docs/developers/contracts/">
            Deployment status <span aria-hidden="true">↗</span>
          </Link>
        </footer>
      </main>
      <DocContents headings={doc.headings} />
    </div>
  );
}
