import { execFileSync } from "node:child_process";
import { mkdir, readFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../contracts/", import.meta.url);
const dependencies = JSON.parse(await readFile(new URL("dependencies.json", root), "utf8"));
await mkdir(new URL("lib/", root), { recursive: true });
for (const [name, dependency] of Object.entries(dependencies)) {
  const destination = fileURLToPath(new URL(`lib/${name}`, root));
  let exists = true;
  try { await access(destination); } catch { exists = false; }
  if (!exists) execFileSync("git", ["-c", "advice.detachedHead=false", "clone", "--depth", "1", "--branch", dependency.tag, dependency.repository, destination], { stdio: "inherit" });
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: destination, encoding: "utf8" }).trim();
  if (head !== dependency.commit) throw new Error(`${name}: expected ${dependency.commit}, found ${head}; existing files were preserved`);
  console.log(`${name}: ${head}`);
}
