// One-time, DeepBook-specific migration. Generated TSX/CSS are the editable source.
// Re-running is deliberately opt-in because it replaces the initial components.
import fs from "node:fs/promises";
import path from "node:path";
import { load } from "cheerio";
import { format } from "prettier";

if (!process.argv.includes("--regenerate")) {
  throw new Error(
    "This replaces migrated components. Pass --regenerate explicitly.",
  );
}
const root = process.cwd();
const capture = path.join(root, "reference/deepbook");
const routes = ["", "faq", "privacy-policy", "terms-of-use"];
const documents = new Map();
for (const route of routes) {
  documents.set(
    route,
    load(await fs.readFile(path.join(capture, route, "index.html"), "utf8")),
  );
}
const localize = (value) => value.replaceAll("/_astro/", "/media/");
const attributes = {
  class: "className",
  for: "htmlFor",
  tabindex: "tabIndex",
  datetime: "dateTime",
  srcset: "srcSet",
  playsinline: "playsInline",
  autoplay: "autoPlay",
  crossorigin: "crossOrigin",
  fetchpriority: "fetchPriority",
  viewbox: "viewBox",
  preserveaspectratio: "preserveAspectRatio",
  "fill-rule": "fillRule",
  "clip-rule": "clipRule",
  "stroke-width": "strokeWidth",
  "stroke-linecap": "strokeLinecap",
  "stroke-linejoin": "strokeLinejoin",
  "stroke-dasharray": "strokeDasharray",
  "stroke-dashoffset": "strokeDashoffset",
  "stroke-miterlimit": "strokeMiterlimit",
  "fill-opacity": "fillOpacity",
  "stop-color": "stopColor",
  "stop-opacity": "stopOpacity",
  "clip-path": "clipPath",
  "color-interpolation-filters": "colorInterpolationFilters",
  "xlink:href": "xlinkHref",
  patternunits: "patternUnits",
  patterncontentunits: "patternContentUnits",
  gradientunits: "gradientUnits",
  gradienttransform: "gradientTransform",
  filterunits: "filterUnits",
  stddeviation: "stdDeviation",
  basefrequency: "baseFrequency",
  numoctaves: "numOctaves",
  stitchtiles: "stitchTiles",
};
const booleans = new Set([
  "muted",
  "loop",
  "playsinline",
  "autoplay",
  "hidden",
  "open",
  "disabled",
  "controls",
  "inert",
]);
const voids = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);
function jsx(node) {
  if (
    node.type === "text" &&
    !node.data.trim() &&
    ["table", "thead", "tbody", "tfoot", "tr", "colgroup"].includes(
      node.parent?.tagName,
    )
  )
    return "";
  if (node.type === "text")
    return node.data.trim()
      ? `{${JSON.stringify(node.data)}}`
      : node.data
        ? " "
        : "";
  if (!node.tagName || ["script", "style", "noscript"].includes(node.tagName))
    return "";
  const tag = node.tagName;
  const isLink = tag === "a" && /^\/(?!\/)/.test(node.attribs.href || "");
  const name = isLink ? "Link" : tag;
  const attrs = Object.entries(node.attribs)
    .filter(([k]) => !k.startsWith("on") && !["integrity"].includes(k))
    .map(([key, value]) => {
      if (key === "style") {
        const style = Object.fromEntries(
          value
            .split(";")
            .filter((v) => v.includes(":"))
            .map((v) => {
              const at = v.indexOf(":");
              const k = v.slice(0, at).trim();
              return [
                k.startsWith("--")
                  ? k
                  : k.replace(/-([a-z])/g, (_, c) => c.toUpperCase()),
                localize(v.slice(at + 1).trim()),
              ];
            }),
        );
        return `style={${JSON.stringify(style)} as CSSProperties}`;
      }
      if (booleans.has(key)) return `${attributes[key] || key}={true}`;
      if (["tabindex", "rowspan", "colspan", "start"].includes(key))
        return `${attributes[key] || key}={${Number(value)}}`;
      return `${attributes[key] || key}=${JSON.stringify(localize(value))}`;
    })
    .join(" ");
  return `<${name} ${attrs}${isLink ? " prefetch={false}" : ""}${voids.has(tag) ? " />" : `>${(node.children || []).map(jsx).join("")}</${name}>`}`;
}
async function write(file, content, parser = "typescript") {
  const target = path.join(root, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, await format(content, { parser }));
}
async function component(file, name, nodes) {
  const body = nodes.map(jsx).join("");
  await write(
    file,
    `${body.includes("<Link") ? 'import Link from "next/link";' : ""}\n${body.includes("CSSProperties") ? 'import type { CSSProperties } from "react";' : ""}\nexport default function ${name}(){return <>${body}</>}`,
  );
}
// Preserve every responsive variant and original font/video; no remote asset loader.
const report = JSON.parse(
  await fs.readFile(path.join(capture, "capture-report.json"), "utf8"),
);
const manifest = [];
for (const resource of report.resources) {
  if (
    resource.status !== "downloaded" ||
    resource.kind === "page" ||
    /css|javascript/.test(resource.contentType) ||
    resource.file.startsWith("_external/")
  )
    continue;
  const destination = resource.file.replace(/^_astro\//, "media/");
  await fs.mkdir(path.dirname(path.join(root, "public", destination)), {
    recursive: true,
  });
  await fs.copyFile(
    path.join(capture, resource.file),
    path.join(root, "public", destination),
  );
  manifest.push({
    source: resource.url,
    local: "/" + destination,
    bytes: resource.size,
  });
}
await write(
  "asset-manifest.json",
  JSON.stringify({
    source: report.source,
    capturedAt: report.capturedAt,
    assets: manifest,
  }),
  "json",
);

// Keep source cascade order, including inline scoped styles, and deduplicate shared CSS.
const seen = new Set();
const css = [];
for (const $ of documents.values()) {
  for (const node of $("head").find('style,link[rel="stylesheet"]').toArray()) {
    const text =
      node.tagName === "style"
        ? $(node).html()
        : await fs.readFile(path.join(capture, $(node).attr("href")), "utf8");
    if (!seen.has(text)) {
      seen.add(text);
      css.push(localize(text));
    }
  }
}
await write(
  "src/styles/deepbook.css",
  "/* Captured DeepBook design, 2026-09-28. Edit this file for visual changes. */\n" +
    css.join("\n"),
  "css",
);
const $ = documents.get("");
// Header is shared on all routes: section links always lead to the homepage.
$("header a[href^='#']").each((_, el) =>
  $(el).attr("href", "/" + $(el).attr("href")),
);
await component(
  "src/components/SiteHeader.tsx",
  "SiteHeader",
  $("header").toArray(),
);
await component(
  "src/components/SiteFooter.tsx",
  "SiteFooter",
  $("footer").toArray(),
);
const sections = [
  "Hero",
  "Metrics",
  "Products",
  "Programmatic",
  "Vault",
  "Custody",
  "HomeFaq",
  "Closing",
];
const nodes = $("main > section").toArray();
for (let i = 0; i < sections.length; i++)
  await component(`src/components/home/${sections[i]}.tsx`, sections[i], [
    nodes[i],
  ]);
await write(
  "src/app/page.tsx",
  sections.map((n) => `import ${n} from "@/components/home/${n}";`).join("\n") +
    `\nexport default function HomePage(){return <main id="main" tabIndex={-1}>${sections.map((n) => `<${n}/>`).join("")}</main>}`,
);
for (const route of routes.filter(Boolean)) {
  const $ = documents.get(route),
    name = {
      faq: "FaqDocument",
      "privacy-policy": "PrivacyDocument",
      "terms-of-use": "TermsDocument",
    }[route];
  await component(
    `src/components/documents/${name}.tsx`,
    name,
    $("main").toArray(),
  );
  await write(
    `src/app/${route}/page.tsx`,
    `import type { Metadata } from "next";\nimport ${name} from "@/components/documents/${name}";\nexport const metadata: Metadata={title:${JSON.stringify($("title").text())}};\nexport default function Page(){return <${name}/>}`,
  );
}
// Retain the inspected GSAP motion code, but expose mount/dispose for React.
for (const file of [
  "ScrollTrigger.BJZ90ViQ.js",
  "row-motion.CxG--ka8.js",
  "faq-motion.urUqV760.js",
]) {
  const text = await fs.readFile(path.join(capture, "_astro", file), "utf8");
  await write("src/lib/vendor/" + file, text, "babel");
}
let home = await fs.readFile(
  path.join(
    root,
    "reference/readable/index.astro_astro_type_script_index_0_lang.9Avy8Rat.js",
  ),
  "utf8",
);
home =
  home.slice(0, home.lastIndexOf("(E(),")) +
  "export function mountHomeMotion(){ E(); return D; }\n";
await write("src/lib/vendor/home-motion.js", home, "babel");
let footer = await fs.readFile(
  path.join(
    root,
    "reference/readable/Footer.astro_astro_type_script_index_0_lang.B8MmTjL_.js",
  ),
  "utf8",
);
footer =
  footer.slice(0, footer.lastIndexOf("(c(),")) +
  "export function mountFooterMotion(){ c(); return l; }\n";
await write("src/lib/vendor/footer-motion.js", footer, "babel");
console.log(
  `Migrated ${routes.length} routes, ${sections.length} home sections, ${manifest.length} local assets.`,
);
