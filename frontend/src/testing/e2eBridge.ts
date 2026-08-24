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

declare global {
  interface Window {
    __VERITOKEN_TEST__?: {
      pushNotification: (notification: Omit<AppNotification, "id" | "timestamp" | "read">) => void;
    };
  }
}

if (import.meta.env.MODE === "e2e") {
  window.__VERITOKEN_TEST__ = {
    pushNotification: (notification) => useNotificationStore.getState().push(notification),
  };
}
