import { expect, test } from "@playwright/test";
import { e2eKeypair } from "../fixtures/accounts";
import { addToBlocklist, approveKyc, fundAccount, mintCarbon } from "../fixtures/chain-helpers";
import { installFreighterWallet } from "../fixtures/freighter-shim";

/**
 * Exercises CarbonPage's "Transfer Credits" sub-form (Issue Credits tab) as
 * the compliance-gated transfer path — there is no generic cross-asset
 * "Transfer" page in the app; this is the one real, wired transfer form. See
 * tests/e2e/README.md, "Known frontend gaps".
 */
test.describe("Compliance gate on transfer", () => {
  test("a compliant sender and recipient can transfer", async ({ page, context }) => {
    const sender = e2eKeypair("compliance-sender");
    const recipient = e2eKeypair("compliance-recipient");
    await fundAccount(sender);
    await approveKyc(sender.publicKey(), { tier: 0 });
    await approveKyc(recipient.publicKey(), { tier: 0 });
    await mintCarbon(sender.publicKey(), 100n);

    await installFreighterWallet(context, sender);
    await page.goto("/carbon");
    await page.getByRole("button", { name: "Connect Wallet" }).click();

    const transferForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Transfer Credits" }) });
    await transferForm.getByLabel("Recipient Address").fill(recipient.publicKey());
    await transferForm.getByLabel("Amount (tonnes CO₂e)").fill("10");
    await transferForm.getByRole("button", { name: "Transfer Credits" }).click();

    await expect(page.getByRole("dialog", { name: "Transfer Carbon Credits" })).toBeVisible();
    await page.getByRole("button", { name: "Confirm" }).click();

    await expect(page.getByRole("status").filter({ hasText: "Transfer sent successfully." })).toBeVisible({
      timeout: 15_000,
    });
  });

  test("a blocklisted sender's transfer is rejected by the compliance engine", async ({ page, context }) => {
    const sender = e2eKeypair("compliance-blocked-sender");
    const recipient = e2eKeypair("compliance-recipient");
    await fundAccount(sender);
    await approveKyc(sender.publicKey(), { tier: 0 });
    await approveKyc(recipient.publicKey(), { tier: 0 });
    await mintCarbon(sender.publicKey(), 100n);
    await addToBlocklist(sender.publicKey());

    await installFreighterWallet(context, sender);
    await page.goto("/carbon");
    await page.getByRole("button", { name: "Connect Wallet" }).click();

    const transferForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Transfer Credits" }) });
    await transferForm.getByLabel("Recipient Address").fill(recipient.publicKey());
    await transferForm.getByLabel("Amount (tonnes CO₂e)").fill("10");
    await transferForm.getByRole("button", { name: "Transfer Credits" }).click();

    await expect(page.getByRole("dialog", { name: "Transfer Carbon Credits" })).toBeVisible();
    await page.getByRole("button", { name: "Confirm" }).click();

    // CarbonPage surfaces the raw SDK simulation error as-is (no message
    // decoding on this path — see tests/e2e/README.md); assert on the shape
    // that proves the contract rejected the call, not a specific error code.
    await expect(
      page.getByRole("status").filter({ hasText: /Simulation error calling transfer: Error\(Contract, #\d+\)/ }),
    ).toBeVisible({ timeout: 15_000 });
  });
});
