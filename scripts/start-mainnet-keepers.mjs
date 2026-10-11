import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "node:http";
import { privateKeyToAccount } from "viem/accounts";
import { mainnetEarn } from "../src/lib/setsuna/mainnet-earn.ts";
import { keeperNetwork } from "./earn-keeper-network.mjs";

// One persistent service supervises the setsUSDC and setsMON keepers on Monad
// mainnet. Each keeper has its own gas wallet; neither holds the treasury key.
// Every run reconciles its persisted journal before acting, so a restart never
// resubmits a transaction.
async function main() {
  const d = mainnetEarn();
  if (!d) throw new Error("SETSUNA_MAINNET_EARN required");
  const rpc = process.env.MONAD_RPC_URL ?? "https://rpc.monad.xyz";
  const keyMON = process.env.SETSUNA_MAINNET_MON_KEEPER_PRIVATE_KEY;
  const keyUSDC = process.env.SETSUNA_MAINNET_USDC_KEEPER_PRIVATE_KEY;
  const signers = [privateKeyToAccount(keyMON), privateKeyToAccount(keyUSDC)];
  if (signers[0].address === signers[1].address)
    throw new Error("Separate MON and USDC signers required");
  for (const [i, assetSymbol] of ["MON", "USDC"].entries()) {
    const { client } = await keeperNetwork({
      rpc,
      assetSymbol,
      address: i === 0 ? d.earnMON.vault : d.earnUSDC.vault,
    });
    if ((await client.getBalance({ address: signers[i].address })) === 0n)
      throw new Error("Keeper signer needs MON for gas");
  }
  if (!process.env.SETSUNA_KEEPER_STATE_DIR)
    throw new Error("Persistent state directory required");
  const dir = resolve(process.env.SETSUNA_KEEPER_STATE_DIR);
  await mkdir(dir, { recursive: true, mode: 0o700 });

  const common = { ...process.env, MONAD_RPC_URL: rpc };
  delete common.SETSUNA_MAINNET_MON_KEEPER_PRIVATE_KEY;
  delete common.SETSUNA_MAINNET_USDC_KEEPER_PRIVATE_KEY;
  delete common.EARN_KEEPER_PRIVATE_KEY;
  const shared = ["--execute", "--max-gas-price-gwei", "300"];
  const definitions = [
    {
      name: "MON",
      args: [
        "--asset",
        "MON",
        "--vault",
        d.earnMON.vault,
        "--max-gas",
        "2000000",
        "--state-dir",
        `${dir}/mon`,
      ],
      key: keyMON,
    },
    {
      name: "USDC",
      args: [
        "--asset",
        "USDC",
        "--multi",
        "--vault",
        d.earnUSDC.vault,
        "--max-gas",
        "3500000",
        "--state-dir",
        `${dir}/usdc`,
      ],
      key: keyUSDC,
    },
  ];
  const children = [];
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    for (const child of children)
      if (child.exitCode === null) child.kill("SIGTERM");
  };
  for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, stop);
  // The health endpoint reports process liveness only; receipts are the evidence.
  const server = createServer((req, res) => {
    const ready =
      !stopping &&
      children.length === definitions.length &&
      children.every((c) => c.exitCode === null);
    res.writeHead(req.url === "/health" ? (ready ? 200 : 503) : 404, {
      "Content-Type": "application/json",
    });
    res.end(
      JSON.stringify(
        req.url === "/health"
          ? { ready, keepers: definitions.length, network: "monad-mainnet" }
          : { error: "Not found" },
      ),
    );
  });
  const port = Number(process.env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid health port");
  await new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(port, "0.0.0.0", done);
  });
  try {
    await Promise.all(
      definitions.map(
        (def) =>
          new Promise((done) => {
            const child = spawn(
              process.execPath,
              ["scripts/earn-keeper-watch.mjs", ...def.args, ...shared],
              {
                env: {
                  ...common,
                  EARN_KEEPER_INTERVAL_SECONDS: "60",
                  EARN_KEEPER_PRIVATE_KEY: def.key,
                },
                stdio: "inherit",
              },
            );
            children.push(child);
            child.once("error", () => {
              process.exitCode = 1;
              stop();
              done();
            });
            child.once("exit", (code) => {
              if (!stopping) {
                console.error(
                  `${def.name} keeper stopped; restarting service.`,
                );
                process.exitCode = code || 1;
                stop();
              }
              done();
            });
          }),
      ),
    );
  } finally {
    stop();
    server.close();
  }
}
main().catch(() => {
  console.error(
    "Keeper setup stopped. Check private configuration, gas balances and persisted receipts. Credentials are not logged.",
  );
  process.exitCode = 1;
});
