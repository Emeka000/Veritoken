import { expect, test } from "@playwright/test";
import { e2eKeypair } from "../fixtures/accounts";
import { fundAccount } from "../fixtures/chain-helpers";
import { installFreighterWallet, uninstallFreighterWallet } from "../fixtures/freighter-shim";

test.describe("Wallet connect / disconnect", () => {
  test("connect shows the truncated address, disconnect clears it", async ({ page, context }) => {
    const wallet = e2eKeypair("wallet-connect");
    await fundAccount(wallet);
    await installFreighterWallet(context, wallet);

    await page.goto("/");

    const connectButton = page.getByRole("button", { name: "Connect Wallet" });
    await expect(connectButton).toBeVisible();
    await connectButton.click();

    const expectedShort = `${wallet.publicKey().slice(0, 4)}…${wallet.publicKey().slice(-4)}`;
    await expect(page.getByTestId("wallet-address")).toContainText(expectedShort);

    const disconnectButton = page.getByRole("button", { name: "Disconnect" });
    await expect(disconnectButton).toBeVisible();
    await disconnectButton.click();

    await expect(page.getByRole("button", { name: "Connect Wallet" })).toBeVisible();
    await expect(page.getByTestId("wallet-address")).not.toBeVisible();
  });

  test("reconnects automatically after a page reload", async ({ page, context }) => {
    const wallet = e2eKeypair("wallet-reconnect");
    await fundAccount(wallet);
    await installFreighterWallet(context, wallet);

    await page.goto("/");
    await page.getByRole("button", { name: "Connect Wallet" }).click();

    const expectedShort = `${wallet.publicKey().slice(0, 4)}…${wallet.publicKey().slice(-4)}`;
    await expect(page.getByTestId("wallet-address")).toContainText(expectedShort);

    // The provider type is persisted to localStorage; a full reload should
    // silently reconnect via useWallet().autoReconnect() without the user
    // clicking "Connect Wallet" again.
    await page.reload();

    await expect(page.getByTestId("wallet-address")).toContainText(expectedShort);
    await expect(page.getByRole("button", { name: "Disconnect" })).toBeVisible();
  });

  test("shows the wallet selector when Freighter is not injected", async ({ page, context }) => {
    await uninstallFreighterWallet(context);
    await page.goto("/kyc");

    // KycPage's "Approve KYC" card is behind WalletGuard, which renders the
    // selector modal instead when no wallet is connected.
    await expect(page.getByRole("dialog", { name: "Select a wallet to connect" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Freighter wallet option" })).toBeVisible();
  });
});
