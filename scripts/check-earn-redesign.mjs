import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";
const base = "http://127.0.0.1:3018";
const dir = `.local/earn-redesign/${Date.now()}`;
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1100 },
  reducedMotion: "reduce",
});
page.setDefaultTimeout(30000);
const errors = [],
  checks = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => {
  const handlers = new Map();
  window.testSwitch = (next) => {
    for (const h of handlers.get("accountsChanged") ?? []) h([next]);
  };
  window.ethereum = {
    request: async ({ method }) => {
      if (["eth_accounts", "eth_requestAccounts"].includes(method))
        return ["0x6915aEf0947F4daD61aeF39Fe0f546A03190c92C"];
      if (method === "eth_chainId") return "0x7a69";
      throw Error("Read-only review wallet");
    },
    on: (event, handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    removeListener: (event, handler) => {
      handlers.set(
        event,
        (handlers.get(event) ?? []).filter((h) => h !== handler),
      );
    },
  };
});
async function capture(name) {
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
  await writeFile(`${dir}/${name}.txt`, await page.locator("body").innerText());
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    `${name} overflow`,
  );
}
try {
  await page.goto(`${base}/earn/`);
  await page.waitForFunction(
    () => document.querySelector(".e-card-rate strong")?.textContent !== "—",
  );
  await capture("overview-desktop");
  assert.equal(
    await page.getByRole("link", { name: /View sets.* vault/ }).count(),
    2,
  );
  await page.getByRole("link", { name: "View setsUSDC vault" }).click();
  await page
    .getByRole("button", { name: "Connect account", exact: true })
    .click();
  await page.getByRole("button", { name: /Browser wallet/ }).click();
  await page.waitForFunction(
    () =>
      !["— USDC", "—USDC"].includes(
        document.querySelector('[data-testid="earnings-usdc"]')?.textContent,
      ),
  );
  await page.getByText(/View \d+ recorded samples/).waitFor();
  await capture("usdc-desktop");
  checks.push(
    "Overview to USDC detail; recorded performance and complete wallet earnings load",
  );
  await page.getByRole("combobox", { name: "Earn asset" }).click();
  await page.getByRole("option", { name: "MON", exact: true }).click();
  await page.getByRole("heading", { name: "setsMON", exact: true }).waitFor();
  await capture("mon-desktop");
  await page.getByRole("combobox", { name: "Earn asset" }).click();
  await page.getByRole("option", { name: "USDC", exact: true }).click();
  await page.getByRole("heading", { name: "setsUSDC", exact: true }).waitFor();
  await page
    .getByRole("group", { name: "Earn action" })
    .getByRole("button", { name: "Withdraw", exact: true })
    .click();
  await page.getByLabel("setsUSDC shares to withdraw").waitFor();
  await page.getByRole("link", { name: "Portfolio ↗", exact: true }).click();
  await page.getByTestId("earnings-usdc").waitFor();
  await page.waitForFunction(() =>
    document
      .querySelector('[data-testid="earnings-usdc"]')
      ?.textContent.includes("+"),
  );
  await capture("portfolio-desktop");
  checks.push(
    "Asset dropdown, withdrawal mode, and wallet persist through detail-to-portfolio navigation",
  );
  await page.evaluate(() =>
    window.testSwitch("0x0000000000000000000000000000000000000011"),
  );
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="earnings-usdc"]'),
  );
  checks.push("Account switch clears previous earnings");
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`${base}/earn/`);
    await capture(`overview-${width}`);
    await page.getByRole("link", { name: "View setsUSDC vault" }).click();
    await page.getByRole("region", { name: "Earn transaction" }).waitFor();
    await page.waitForFunction(
      () => document.querySelector(".e-stats dd")?.textContent !== "—",
    );
    await capture(`usdc-${width}`);
    const form = await page
      .getByRole("region", { name: "Earn transaction" })
      .boundingBox();
    const performance = await page
      .getByRole("region", { name: "Vault performance" })
      .boundingBox();
    assert.ok(form.y < performance.y);
    await page.getByRole("combobox", { name: "Earn asset" }).click();
    await page.getByRole("option", { name: "MON", exact: true }).waitFor();
    await page.screenshot({
      path: `${dir}/picker-${width}.png`,
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    await page
      .getByText("Allocation rules & vault activity", { exact: false })
      .click();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
  }
  checks.push(
    "320px and 390px layouts, asset picker, expanded rules and mobile form order",
  );
  assert.deepEqual(errors, []);
  await writeFile(
    `${dir}/result.json`,
    JSON.stringify({ checks, errors }, null, 2),
  );
  console.log(JSON.stringify({ dir, checks, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: `${dir}/failure.png`, fullPage: true });
  await writeFile(`${dir}/failure.txt`, await page.locator("body").innerText());
  console.log(dir);
  throw error;
} finally {
  await browser.close();
}
