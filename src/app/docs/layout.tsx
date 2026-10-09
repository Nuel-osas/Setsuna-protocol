import DocsShell from "@/components/docs/DocsShell";
import { Geist, Geist_Mono } from "next/font/google";
import { getSearchIndex } from "@/lib/docs/content";
import "@/styles/docs.css";

const docsSans = Geist({
  subsets: ["latin"],
  variable: "--f-docs",
  display: "swap",
});
const docsMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--f-docs-mono",
  display: "swap",
});

export default async function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={`${docsSans.variable} ${docsMono.variable}`}>
      <DocsShell searchIndex={await getSearchIndex()}>{children}</DocsShell>
    </div>
  );
}
