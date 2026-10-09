import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

// Explicit runtime inputs prevent private deployment files entering a source upload.
const files = [
  "package.json",
  "package-lock.json",
  "Dockerfile.workers",
  ".dockerignore",
  "scripts/start-demo-workers.mjs",
  "scripts/earn-keeper-watch.mjs",
  "scripts/earn-keeper.mjs",
  "scripts/earn-keeper-core.mjs",
  "scripts/earn-keeper-network.mjs",
  "scripts/demo-fork-profiles.mjs",
  "scripts/demo-trading-fixture.mjs",
  "scripts/demo-trading-watch.mjs",
  "src/lib/setsuna/demo-config.ts",
  "src/lib/setsuna/usdc-deployment.ts",
  "src/lib/setsuna/types.ts",
  "contracts/abi/SetsunaEarnVault.json",
  "contracts/abi/SetsunaUSDCVault.json",
  "contracts/abi/IPerplExchange.json",
];

const { values } = parseArgs({ options: { output: { type: "string" } } });
try {
  if (!values.output) throw new Error("Supply --output with a new directory");
  const root = fileURLToPath(new URL("../", import.meta.url));
  const output = resolve(values.output);
  const entries = [];
  for (const file of files) {
    if (!(await lstat(resolve(root, file))).isFile())
      throw new Error(`Expected a regular source file: ${file}`);
    const data = await readFile(resolve(root, file));
    entries.push({
      path: file,
      bytes: data.length,
      sha256: createHash("sha256").update(data).digest("hex"),
    });
  }
  // Deliberately refuses an existing output; never merges into an old release.
  await mkdir(output, { mode: 0o700 });
  const source = resolve(output, "source");
  for (const entry of entries) {
    const destination = resolve(source, entry.path);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(resolve(root, entry.path), destination);
    const copied = await readFile(destination);
    if (createHash("sha256").update(copied).digest("hex") !== entry.sha256)
      throw new Error(`Source changed while preparing ${entry.path}`);
  }
  const record = {
    author: "Codex",
    createdAt: new Date().toISOString(),
    source,
    uploaded: false,
    dockerImageBuilt: false,
    files: entries,
  };
  await writeFile(resolve(output, "bundle.json"), JSON.stringify(record, null, 2) + "\n");
  console.log(JSON.stringify({ source, files: entries.length, uploaded: false }));
} catch (error) {
  console.error(`Worker bundle preparation stopped: ${error.message}`);
  process.exitCode = 1;
}
