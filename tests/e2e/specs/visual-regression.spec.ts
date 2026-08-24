import * as fs from "node:fs";
import * as path from "node:path";
import { expect, test } from "@playwright/test";
import { e2eKeypair } from "../fixtures/accounts";
import { approveKyc, fundAccount } from "../fixtures/chain-helpers";
import { installFreighterWallet } from "../fixtures/freighter-shim";

// No baseline PNGs are committed yet (see the doc comment below) — skip
// rather than fail so a fresh checkout's CI run is green up to the point
// someone actually generates and commits them, instead of red for a reason
// this suite can't fix on its own.
const SCREENSHOTS_DIR = path.resolve(import.meta.dirname, "../__screenshots__");
const BASELINES_EXIST =
  fs.existsSync(SCREENSHOTS_DIR) &&
  fs.readdirSync(SCREENSHOTS_DIR, { recursive: true }).some((f) => String(f).endsWith(".png"));
const SKIP_REASON =
  "No committed baseline PNGs yet — run `npm run update-snapshots` in tests/e2e/ " +
  "(against a machine with Docker + Playwright's browsers) and commit __screenshots__/. See README.md.";

declare global {
  interface Window {
    __VERITOKEN_TEST__?: {
      pushNotification: (notification: {
        title: string;
        message: string;
        severity: "info" | "warning" | "critical";
        category: "kyc" | "compliance" | "transfer" | "pause" | "governance" | "system";
      }) => void;
    };
  }
}

/**
 * Baselines must exist before these assertions can pass — run
 * `npm run update-snapshots` (in tests/e2e/) once, against a machine with
 * Docker and Playwright's browsers installed, then commit the generated
 * PNGs under tests/e2e/__screenshots__/. Nothing in this repo can generate
 * them without a real browser + a live standalone node — until that's done,
 * `beforeEach` below skips these rather than fail every run for a reason
 * this suite can't fix on its own.
 */
test.describe("Visual regression", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test.beforeEach(() => {
    test.skip(!BASELINES_EXIST, SKIP_REASON);
  });

  test("admin dashboard layout (desktop 1280x800)", async ({ page, context }) => {
    const wallet = e2eKeypair("visual-dashboard");
    await fundAccount(wallet);
    await approveKyc(wallet.publicKey(), { tier: 2, jurisdiction: "US" });

    await installFreighterWallet(context, wallet);
    await page.goto("/admin");
    await page.getByRole("button", { name: "Connect Wallet" }).click();

    await expect(page.getByRole("heading", { name: "Admin Panel" })).toBeVisible();
    // Wait out the rules/blocklist skeleton loaders so the snapshot is stable.
    await expect(page.locator("[aria-label='Loading compliance rules']")).toHaveCount(0);
    await expect(page.locator("[aria-label='Loading blocklist']")).toHaveCount(0);

    await expect(page).toHaveScreenshot("admin-dashboard.png", { fullPage: true });
  });

  test("KYC status panel (approved state)", async ({ page, context }) => {
    const wallet = e2eKeypair("visual-kyc");
    await fundAccount(wallet);
    await approveKyc(wallet.publicKey(), {
      tier: 1,
      jurisdiction: "US",
      expirySecondsFromNow: 365 * 86_400,
    });

    await installFreighterWallet(context, wallet);
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Connect Wallet" }).click();

    const panel = page.getByTestId("kyc-approved");
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(panel).toHaveScreenshot("kyc-status-approved.png");
  });

  test("compliance alert notification badge", async ({ page, context }) => {
    const wallet = e2eKeypair("visual-compliance");
    await installFreighterWallet(context, wallet);

    await page.goto("/");
    await page.getByRole("button", { name: "Connect Wallet" }).click();

    // Seed a deterministic notification instead of waiting on a live
    // on-chain event + the alert monitor's poll interval (see e2eBridge.ts).
    await page.evaluate(() => {
      window.__VERITOKEN_TEST__?.pushNotification({
        title: "Compliance rule violation",
        message: "Playwright visual-regression.spec.ts seeded alert",
        severity: "critical",
        category: "compliance",
      });
    });

    const bell = page.getByRole("button", { name: /^Notifications/ });
    await expect(bell).toBeVisible();
    await expect(bell).toHaveScreenshot("compliance-alert-badge.png");
  });
});
