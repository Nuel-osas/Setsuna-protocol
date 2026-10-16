import type { MetadataRoute } from "next";
import { docs, docHref } from "@/lib/docs/catalog";
import { SITE_URL } from "@/lib/setsuna/seo";

// Indexable pages only: /app/ (the Earn view again) and /portfolio/ (wallet data) are left out.
const pages: { path: string; priority: number; changeFrequency: "daily" | "weekly" | "monthly" }[] = [
  { path: "/", priority: 1, changeFrequency: "weekly" },
  { path: "/earn/", priority: 0.9, changeFrequency: "daily" },
  { path: "/earn/usdc/", priority: 0.8, changeFrequency: "daily" },
  { path: "/earn/mon/", priority: 0.8, changeFrequency: "daily" },
  { path: "/trade/", priority: 0.7, changeFrequency: "daily" },
  { path: "/faq/", priority: 0.6, changeFrequency: "monthly" },
  { path: "/privacy-policy/", priority: 0.2, changeFrequency: "monthly" },
  { path: "/terms-of-use/", priority: 0.2, changeFrequency: "monthly" },
];

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    ...pages.map((p) => ({ url: `${SITE_URL}${p.path}`, priority: p.priority, changeFrequency: p.changeFrequency })),
    ...docs.map((d) => ({
      url: `${SITE_URL}${docHref(d.slug)}`,
      priority: d.slug ? 0.6 : 0.7,
      changeFrequency: "monthly" as const,
    })),
  ];
}
