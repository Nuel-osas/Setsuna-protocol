import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import {
  createPublicClient,
  http,
  erc20Abi,
  erc4626Abi,
  encodeFunctionResult,
  formatUnits,
  toFunctionSelector,
} from "viem";

// Read-only acceptance: existing local fork balances plus explicitly controlled RPC failures/positions.
const base = new URL(process.argv[2] ?? "http://127.0.0.1:3018").origin;
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const d = await (await fetch(`${base}/api/deployment/`)).json();
assert.equal(d.chainId, 31337);
const client = createPublicClient({ transport: http(`${base}/api/rpc/`) });
const factoryAbi = JSON.parse(
  await readFile("contracts/abi/SetsunaFactory.json", "utf8"),
);
const accountAbi = JSON.parse(
  await readFile("contracts/abi/SetsunaAccount.json", "utf8"),
);
const exchangeAbi = JSON.parse(
  await readFile("contracts/abi/IPerplExchange.json", "utf8"),
);
const latest = await client.getBlockNumber();
const floor = latest - 2000n;
const depositors = await client.getContractEvents({
  address: d.earnUSDC.vault,
  abi: erc4626Abi,
  eventName: "Deposit",
  fromBlock: floor,
  toBlock: latest,
});
let owner;
for (const event of depositors) {
  const shares = await client.readContract({
    address: d.earnUSDC.vault,
    abi: erc4626Abi,
    functionName: "balanceOf",
    args: [event.args.receiver],
  });
  if (shares > 0n) {
    owner = event.args.receiver;
    break;
  }
}
assert.ok(
  owner,
  "Requires an existing USDC share holder; this check never funds or transacts",
);
const accounts = await client.getContractEvents({
  address: d.factory,
  abi: factoryAbi,
  eventName: "AccountCreated",
  fromBlock: BigInt(d.startBlock),
  toBlock: latest,
});
assert.ok(accounts.length, "Requires an existing local Perps account");
const perpsOwner = accounts[0].args.owner;
const account = accounts[0].args.account;
const accountId = await client.readContract({
  address: account,
  abi: accountAbi,
  functionName: "accountId",
});
assert.ok(accountId > 0n);
const accountInfo = await client.readContract({
  address: d.exchange,
  abi: exchangeAbi,
  functionName: "getAccountById",
  args: [accountId],
});
const positionResult = await client.readContract({
  address: d.exchange,
  abi: exchangeAbi,
  functionName: "getPositionV2",
  args: [BigInt(d.perpId), accountId],
});
const output = `.local/portfolio/${Date.now()}`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
page.setDefaultTimeout(20000);
const checks = [],
  errors = [],
  logQueries = [];
let fixture = "live";
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(
  ({ owner }) => {
    const handlers = new Map();
    window.testOwner = owner;
    window.testSwitch = (next) => {
      window.testOwner = next;
      for (const h of handlers.get("accountsChanged") ?? []) h([next]);
    };
    window.ethereum = {
      request: async ({ method }) => {
        if (method === "eth_requestAccounts" || method === "eth_accounts")
          return [window.testOwner];
        if (method === "eth_chainId") return "0x7a69";
        throw new Error(`Read-only test wallet refuses ${method}`);
      },
      on: (event, listener) =>
        handlers.set(event, [...(handlers.get(event) ?? []), listener]),
      removeListener: (event, listener) =>
        handlers.set(
          event,
          (handlers.get(event) ?? []).filter((h) => h !== listener),
        ),
    };
  },
  { owner },
);
await page.route("**/api/rpc/**", async (route) => {
  const request = route.request().postDataJSON();
  if (request.method === "eth_getLogs") logQueries.push(request.params[0]);
  const call = request.params?.[0];
  const selector = call?.data?.slice(0, 10);
  const usdcFailure =
    fixture === "balance-failure" &&
    request.method === "eth_call" &&
    call.to.toLowerCase() === d.earnUSDC.asset.toLowerCase() &&
    selector === toFunctionSelector("balanceOf(address)");
  const blockFailure =
    fixture === "block-failure" && request.method === "eth_getBlockByNumber";
  let result;
  if (usdcFailure || blockFailure) {
    result = {
      error: { code: -32000, message: "Controlled read-only failure" },
    };
  } else if (
    fixture.startsWith("position-") &&
    request.method === "eth_call" &&
    call.to.toLowerCase() === d.exchange.toLowerCase()
  ) {
    if (selector === toFunctionSelector("getPositionV2(uint256,uint256)")) {
      const long = fixture === "position-long";
      result = {
        result: encodeFunctionResult({
          abi: exchangeAbi,
          functionName: "getPositionV2",
          result: [
            {
              ...positionResult[0],
              positionType: long ? 0 : 1,
              lotLNS: 1000n,
              depositCNS: 50000000n,
              pricePNS: 800000n,
              deltaPnlCNS: long ? 7000000n : -7000000n,
              premiumPnlCNS: 1000000n,
            },
            positionResult[1],
            true,
          ],
        }),
      };
    }
    if (selector === toFunctionSelector("getAccountById(uint256)"))
      result = {
        result: encodeFunctionResult({
          abi: exchangeAbi,
          functionName: "getAccountById",
          result: { ...accountInfo, balanceCNS: 300000000n },
        }),
      };
  }
  if (result)
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ jsonrpc: "2.0", id: request.id, ...result }),
    });
  return route.continue();
});
const settle = () =>
  page.waitForFunction(() => {
    const button = document.querySelector('[aria-label="Refresh portfolio"]');
    return button && !button.disabled;
  });
