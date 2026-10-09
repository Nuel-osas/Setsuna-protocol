// Shared browser interactions for the unified Earn card.
export async function selectEarnAsset(page, asset) {
  await page.getByLabel("Earn asset", { exact: true }).selectOption(asset);
  await page
    .getByRole("group", { name: "Earn action", exact: true })
    .getByRole("button", { name: "Deposit", exact: true })
    .click();
}

export async function openEarnWithdrawal(page) {
  await page
    .getByRole("group", { name: "Earn action", exact: true })
    .getByRole("button", { name: "Withdraw", exact: true })
    .click();
}

export async function useAvailableEarnShares(page) {
  await openEarnWithdrawal(page);
  await page
    .getByRole("region", { name: "Earn transaction", exact: true })
    .getByRole("button", { name: "Max", exact: true })
    .click();
}
