import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { cache } from "react";
import { Marked } from "marked";
import { docs, type DocHeading, type SearchEntry } from "./catalog";

const escape = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// Only authored, allowlisted repository Markdown is read. No remote/user HTML is rendered.
export const getDoc = cache(async (slug: string) => {
  const meta = docs.find((doc) => doc.slug === slug);
  if (!meta) return undefined;
  const source = await readFile(
    join(process.cwd(), "src/content/docs", `${slug || "index"}.md`),
    "utf8",
  );
  const headings: DocHeading[] = [];
  const used = new Map<string, number>();
  const parser = new Marked({
    gfm: true,
    async: false,
    renderer: {
      html({ text }) {
        return escape(text);
      },
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens);
        const text = html.replace(/<[^>]*>/g, "");
        const base = text
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");
        const seen = used.get(base) ?? 0;
        used.set(base, seen + 1);
        const id = `${base}${seen ? `-${seen}` : ""}`;
        headings.push({ id, text, depth });
        return `<h${depth} id="${id}">${html}<a class="sd-anchor" href="#${id}" aria-label="Link to ${escape(text)}">#</a></h${depth}>`;
      },
      code({ text, lang }) {
        return `<div class="sd-code"><div class="sd-code-top"><span>${escape(lang || "Formula")}</span><button type="button" data-copy-code aria-label="Copy code">Copy</button></div><pre><code>${escape(text)}</code></pre></div>`;
      },
    },
  });
  const html = (parser.parse(source) as string)
    .replace(/<table>/g, '<div class="sd-table"><table>')
    .replace(/<\/table>/g, "</table></div>");
  const text = source
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#*`>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return {
    ...meta,
    source,
    html,
    text,
    headings,
    minutes: Math.max(1, Math.ceil(text.split(/\s+/).length / 220)),
  };
});

export async function getSearchIndex(): Promise<SearchEntry[]> {
  return Promise.all(
    docs.map(async (meta) => ({
      ...meta,
      text: (await getDoc(meta.slug))!.text,
    })),
  );
}
