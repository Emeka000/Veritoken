import { expect, test } from "@playwright/test";
import { e2eKeypair } from "../fixtures/accounts";
import { approveKyc, fundAccount } from "../fixtures/chain-helpers";
import { installFreighterWallet } from "../fixtures/freighter-shim";

/**
 * Adapted scope — please read before changing this file.
 *
 * The ticket asks for "admin assigns a compliance role to a second address;
 * the role holder can update rules; a non-holder cannot." That flow doesn't
 * exist: there's no UI to call kyc.add_verifier (frontend/src/lib/roleStore.ts
 * derives role purely client-side — verifier-list membership → "verifier",
 * else KYC tier ≥ 2 → "admin", see roleStore.ts:31-77), and this heuristic
 * doesn't line up with on-chain authorization: the *actual* contract admin
 * (the deploy-time admin address) is also enrolled as a KYC verifier by the
 * shared fixture, so roleStore always resolves it to "verifier" — meaning
 * the one wallet that could genuinely sign `compliance.set_rules`/
 * `add_to_blocklist` is the one wallet App.tsx's `<AdminOnly>` gate on
 * `/admin` will never let in. A KYC-tier-2 wallet clears the *client-side*
 * gate but isn't the on-chain admin, so its writes would revert.
 *
 * There is no single wallet under the current app that both sees `/admin`
 * and can successfully submit an admin transaction — so this spec tests the
 * part that's real and self-consistent: the role-based view gate itself.
 */
test.describe("Admin panel role gating", () => {
  test("a KYC tier-2 wallet can see the Admin panel", async ({ page, context }) => {
    const wallet = e2eKeypair("admin-role-holder");
    await fundAccount(wallet);
    await approveKyc(wallet.publicKey(), { tier: 2, jurisdiction: "US" });

    await installFreighterWallet(context, wallet);
    await page.goto("/admin");
    await page.getByRole("button", { name: "Connect Wallet" }).click();

    await expect(page.getByRole("heading", { name: "Admin Panel" })).toBeVisible();
    await expect(page.getByText("Access restricted")).not.toBeVisible();
    await expect(page.getByRole("region", { name: "Blocklist Management" })).toBeVisible();
  });

  test("a wallet without admin-level KYC is denied access", async ({ page, context }) => {
    const wallet = e2eKeypair("admin-role-denied");
    await fundAccount(wallet);
    await approveKyc(wallet.publicKey(), { tier: 0 });

    await installFreighterWallet(context, wallet);
    await page.goto("/admin");
    await page.getByRole("button", { name: "Connect Wallet" }).click();

    await expect(page.getByText("Access restricted")).toBeVisible();
    await expect(page.getByText("You need admin permissions to view this page.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Admin Panel" })).not.toBeVisible();
  });
});
