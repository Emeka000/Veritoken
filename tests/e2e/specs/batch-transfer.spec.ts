import { expect, test } from "@playwright/test";
import { Keypair } from "../fixtures/stellar-sdk";
import { e2eKeypair } from "../fixtures/accounts";
import { fundAccount } from "../fixtures/chain-helpers";
import { installFreighterWallet } from "../fixtures/freighter-shim";

/**
 * BatchPage's "Execute" action is not wired to real contract calls yet — it
 * builds a `placeholder-xdr:${op.type}:${op.target}` string (see the
 * explicit TODO at frontend/src/pages/BatchPage.tsx:136-138) instead of a
 * real transaction, so submitting it can only ever fail once it reaches
 * signing/simulation. There is nothing on-chain to confirm yet, so this
 * spec covers the part of the flow that *is* real: building a queue of
 * operations in the UI. See tests/e2e/README.md, "Known frontend gaps".
 */
test.describe("Batch operations queue", () => {
  test("adding 3 recipients populates the batch queue", async ({ page, context }) => {
    const wallet = e2eKeypair("batch-operator");
    await fundAccount(wallet);
    await installFreighterWallet(context, wallet);

    await page.goto("/batch");
    await page.getByRole("button", { name: "Connect Wallet" }).click();

    const recipients = [Keypair.random().publicKey(), Keypair.random().publicKey(), Keypair.random().publicKey()];

    for (const [i, target] of recipients.entries()) {
      await page.getByLabel("Target address").fill(target);
      await page.getByLabel("Amount (stroops)").fill(String(1_000_000 + i));
      await page.getByRole("button", { name: "+ Add to Batch" }).click();
    }

    const queueTable = page.getByRole("table");
    await expect(queueTable.getByRole("row")).toHaveCount(4); // header + 3 ops
    await expect(page.getByRole("button", { name: "Execute 3 Operations" })).toBeEnabled();

    // Removing one operation drops the queue back to 2.
    await page.getByRole("button", { name: "Remove operation 1" }).click();
    await expect(queueTable.getByRole("row")).toHaveCount(3);
    await expect(page.getByRole("button", { name: "Execute 2 Operations" })).toBeVisible();
  });

  test("caps the queue at 10 operations", async ({ page, context }) => {
    const wallet = e2eKeypair("batch-operator");
    await installFreighterWallet(context, wallet);

    await page.goto("/batch");
    await page.getByRole("button", { name: "Connect Wallet" }).click();

    for (let i = 0; i < 10; i++) {
      await page.getByLabel("Target address").fill(Keypair.random().publicKey());
      await page.getByLabel("Amount (stroops)").fill("1000000");
      await page.getByRole("button", { name: "+ Add to Batch" }).click();
    }

    await expect(page.getByRole("button", { name: "+ Add to Batch" })).toBeDisabled();
    await expect(page.getByRole("table").getByRole("row")).toHaveCount(11); // header + 10 ops
  });
});
