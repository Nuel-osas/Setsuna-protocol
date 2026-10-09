import { readFile, writeFile } from "node:fs/promises";
import { parseArgs, parseEnv } from "node:util";
import { resolve } from "node:path";
import { reviewedDemoFork } from "./demo-fork-profiles.mjs";

const { values } = parseArgs({
  options: { deployment: { type: "string" }, output: { type: "string" } },
});
try {
  if (!values.deployment || !values.output) throw new Error();
  const dir = resolve(values.deployment);
  const manifest = JSON.parse(await readFile(`${dir}/manifest.json`, "utf8"));
  reviewedDemoFork(manifest);
  if (manifest.earnUSDC?.adapters.length !== 5) throw new Error();
  const mon = parseEnv(await readFile(`${dir}/keeper.env`, "utf8"));
  const usdc = parseEnv(await readFile(`${dir}/usdc-keeper.env`, "utf8"));
  const rpc = process.env.SETSUNA_DEMO_RPC_URL;
  const admin = process.env.SETSUNA_DEMO_ADMIN_RPC_URL;
  if (!rpc || !admin || rpc !== mon.MONAD_RPC_URL || rpc !== usdc.MONAD_RPC_URL)
    throw new Error();
  const config = {
    SETSUNA_DEMO_RPC_URL: rpc,
    SETSUNA_DEMO_ADMIN_RPC_URL: admin,
    SETSUNA_DEMO_MANIFEST: JSON.stringify(manifest),
    SETSUNA_MON_KEEPER_PRIVATE_KEY: mon.EARN_KEEPER_PRIVATE_KEY,
    SETSUNA_USDC_KEEPER_PRIVATE_KEY: usdc.EARN_KEEPER_PRIVATE_KEY,
    SETSUNA_WORKER_STATE_DIR: "/data/setsuna",
  };
  const text =
    Object.entries(config)
      .map(([key, value]) => {
        if (
          typeof value !== "string" ||
          value.includes("'") ||
          /[\r\n]/.test(value)
        )
          throw new Error();
        return `${key}='${value}'`;
      })
      .join("\n") + "\n";
  await writeFile(values.output, text, { flag: "wx", mode: 0o600 });
  console.log(
    "Private worker environment written with owner-only permissions. It has not been uploaded or deployed.",
  );
} catch {
  console.error(
    "Worker environment preparation stopped. Provide matching deployed manifests, signer files and RPC settings, with a new output path. No secrets are logged.",
  );
  process.exitCode = 1;
}
