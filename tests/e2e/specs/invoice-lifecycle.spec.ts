import { expect, test } from "@playwright/test";
import { adminKeypair, e2eKeypair } from "../fixtures/accounts";
import { approveKyc, fundAccount } from "../fixtures/chain-helpers";
import { installFreighterWallet, installFreighterWalletOnPage } from "../fixtures/freighter-shim";

/**
 * There is exactly one invoice for the whole test run — invoice-token's
 * metadata is set once, at contract construction (see the "invoice" fixture
 * step in tests/integration/fixtures/fixture-plans.ts), not through any
 * "create invoice" UI action (none exists). `settle()` is a one-way,
 * contract-wide flip with no "unsettle" — this is therefore the only spec
 * in the suite allowed to call it, and it must run before any other spec
 * that reads `isSettled`. See tests/e2e/README.md, "Test independence".
 *
 * `issue()`/`settle()` both require the contract admin's own signature (the
 * UI passes the *connected* wallet as that signer — see InvoicePage.tsx's
 * handleIssue/handleSettle), so this spec connects as the deployed admin
 * account for those two steps, then reconnects as the token holder to
 * redeem — matching who actually has to sign each call on-chain.
 */
test.describe("Invoice lifecycle", () => {
  test("issue, settle, and redeem 50% updates the status badge", async ({ page, context }) => {
    const holder = e2eKeypair("invoice-holder");
    await fundAccount(holder);
    await approveKyc(holder.publicKey(), { tier: 0 });

    const admin = adminKeypair();
    await installFreighterWallet(context, admin);
    await page.goto("/invoices");
    await page.getByRole("button", { name: "Connect Wallet" }).click();

    await expect(page.getByTestId("invoice-status-badge")).toHaveText("Pending Settlement");

    const issueAmount = 1_000_000_000n;
    await page.getByLabel("Recipient Address").fill(holder.publicKey());
    await page.getByLabel("Amount (stroops)").fill(issueAmount.toString());
    await page.getByRole("button", { name: "Issue Invoice Tokens" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Invoice tokens issued successfully." }),
    ).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Settle Invoice" }).click();
    await expect(page.getByTestId("invoice-status-badge")).toHaveText("✓ Settled — Redemption Open", {
      timeout: 15_000,
    });

    // Switch the connected wallet to the token holder to redeem — redeem()
    // requires the holder's own auth, not the admin's.
    await page.getByRole("button", { name: "Disconnect" }).click();
    await installFreighterWalletOnPage(page, holder);
    await page.reload();
    await page.getByRole("button", { name: "Connect Wallet" }).click();

    await page.getByRole("button", { name: "Redeem", exact: true }).click();
    const redeemAmount = issueAmount / 2n;
    await page.getByLabel("Amount to Redeem (stroops)").fill(redeemAmount.toString());
    await page.getByRole("button", { name: "Redeem Tokens" }).click();

    await expect(page.getByRole("status").filter({ hasText: "Tokens redeemed successfully." })).toBeVisible({
      timeout: 15_000,
    });
    // The badge stays "Settled" post-redemption — redemption only burns the
    // holder's tokens, it doesn't change the settlement flag.
    await expect(page.getByTestId("invoice-status-badge")).toHaveText("✓ Settled — Redemption Open");
  });
});
