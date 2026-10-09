// Shared browser interactions for the unified Earn card.
export async function pickEarnAsset(page, asset) {
  await page.getByRole("combobox", { name: "Earn asset", exact: true }).click();
  await page
    .getByRole("option", { name: new RegExp(`^(sets)?${asset}$`) })
    .click();
}

export async function selectEarnAsset(page, asset) {
  await pickEarnAsset(page, asset);
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
