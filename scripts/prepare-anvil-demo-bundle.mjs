import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const files = [
  "package.json",
  "package-lock.json",
  "Dockerfile.demo",
  ...[
    "start-anvil-demo",
    "anvil-demo-gateway",
    "start-demo-workers",
    "earn-keeper-watch",
    "earn-keeper",
    "earn-keeper-core",
    "earn-keeper-network",
    "demo-fork-profiles",
    "demo-trading-fixture",
    "demo-trading-watch",
    "deploy-hosted-demo",
    "deploy-demo-faucet",
  ].map((n) => `scripts/${n}.mjs`),
  ...["demo-config", "usdc-deployment", "types"].map(
    (n) => `src/lib/setsuna/${n}.ts`,
  ),
  ...["SetsunaEarnVault", "SetsunaUSDCVault", "IPerplExchange"].map(
    (n) => `contracts/abi/${n}.json`,
  ),
  "contracts/out/LocalEarnDemo.s.sol/LocalMONFactory.json",
  "contracts/out/SetsunaFactory.sol/SetsunaFactory.json",
  "contracts/out/SetsunaSpot.sol/SetsunaSpot.json",
  "contracts/out/SetsunaUSDCV2Factory.sol/USDCV2VaultDeployer.json",
  "contracts/out/SetsunaUSDCV2Factory.sol/SetsunaUSDCV2Factory.json",
  "contracts/out/SetsunaDemoFaucet.sol/SetsunaDemoFaucet.json",
];
const { values } = parseArgs({ options: { output: { type: "string" } } });
try {
  if (!values.output) throw new Error("A new output directory is required");
  const root = fileURLToPath(new URL("../", import.meta.url)),
    output = resolve(values.output),
    entries = [];
  for (const path of files) {
    if (!(await lstat(resolve(root, path))).isFile())
      throw new Error(`Not a regular source file: ${path}`);
    const bytes = await readFile(resolve(root, path));
    entries.push({
      path,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  await mkdir(output, { mode: 0o700 });
  for (const entry of entries) {
    const to = resolve(output, "source", entry.path);
    await mkdir(dirname(to), { recursive: true });
    await copyFile(resolve(root, entry.path), to);
    if (
      createHash("sha256")
        .update(await readFile(to))
        .digest("hex") !== entry.sha256
    )
      throw new Error("Source changed while copying");
  }
  await writeFile(
    resolve(output, "source/.dockerignore"),
    ".env*\nnode_modules/\n.local/\n",
  );
  await writeFile(
    resolve(output, "source/.gitignore"),
    ".env*\nnode_modules/\n.local/\n",
  );
  await writeFile(
    resolve(output, "bundle.json"),
    JSON.stringify(
      {
        author: "Codex",
        createdAt: new Date().toISOString(),
        files: entries,
        uploaded: false,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      source: resolve(output, "source"),
      files: entries.length,
      uploaded: false,
    }),
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
