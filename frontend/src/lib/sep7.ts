/**
 * SEP-7 URI Scheme support for mobile wallet signing.
 *
 * SEP-7 defines a deep-link URI scheme for Stellar transactions:
 *   stellar:sign?xdr=<base64-encoded-XDR>&callback=<url>
 *
 * When Freighter is unavailable (mobile browsers, desktop users without the
 * extension) this module provides:
 *  - `buildSep7Uri`  — constructs a conformant stellar:sign URI
 *  - `isMobile`      — user-agent detection for mobile fallback
 *  - `isFreighterAvailable` — async probe for the Freighter extension
 *  - `generateQrDataUrl`    — renders the URI as a PNG data-URL via qrcode
 *  - `openSep7Link`  — opens the deep link in a new tab / triggers mobile wallet
 *
 * References:
 *  https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0007.md
 */

import QRCode from "qrcode";

// ── Detection helpers ────────────────────────────────────────────────────────

/**
 * Returns true when the page is loaded on a mobile / tablet device.
 * Checks both the modern `navigator.userAgentData` API (Chromium 90+) and the
 * classic `userAgent` string as a fallback.
 */
export function isMobile(): boolean {
  // Modern API
  if (
    typeof navigator !== "undefined" &&
    "userAgentData" in navigator &&
    (navigator as Navigator & { userAgentData?: { mobile?: boolean } })
      .userAgentData?.mobile === true
  ) {
    return true;
  }
  // Legacy string heuristic
  if (typeof navigator !== "undefined") {
    return /android|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(
      navigator.userAgent,
    );
  }
  return false;
}

import {
  isConnected as freighterIsConnected,
} from "@stellar/freighter-api";

/**
 * Returns true when the Freighter browser extension is installed and reachable.
 * Uses the `@stellar/freighter-api` `isConnected` probe with a short timeout so
 * the UI never blocks on an absent extension.
 */
export async function isFreighterAvailable(): Promise<boolean> {
  try {
    // Race against a 400 ms timeout — extension responds immediately if present.
    const result = await Promise.race([
      freighterIsConnected(),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 400)),
    ]);
    return Boolean(result);
  } catch {
    return false;
  }
}

// ── URI construction ─────────────────────────────────────────────────────────

export interface Sep7Options {
  /** Base-64 encoded XDR of the transaction to sign. */
  xdr: string;
  /**
   * Optional HTTPS callback URL.  The mobile wallet will POST the signed XDR
   * here once the user approves.  Omit if you are relying on manual copy-paste
   * or a local polling mechanism instead.
   */
  callback?: string;
  /** Human-readable description shown in the wallet app. */
  msg?: string;
  /** Stellar network passphrase — defaults to testnet. */
  networkPassphrase?: string;
  /** Origin domain for the `origin_domain` parameter. */
  originDomain?: string;
}

/**
 * Builds a SEP-7 `stellar:sign` URI from a raw XDR transaction.
 *
 * Example output:
 *   stellar:sign?xdr=AAAA...&network_passphrase=Test%20SDF%20Network%20...
 */
export function buildSep7Uri(opts: Sep7Options): string {
  const params = new URLSearchParams();
  params.set("xdr", opts.xdr);

  if (opts.networkPassphrase) {
    params.set("network_passphrase", opts.networkPassphrase);
  }
  if (opts.callback) {
    // SEP-7 requires the callback to be prefixed with "url:" when it is an
    // HTTP endpoint rather than a native deep-link scheme.
    params.set("callback", `url:${opts.callback}`);
  }
  if (opts.msg) {
    params.set("msg", opts.msg);
  }
  if (opts.originDomain) {
    params.set("origin_domain", opts.originDomain);
  }

  return `stellar:sign?${params.toString()}`;
}

// ── QR code ──────────────────────────────────────────────────────────────────

/**
 * Renders `uri` as a PNG QR code and returns a `data:image/png;base64,...`
 * string suitable for use in an `<img src>` attribute.
 *
 * Error correction level L keeps the QR small even for long XDR payloads.
 */
export async function generateQrDataUrl(uri: string): Promise<string> {
  return QRCode.toDataURL(uri, {
    errorCorrectionLevel: "L",
    margin: 2,
    width: 260,
    color: {
      dark: "#0f172a",  // matches --text-primary
      light: "#ffffff",
    },
  });
}

// ── Deep-link opener ─────────────────────────────────────────────────────────

/**
 * Opens `uri` in a new window/tab.  On mobile this triggers the OS to hand
 * off to a registered Stellar wallet app (LOBSTR, xBull, etc.).  On desktop
 * it opens a new tab containing the URI so the user can copy it manually or
 * use a QR scanner.
 */
export function openSep7Link(uri: string): void {
  window.open(uri, "_blank", "noopener,noreferrer");
}
