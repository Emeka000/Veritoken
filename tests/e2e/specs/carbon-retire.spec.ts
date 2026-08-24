import { expect, test } from "@playwright/test";
import { e2eKeypair } from "../fixtures/accounts";
import { approveKyc, fundAccount, mintCarbon } from "../fixtures/chain-helpers";
import { installFreighterWallet } from "../fixtures/freighter-shim";

test.describe("Carbon credit retirement", () => {
  test("retiring 100 credits produces a verifiable receipt with a serial number", async ({
    page,
    context,
  }) => {
    const retiree = e2eKeypair("carbon-retiree");
    await fundAccount(retiree);
    await approveKyc(retiree.publicKey(), { tier: 0 });
    await mintCarbon(retiree.publicKey(), 100n);

    await installFreighterWallet(context, retiree);
    await page.goto("/carbon");
    await page.getByRole("button", { name: "Connect Wallet" }).click();

    await page.getByRole("button", { name: "Retire Credits", exact: true }).click();

    // A unique beneficiary name lets this test find its own receipt row even
    // if the suite retries and appends more receipts to the shared contract.
    const beneficiary = `E2E Retirement ${Date.now()}`;
    await page.getByLabel("Amount to Retire (tonnes CO₂e)").fill("100");
    await page.getByLabel("Beneficiary Name").fill(beneficiary);
    await page.getByLabel("Retirement Reason").fill("Playwright carbon-retire.spec.ts");
    await page.getByRole("button", { name: "Retire Credits (Permanent)" }).click();

    await expect(page.getByRole("dialog", { name: "Retire Carbon Credits" })).toBeVisible();
    await page.getByRole("button", { name: "Confirm" }).click();

    await expect(page.getByRole("status").filter({ hasText: "Credits retired successfully." })).toBeVisible({
      timeout: 15_000,
    });

    // Inline receipt panel shown immediately after retirement.
    const inlineReceipt = page.getByTestId("carbon-retirement-receipt");
    await expect(inlineReceipt).toContainText("100");
    await expect(inlineReceipt).toContainText(beneficiary);

    // Receipts tab — find the matching card by its unique beneficiary name,
    // then verify it and confirm a serial number is returned.
    await page.getByRole("button", { name: "Receipts" }).click();
    const receiptCard = page.getByTestId("receipt-card").filter({ hasText: beneficiary });
    await expect(receiptCard).toBeVisible({ timeout: 15_000 });
    await expect(receiptCard).toContainText("100");

    await receiptCard.getByRole("button", { name: "Verify" }).click();
    const verifiedBadge = receiptCard.getByRole("status", { name: "Receipt verified" });
    await expect(verifiedBadge).toBeVisible({ timeout: 15_000 });
    await expect(verifiedBadge).toHaveText(/✓ Verified · \S+/);
  });
});
