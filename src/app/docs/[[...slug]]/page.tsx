import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { docs, docHref } from "@/lib/docs/catalog";
import { getDoc } from "@/lib/docs/content";
import { jsonLd, OG_IMAGE, pageMeta, SITE_URL } from "@/lib/setsuna/seo";
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
  const slug = (await params).slug?.join("/") ?? "";
  const doc = await getDoc(slug);
  if (!doc) return { title: { absolute: "Page not found · Setsuna Docs" } };
  const title = slug ? `${doc.title} · Setsuna Docs` : "Setsuna Docs";
  // The catalog's one-liners are written as page subtitles; search snippets get a little context.
  const description = `${doc.description} From the Setsuna docs: Earn vaults, spot and perps on Monad.`;
  return {
    ...pageMeta({ title, description, path: docHref(slug), type: "article" }),
    // The docs suffix is already in the title, so skip the layout's "· Setsuna".
    title: { absolute: title },
    openGraph: { title, description, url: docHref(slug), type: "article", siteName: "Setsuna", locale: "en_US", images: [OG_IMAGE] },
    twitter: { card: "summary_large_image", title, description, images: [OG_IMAGE] },
  };
}

export default async function DocPage({ params }: Props) {
  const slug = (await params).slug?.join("/") ?? "";
  const doc = await getDoc(slug);
  if (!doc) notFound();
  const index = docs.findIndex((d) => d.slug === slug);
  const prev = docs[index - 1],
    next = docs[index + 1];
  const url = `${SITE_URL}${docHref(slug)}`;
  const crumbs = [
    { name: "Docs", url: `${SITE_URL}/docs/` },
    ...(slug ? [{ name: doc.title, url }] : []),
  ];
  const structured = [
    {
      "@context": "https://schema.org",
      "@type": "TechArticle",
      headline: doc.title,
      description: doc.description,
      url,
      mainEntityOfPage: url,
      articleSection: doc.group,
      inLanguage: "en",
      isPartOf: { "@type": "WebSite", name: "Setsuna", url: SITE_URL },
      publisher: { "@type": "Organization", name: "Setsuna", url: SITE_URL, logo: `${SITE_URL}/icon-512.png` },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: c.url })),
    },
  ];
  return (
    <div className="sd-reading">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(structured) }} />
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
