/**
 * Test-only bridge exposed on `window` when Vite runs in `--mode e2e`.
 *
 * Inert in every other build (`import.meta.env.MODE` is statically known at
 * build time, so this whole module is a no-op for `dev`/`build`/`test`).
 * Used by tests/e2e/specs/visual-regression.spec.ts to seed a deterministic
 * compliance notification for the notification-badge snapshot — driving that
 * badge through a real on-chain event + the alert monitor's poll interval
 * would make the screenshot timing-dependent and flaky.
 */

import { useNotificationStore, type AppNotification } from "../lib/notificationStore";
import { contracts } from "../lib/contracts/index";

declare global {
  interface Window {
    __VERITOKEN_E2E_COMPLIANCE_PAUSED__?: boolean;
    __VERITOKEN_TEST__?: {
      pushNotification: (notification: Omit<AppNotification, "id" | "timestamp" | "read">) => void;
    };
  }
}

if (import.meta.env.MODE === "e2e") {
  // Opt-in, page-local rules fixture: never submit a pause transaction or
  // mutate the shared chain state just to verify the paused indicator.
  if (window.__VERITOKEN_E2E_COMPLIANCE_PAUSED__) {
    contracts.compliance.getRules = async () => ({
      max_transfer_amount: 0n,
      min_holding_period: 0n,
      max_holders: 0,
      require_same_jurisdiction: false,
      paused: true,
      allowlist_mode: false,
      max_holding_period: 0n,
    });
  }
  window.__VERITOKEN_TEST__ = {
    pushNotification: (notification) => useNotificationStore.getState().push(notification),
  };
}
