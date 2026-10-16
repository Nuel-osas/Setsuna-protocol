import type { Metadata } from "next";

/** The one public origin; every canonical URL, sitemap entry and share card points here. */
export const SITE_URL = "https://setsuna.finance";
export const SITE_NAME = "Setsuna";
export const SITE_DESCRIPTION =
  "Automated MON and USDC yield vaults on Monad with published allocation rules. Deposit once; Setsuna supplies Aave, Morpho, Euler, Neverland and Curvance.";
/** The share card (source: brand/social/og-card.html). Set on every page, because a page's own openGraph replaces the layout's. */
export const OG_IMAGE = {
  url: "/og-image.png",
  width: 1200,
  height: 630,
  alt: "Setsuna: put your assets in motion. Automated MON and USDC yield vaults on Monad with published allocation rules.",
};
export const REPO_URL = "https://github.com/Nuel-osas/Setsuna-protocol";
export const DELTAV_URL = "https://deltav.monad.xyz/startup/setsuna";

/**
 * Per-page metadata: a title (the layout adds "· Setsuna"), a description, and
 * a canonical path with the trailing slash the site serves (`trailingSlash`).
 * Open Graph and Twitter titles follow, so shared links read the same as search.
 */
export function pageMeta({
  title,
  description,
  path,
  index = true,
  type = "website",
}: {
  title: string;
  description: string;
  path: string;
  index?: boolean;
  type?: "website" | "article";
}): Metadata {
  return {
    title,
    description,
    // Pages kept out of search get no canonical, so the two signals never disagree.
    ...(index ? { alternates: { canonical: path } } : { robots: { index: false, follow: true } }),
    openGraph: { title: `${title} · ${SITE_NAME}`, description, url: path, type, siteName: SITE_NAME, locale: "en_US", images: [OG_IMAGE] },
    twitter: { card: "summary_large_image", title: `${title} · ${SITE_NAME}`, description, images: [OG_IMAGE] },
  };
}

/** Serialises structured data for a <script type="application/ld+json">, escaping "<" as Next's docs advise. */
export const jsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c");
