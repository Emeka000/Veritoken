/**
 * Freighter wallet shim.
 *
 * The frontend never calls a `window.freighter` API surface directly — it
 * imports named functions (`getPublicKey`, `signTransaction`, `setAllowed`,
 * `isConnected`) from `@stellar/freighter-api`, which itself talks to the
 * real extension over an undocumented `window.postMessage` protocol
 * (`FREIGHTER_EXTERNAL_MSG_REQUEST` / `..._RESPONSE`, private to that
 * package's `@shared/api/external` internals and not a stable contract to
 * build against).
 *
 * Rather than reverse-engineer that wire protocol, `frontend/vite.config.ts`
 * aliases `@stellar/freighter-api` to `frontend/src/testing/freighterApiMock.ts`
 * when Vite runs in `--mode e2e` (see global-setup.ts, which starts the dev
 * server that way). The mock module reads the keypair this shim injects and
 * signs locally with `@stellar/stellar-sdk` — no extension, no postMessage,
 * fully deterministic. It also sets `window.freighter = true`, matching the
 * boolean fast-path `isConnected()` checks for in the real package, so the
 * shim still "looks like" a real `window.freighter` presence for any code
 * that checks it directly.
 *
 * Each test calls `installFreighterWallet(context, keypair)` with its own
 * keypair before navigating, so different tests can act as different wallets
 * without cross-test interference.
 */

import type { BrowserContext, Page } from "@playwright/test";
import type { Keypair } from "./stellar-sdk";

export interface E2EWalletInjection {
  publicKey: string;
  secret: string;
}

declare global {
  interface Window {
    __VERITOKEN_E2E_WALLET__?: E2EWalletInjection;
    freighter?: boolean;
  }
}

function toInjection(keypair: Keypair): E2EWalletInjection {
  return { publicKey: keypair.publicKey(), secret: keypair.secret() };
}

/**
 * Injects the mock wallet into every future page in `context` (init scripts
 * apply to the context, so this must be called before `page.goto`).
 */
export async function installFreighterWallet(
  context: BrowserContext,
  keypair: Keypair,
): Promise<void> {
  await context.addInitScript((wallet: E2EWalletInjection) => {
    window.__VERITOKEN_E2E_WALLET__ = wallet;
    window.freighter = true;
  }, toInjection(keypair));
}

/**
 * Same as `installFreighterWallet` but scoped to a single already-created
 * page (used when a test needs to swap wallets mid-run, e.g. simulating a
 * different Freighter account being selected before a reconnect).
 */
export async function installFreighterWalletOnPage(
  page: Page,
  keypair: Keypair,
): Promise<void> {
  await page.addInitScript((wallet: E2EWalletInjection) => {
    window.__VERITOKEN_E2E_WALLET__ = wallet;
    window.freighter = true;
  }, toInjection(keypair));
}

/** Removes the mock wallet so `isConnected()`/`isAvailable()` reports false. */
export async function uninstallFreighterWallet(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    delete window.__VERITOKEN_E2E_WALLET__;
    window.freighter = false;
  });
}