const connect = async () => {
  await page
    .getByRole("button", { name: "Connect account", exact: true })
    .click();
  await page.getByRole("button", { name: "Browser wallet" }).click();
  await settle();
};
const refresh = async () => {
  await page.getByRole("button", { name: "Refresh portfolio" }).click();
  await settle();
};
const changeOwner = async (next) => {
  await page.evaluate((next) => window.testSwitch(next), next);
  await page
    .getByRole("button", { name: "Connect account", exact: true })
    .waitFor();
  assert.equal(await page.getByTestId("portfolio-wallet-usdc").count(), 0);
  await connect();
};
const blockOnPage = async () =>
  BigInt(
    (await page.locator(".p-environment").innerText())
      .match(/Updated at block ([\d,]+)/)[1]
      .replaceAll(",", ""),
  );
const read = (address, abi, functionName, args, blockNumber) =>
  client.readContract({ address, abi, functionName, args, blockNumber });
const display = (value, decimals) =>
  Number(formatUnits(value, decimals)).toLocaleString("en-US", {
    maximumFractionDigits: 5,
  });
const overflow = async () => {
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "Horizontal overflow",
  );
  const boxes = await page
    .getByRole("navigation", { name: "App sections" })
    .getByRole("button")
    .evaluateAll((buttons) =>
      buttons.map((b) => {
        const r = b.getBoundingClientRect();
        return { x: r.x, right: r.right, width: r.width };
      }),
    );
  const width = page.viewportSize().width;
  assert.equal(boxes.length, 4);
  for (let i = 0; i < boxes.length; i++) {
    assert.ok(
      boxes[i].x >= 0 && boxes[i].right <= width && boxes[i].width > 40,
    );
    if (i) assert.ok(boxes[i].x >= boxes[i - 1].right - 1);
  }
};

