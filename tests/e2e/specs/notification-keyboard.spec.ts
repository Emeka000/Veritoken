import { expect, test } from "@playwright/test";

for (const key of ["Enter", "Space"]) {
  test("dismisses a notification with " + key, async ({ page }) => {
    await page.goto("/docs");
    await expect(page.getByRole("heading", { name: "Documentation", exact: true })).toBeVisible();
    await page.waitForFunction(() => Boolean(window.__VERITOKEN_TEST__));
    await page.evaluate(() => {
      window.__VERITOKEN_TEST__!.pushNotification({
        title: "Transaction confirmed",
        message: "Your transfer completed successfully.",
        severity: "info",
        category: "transfer",
      });
    });

    const bell = page.getByRole("button", { name: "Notifications, 1 unread", exact: true });
    await bell.focus();
    await page.keyboard.press("Enter");
    const center = page.getByRole("dialog", { name: "Notification center" });
    await expect(center.getByText("Transaction confirmed", { exact: true })).toBeVisible();

    // Follow the tab order through the header actions and mark-read control.
    await page.keyboard.press("Tab");
    await expect(center.getByRole("button", { name: "Mark all read", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(center.getByRole("button", { name: "Clear all notifications" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(center.getByRole("button", { name: "Mark as read", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(center.getByRole("button", { name: "Dismiss notification", exact: true })).toBeFocused();
    await page.keyboard.press(key);

    await expect(center.getByText("Transaction confirmed", { exact: true })).toHaveCount(0);
    await expect(center.getByRole("button", { name: "Dismiss notification" })).toHaveCount(0);
    await expect(center.getByText("No notifications yet", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Notifications", exact: true })).toBeVisible();
  });
}
