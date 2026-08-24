import { expect, test } from "@playwright/test";
import { e2eKeypair } from "../fixtures/accounts";
import { approveKyc, fundAccount } from "../fixtures/chain-helpers";
import { installFreighterWallet } from "../fixtures/freighter-shim";

test.describe("KYC status panel", () => {
  test("shows 'Not KYC approved' for an unknown wallet", async ({ page, context }) => {
    const wallet = e2eKeypair("kyc-unknown");
    await fundAccount(wallet);
    await installFreighterWallet(context, wallet);

    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Connect Wallet" }).click();

    const notApproved = page.getByTestId("kyc-not-approved");
    await expect(notApproved).toBeVisible();
    await expect(notApproved).toContainText("Not KYC approved");
  });

  test("shows Approved with tier and expiry after an on-chain approval, on refresh", async ({
    page,
    context,
  }) => {
    // KycPage's "Approve KYC" button is a UI stub that never calls the
    // contract (see tests/e2e/README.md, "Known frontend gaps") — so we
    // approve directly on-chain here and assert on the panel's real read
    // path (contracts.kyc.getRecord), which the UI does implement.
    const wallet = e2eKeypair("kyc-approved");
    await fundAccount(wallet);
    await installFreighterWallet(context, wallet);

    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Connect Wallet" }).click();
    await expect(page.getByTestId("kyc-not-approved")).toBeVisible();

    await approveKyc(wallet.publicKey(), { tier: 1, jurisdiction: "US", expirySecondsFromNow: 365 * 86_400 });

    // The panel only re-fetches on mount/param change (react-query staleTime
    // is 30s) — a page refresh is what surfaces the new on-chain state,
    // matching the acceptance criteria.
    await page.reload();

    const approved = page.getByTestId("kyc-approved");
    await expect(approved).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("kyc-status-value")).toHaveText("Approved");
    await expect(page.getByTestId("kyc-tier-value")).toHaveText("1");
    await expect(page.getByTestId("kyc-expiry-value")).toContainText("remaining");
  });
});
