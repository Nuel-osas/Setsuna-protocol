import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

const output = path.resolve(process.argv[2] ?? ".local/submission-bundle");
const root = process.cwd();
if (!output.startsWith(path.join(root, ".local") + path.sep))
  throw new Error("Use a new output directory inside .local");
await mkdir(path.dirname(output), { recursive: true });
await mkdir(output); // Refuse to overwrite another bundle.
const source = path.join(output, "setsuna-source");
await mkdir(source);
const files = [];
async function include(relative) {
  const input = path.join(root, relative);
  const stat = await lstat(input);
  if (stat.isSymbolicLink())
    throw new Error(`Review symlink before packaging: ${relative}`);
  if (stat.isDirectory()) {
    for (const name of (await readdir(input)).sort()) {
      if (name.startsWith(".")) continue;
      await include(path.join(relative, name));
    }
    return;
  }
  if (!stat.isFile()) throw new Error(`Unexpected input: ${relative}`);
  if (/\.(env|pem|key|p12|pfx|webm|mp4)$/i.test(relative))
    throw new Error(`Excluded file: ${relative}`);
  const target = path.join(source, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(input, target);
  const data = await readFile(input);
  files.push({
    path: relative,
    bytes: data.length,
    sha256: createHash("sha256").update(data).digest("hex"),
  });
}
for (const relative of [
  "README.md",
  "AGENTS.md",
  "package.json",
  "package-lock.json",
  "next.config.ts",
  "tsconfig.json",
  "Dockerfile.demo",
  "src",
  "public",
  "scripts",
  "contracts/src",
  "contracts/test",
  "contracts/script",
  "contracts/abi",
  "contracts/foundry.toml",
  "contracts/dependencies.json",
])
  await include(relative);
for (const name of (await readdir("docs")).sort())
  if (name.endsWith(".md")) await include(`docs/${name}`);
for (const name of [
  "public-demo-2026-10-09.json",
  "earn-rule-proof-2026-10-09.json",
  "web-submission-2026-10-09.json",
])
  await include(`docs/research/${name}`);
await writeFile(
  path.join(source, "SOURCE-ARCHIVE.txt"),
  [
    "Setsuna source review archive — Codex, 9 October 2026",
    "Run with Node.js 24. npm ci; npm run setup:contracts; npm run build.",
    "Foundry is required for contract checks and local fork scripts.",
    "No deployment credentials, wallet keys, private environment files, browser state, or chain snapshots are included.",
    "Hosted execution requires separately configured operator credentials; the public app needs none to try the synthetic demo.",
    "Use docs/HACKATHON-COMPLETION.md for the submission draft and docs/PUBLIC-DEMO.md for the deployment and limitations.",
    "The archive contains current first-party source and pinned dependency setup; it is not a Git history or a software license grant.",
    "Third-party reference checkouts, generated build output and historical research attachments are omitted.",
    "This is a review artifact, not a submitted hackathon entry or a public GitHub repository.",
    "",
  ].join("\n"),
);
await writeFile(
  path.join(source, "SOURCE-MANIFEST.json"),
  JSON.stringify({ createdAt: new Date().toISOString(), files }, null, 2) +
    "\n",
);
const archive = path.join(output, "Setsuna-Source-2026-10-09.tar.gz");
execFileSync("tar", ["-czf", archive, "-C", output, "setsuna-source"], {
  stdio: "pipe",
});
const data = await readFile(archive);
const result = {
  archive,
  files: files.length,
  bytes: data.length,
  sha256: createHash("sha256").update(data).digest("hex"),
};
await writeFile(
  path.join(output, "archive.json"),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result));