try {
  await page.goto(`${base}/portfolio/`);
  await page.getByRole("heading", { name: "Portfolio", exact: true }).waitFor();
  await page.screenshot({ path: `${output}/disconnected.png`, fullPage: true });
  assert.equal(await page.getByTestId("portfolio-wallet-usdc").count(), 0);
  await connect();
  const block = await blockOnPage();
  for (const asset of ["MON", "USDC", "AUSD"]) {
    const decimals = asset === "MON" ? 18 : 6;
    const wallet =
      asset === "MON"
        ? await client.getBalance({ address: owner, blockNumber: block })
        : await read(
            asset === "USDC" ? d.earnUSDC.asset : d.collateral,
            erc20Abi,
            "balanceOf",
            [owner],
            block,
          );
    assert.equal(
      await page
        .getByTestId(`portfolio-wallet-${asset.toLowerCase()}`)
        .innerText(),
      display(wallet, decimals),
    );
    if (asset !== "AUSD") {
      const m = d[`earn${asset}`];
      const shares = await read(
        m.vault,
        erc4626Abi,
        "balanceOf",
        [owner],
        block,
      );
      const worth = await read(
        m.vault,
        erc4626Abi,
        "convertToAssets",
        [shares],
        block,
      );
      assert.equal(
        await page
          .getByTestId(`portfolio-total-${asset.toLowerCase()}`)
          .getAttribute("title"),
        formatUnits(wallet + worth, decimals),
      );
    }
  }
  checks.push(
    "Live local-fork wallet balances and Earn totals match independent reads at the displayed block",
  );
  const earnQueries = logQueries.filter((q) =>
    [d.earnMON.vault, d.earnUSDC.vault]
      .map((a) => a.toLowerCase())
      .includes(q.address?.toLowerCase()),
  );
  assert.ok(earnQueries.length >= 4);
  assert.ok(
    earnQueries.every((q) =>
      q.topics.some(
        (t) =>
          typeof t === "string" &&
          t.toLowerCase().endsWith(owner.slice(2).toLowerCase()),
      ),
    ),
  );
  const activity = page.getByRole("region", { name: "Recent activity" });
  // <section aria-label> has an implicit region role.
  await activity.getByRole("button", { name: "Spot", exact: true }).click();
  assert.equal(await activity.locator(".p-activity-icon.is-earn").count(), 0);
  await activity.getByRole("button", { name: "All", exact: true }).click();
  checks.push("Owner-filtered activity queries and product filters");
  await page.screenshot({ path: `${output}/desktop.png`, fullPage: true });

  await page
    .getByRole("article", { name: "setsUSDC position" })
    .getByRole("link", { name: "Withdraw" })
    .click();
  await page.waitForURL("**/app/?asset=USDC&action=withdraw");
  await page.waitForFunction(() =>
    document
      .querySelector('[aria-label="Earn asset"]')
      ?.textContent?.includes("setsUSDC"),
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Withdraw", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.goBack();
  await settle();
  assert.ok(await page.locator(".p-address").count());
  checks.push(
    "Withdraw links select USDC and withdrawal mode; browser back preserves the wallet",
  );

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await overflow();
    await page.screenshot({
      path: `${output}/mobile-${width}.png`,
      fullPage: true,
    });
    for (const tab of ["Spot", "Perps", "Earn", "Portfolio"]) {
      await page
        .getByRole("navigation", { name: "App sections" })
        .getByRole("button", { name: tab, exact: true })
        .click();
      await page
        .getByRole("navigation", { name: "App sections" })
        .getByRole("button", { name: tab, exact: true })
        .and(page.locator('[aria-current="page"]'))
        .waitFor();
      await overflow();
    }
    await settle();
  }
  checks.push(
    "390px and 320px Portfolio, Earn, Spot, Perps layouts and all four tabs fit without overflow",
  );
  await page.setViewportSize({ width: 1440, height: 1100 });
  fixture = "balance-failure";
  await refresh();
  assert.equal(
    await page.getByTestId("portfolio-total-usdc").getAttribute("title"),
    null,
  );
  assert.match(
    await page.getByTestId("portfolio-wallet-usdc").innerText(),
    /Unavailable/,
  );
  assert.ok(
    await page.getByTestId("portfolio-total-mon").getAttribute("title"),
  );
  fixture = "live";
  await refresh();
  assert.ok(
    await page.getByTestId("portfolio-total-usdc").getAttribute("title"),
  );
  checks.push(
    "A failed USDC balance read shows unavailable, preserves independent MON reads, and recovers",
  );
  fixture = "block-failure";
  await refresh();
  await page.locator("main").getByRole("alert").waitFor();
  assert.equal(
    await page.getByTestId("portfolio-wallet-usdc").innerText(),
    "—",
  );
  fixture = "live";
  await refresh();
  checks.push(
    "A failed snapshot clears displayed balances and refresh recovers",
  );

  await changeOwner(`0x${randomBytes(20).toString("hex")}`);
  assert.equal(
    await page.getByTestId("portfolio-wallet-usdc").innerText(),
    "0",
  );
  assert.equal(
    await page.getByTestId("portfolio-total-usdc").getAttribute("title"),
    "0",
  );
  await page.getByRole("heading", { name: "Nothing earning yet" }).waitFor();
  checks.push(
    "Account switch clears the previous owner's balances and displays an empty wallet correctly",
  );
  await changeOwner(perpsOwner);
  const perpsBlock = await blockOnPage();
  const wallet = await read(
    d.collateral,
    erc20Abi,
    "balanceOf",
    [perpsOwner],
    perpsBlock,
  );
  const reserve = await read(account, accountAbi, "reserveCNS", [], perpsBlock);
  const info = await read(
    d.exchange,
    exchangeAbi,
    "getAccountById",
    [accountId],
    perpsBlock,
  );
  const [pos] = await read(
    d.exchange,
    exchangeAbi,
    "getPositionV2",
    [BigInt(d.perpId), accountId],
    perpsBlock,
  );
  const equity =
    pos.lotLNS > 0n ? pos.depositCNS + pos.deltaPnlCNS + pos.premiumPnlCNS : 0n;
  assert.equal(
    await page.getByTestId("portfolio-total-ausd").getAttribute("title"),
    formatUnits(wallet + reserve + info.balanceCNS + equity, 6),
  );
  checks.push(
    "Existing Perps account AUSD total matches wallet, reserve, free balance and position equity",
  );
  for (const side of ["long", "short"]) {
    fixture = `position-${side}`;
    await refresh();
    const position = page.getByRole("article", { name: "Open BTC position" });
    assert.match(
      await position.innerText(),
      side === "long" ? /Long/ : /Short/,
    );
    assert.match(
      await position.innerText(),
      side === "long" ? /\+8 AUSD/ : /-6 AUSD/,
    );
    const value =
      wallet + reserve + 300000000n + (side === "long" ? 58000000n : 44000000n);
    assert.equal(
      await page.getByTestId("portfolio-total-ausd").getAttribute("title"),
      formatUnits(value, 6),
    );
  }
  await page.screenshot({
    path: `${output}/controlled-short-position.png`,
    fullPage: true,
  });
  fixture = "live";
  await refresh();
  checks.push(
    "Controlled read-only long/short fixtures display signed P&L and correct open-position equity",
  );
  assert.deepEqual(errors, []);
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      {
        passed: true,
        base,
        chainId: d.chainId,
        checks,
        errors,
        transactions: 0,
        fixtures:
          "RPC failures and open positions only; screenshots named controlled are not live balances",
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, checks: checks.length, output }));
} catch (error) {
  await page
    .screenshot({ path: `${output}/failure.png`, fullPage: true })
    .catch(() => {});
  await writeFile(
    `${output}/failure.json`,
    JSON.stringify({ error: String(error), checks, errors }, null, 2),
  );
  throw error;
} finally {
  await browser.close();
}
