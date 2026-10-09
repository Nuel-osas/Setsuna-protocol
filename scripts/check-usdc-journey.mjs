import {
  selectEarnAsset,
  useAvailableEarnShares,
  openEarnWithdrawal,
} from "./earn-ui.mjs";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { erc20Abi, parseAbi } from "viem";
import { keeperNetwork } from "./earn-keeper-network.mjs";

// Runs only on the acceptance runner's owned fork, after the same wallet traded and used MON Earn.
export async function checkUSDCJourney({
  page,
  client: c,
  d,
  user,
  dir,
  run,
  rpc,
}) {
  const m = d.earnUSDC;
  assert.equal(m.adapters.length, 5);
  assert.equal(m.forkBlock, d.earnMON.forkBlock);
  const manifest = JSON.parse(await readFile(`${dir}/demo.json`, "utf8"));
  await keeperNetwork({ rpc, manifest, address: m.vault, assetSymbol: "USDC" });
  for (const patch of [
    { address: d.earnMON.vault },
    { manifest: { ...manifest, forkHash: "0x" + "00".repeat(32) } },
    { manifest: { ...manifest, earnUSDC: { ...m, forkBlock: "110418863" } } },
  ])
    await assert.rejects(() =>
      keeperNetwork({
        rpc,
        manifest,
        address: m.vault,
        assetSymbol: "USDC",
        ...patch,
      }),
    );
  const shares = () =>
    c.readContract({
      address: m.vault,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [user.address],
    });
  const balance = () =>
    c.readContract({
      address: m.asset,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [user.address],
    });
  const confirmed = (text) =>
    page
      .getByRole("status")
      .filter({ hasText: text })
      .waitFor({ timeout: 60000 });
  assert.equal(await shares(), 0n);
  const before = await balance();
  await selectEarnAsset(page, "USDC");
  await page.getByLabel("Amount of USDC", { exact: true }).fill("100.25");
  await page.getByRole("button", { name: "Deposit USDC", exact: true }).click();
  await confirmed("Deposit confirmed");
  assert((await shares()) > 0n);
  assert.equal(await balance(), before - 100250000n);
  assert.equal(
    await c.readContract({
      address: m.asset,
      abi: erc20Abi,
      functionName: "allowance",
      args: [user.address, m.vault],
    }),
    0n,
  );
  assert.equal(await page.locator(".s-rates-card tbody tr").count(), 6);
  console.log(
    "Unified USDC deposit and exact approval passed. Exercising five-protocol allocation…",
  );
  const args = [
    `--env-file=${dir}/deployment/usdc-keeper.env`,
    "scripts/earn-keeper.mjs",
    "--demo-manifest",
    `${dir}/demo.json`,
    "--asset",
    "USDC",
    "--multi",
    "--rpc",
    rpc,
    "--vault",
    m.vault,
    "--execute",
    "--max-gas-price-gwei",
    "200",
    "--max-gas",
    "3500000",
    "--state-dir",
    `${dir}/usdc-executor`,
  ];
  const reports = [];
  const adapterABI = parseAbi(["function totalAssets() view returns(uint256)"]);
  let holdings;
  for (let i = 0; i < 16; i++) {
    const b = await c.getBlock();
    await c.request({
      method: "evm_setNextBlockTimestamp",
      params: [Number(b.timestamp) + 601],
    });
    await c.request({ method: "evm_mine", params: [] });
    for (let step = 0; step < 2; step++) {
      reports.push(JSON.parse(await run(args)));
      await c.request({ method: "evm_mine", params: [] });
    }
    await writeFile(
      `${dir}/usdc-executor-reports.json`,
      JSON.stringify(reports, null, 2),
    );
    holdings = await Promise.all(
      m.adapters.map((address) =>
        c.readContract({
          address,
          abi: adapterABI,
          functionName: "totalAssets",
        }),
      ),
    );
    if (holdings.every((x) => x > 0n)) break;
  }
  assert(
    reports.some(
      (r) =>
        r.result?.operation === "rebalance" && r.result?.action === "confirmed",
    ),
  );
  assert(
    holdings.every((x) => x > 0n),
    "All five protocols must hold an actual position",
  );
  const abi = JSON.parse(
    await readFile("contracts/abi/SetsunaUSDCVault.json", "utf8"),
  );
  // The last rebalance's cooldown must reject another call without changing holdings.
  const latestRebalance = reports.findLast(
    (r) =>
      r.result?.operation === "rebalance" && r.result?.action === "confirmed",
  );
  const latestBlock = await c.getBlock();
  const settledBlock = await c.getBlock({
    blockNumber: BigInt(latestRebalance.result.blockNumber),
  });
  assert(latestBlock.timestamp - settledBlock.timestamp < 600n);
  await assert.rejects(
    () =>
      c.simulateContract({
        address: m.vault,
        abi,
        functionName: "rebalance",
        account: user.address,
      }),
    /CooldownActive/,
  );
  assert.deepEqual(
    await Promise.all(
      m.adapters.map((address) =>
        c.readContract({
          address,
          abi: adapterABI,
          functionName: "totalAssets",
        }),
      ),
    ),
    holdings,
  );
  // Reconcile an already settled transaction after a simulated executor restart.
  const journal = JSON.parse(
    await readFile(`${dir}/deployment/deployment-journal.json`, "utf8"),
  );
  const keeper = journal.usdcKeeper;
  const tx = await c.getTransaction({ hash: latestRebalance.result.hash });
  await writeFile(
    `${dir}/usdc-executor/31337-${keeper.toLowerCase()}.json`,
    JSON.stringify({
      pending: {
        hash: tx.hash,
        nonce: tx.nonce,
        signer: keeper,
        chainId: 31337,
        vault: m.vault,
        action: "rebalance",
      },
    }),
  );
  const nonce = await c.getTransactionCount({ address: keeper });
  const recovered = JSON.parse(await run(args));
  assert.equal(recovered.reconciled.action, "confirmed");
  assert.equal(await c.getTransactionCount({ address: keeper }), nonce);
  await page.reload({ waitUntil: "networkidle" });
  await selectEarnAsset(page, "USDC");
  await page.getByLabel("Amount of USDC", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Connect account", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: /Browser wallet/ }).click();
  await page.getByTestId("usdc-shares").filter({ hasText: "100.25" }).waitFor();
  await page.screenshot({
    path: `${dir}/usdc-allocated-desktop.png`,
    fullPage: true,
  });
  await openEarnWithdrawal(page);
  await page
    .getByLabel("setsUSDC shares to withdraw", { exact: true })
    .fill("40");
  await page
    .getByRole("button", { name: "Withdraw USDC", exact: true })
    .click();
  await confirmed("Withdrawal confirmed");
  assert((await shares()) > 0n);
  await useAvailableEarnShares(page);
  await page
    .getByRole("button", { name: "Withdraw USDC", exact: true })
    .click();
  await confirmed("Withdrawal confirmed");
  assert.equal(await shares(), 0n);
  assert(
    (await balance()) >= before - 10n,
    "Deposit was returned within rounding tolerance",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({ path: `${dir}/usdc-mobile.png`, fullPage: true });
  await page.route("**/api/rpc/", (r) =>
    r.fulfill({
      status: 503,
      body: '{"error":"test outage"}',
      contentType: "application/json",
    }),
  );
  await page
    .getByRole("alert")
    .filter({ hasText: "Could not read the setsUSDC vault" })
    .waitFor({ timeout: 30000 });
  await page
    .getByRole("group", { name: "Earn action" })
    .getByRole("button", { name: "Deposit", exact: true })
    .click();
  assert(
    await page
      .getByRole("button", { name: "Deposit USDC", exact: true })
      .isDisabled(),
  );
  await page.unroute("**/api/rpc/");
  await page
    .getByRole("alert")
    .filter({ hasText: "Could not read the setsUSDC vault" })
    .waitFor({ state: "hidden", timeout: 30000 });
  console.log(
    "Unified USDC: five funded protocols, cooldown rejection, restart recovery, partial/full exits and mobile outage recovery passed.",
  );
  return {
    vault: m.vault,
    holdings: holdings.map(String),
    executor: reports,
    recovered,
    controlledTimeAdvancement: true,
    checks: [
      "same-wallet-and-fork",
      "five-funded-protocols",
      "exact-approval",
      "deposit-shares",
      "signed-USDC-rebalance",
      "cooldown-rejection-no-movement",
      "restart-no-duplicate",
      "partial-full-exit",
      "mobile-outage-recovery",
    ],
  };
}
