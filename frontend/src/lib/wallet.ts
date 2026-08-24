/**
 * Zustand wallet store — issue #545
 *
 * Replaces direct `@stellar/freighter-api` calls with a pluggable
 * `WalletProvider` slot.  The active provider type is persisted to
 * `localStorage` so the last-used wallet reconnects automatically on page
 * refresh (Freighter and WalletConnect auto-reconnect; Ledger requires the
 * user to re-plug and confirm).
 */

import { create } from "zustand";
import type { WalletState } from "../types";
import { NETWORK_PASSPHRASE } from "./stellar";
import {
  buildSep7Uri,
  isFreighterAvailable,
  isMobile,
  openSep7Link,
} from "./sep7";
import { recordSessionAction } from "./sessionHistory";
import {
  type ProviderType,
  type WalletProvider,
  createProvider,
} from "./walletProvider";

// ── Persistence key ──────────────────────────────────────────────────────────

const PROVIDER_TYPE_KEY = "veritoken-wallet-provider";

function loadPersistedProviderType(): ProviderType | null {
  try {
    const stored = localStorage.getItem(PROVIDER_TYPE_KEY) as ProviderType | null;
    if (stored === "freighter" || stored === "ledger" || stored === "walletconnect") {
      return stored;
    }
  } catch {
    // localStorage unavailable (SSR / private mode)
  }
  return null;
}

function saveProviderType(type: ProviderType): void {
  try {
    localStorage.setItem(PROVIDER_TYPE_KEY, type);
  } catch {
    // Ignore
  }
}

function clearProviderType(): void {
  try {
    localStorage.removeItem(PROVIDER_TYPE_KEY);
  } catch {
    // Ignore
  }
}

// ── Store interface ───────────────────────────────────────────────────────────

interface WalletStore extends WalletState {
  /** Currently active provider instance, or null when disconnected. */
  provider: WalletProvider | null;

  /** Which provider type is currently in use. */
  providerType: ProviderType | null;

  /**
   * Selects a provider by type, connects it, and updates the store.
   * Persists `type` to localStorage for auto-reconnect on page refresh.
   */
  selectProvider(type: ProviderType): Promise<void>;

  /**
   * Attempts to reconnect using the previously persisted provider type.
   * Call this once on app startup.  Silently returns if no prior type is
   * stored, or if `isAvailable()` returns false for that type.
   */
  autoReconnect(): Promise<void>;

  /** Disconnects the active provider and clears all state. */
  disconnect(): Promise<void>;

  /** Sign an XDR transaction with the active provider. */
  signTx(xdr: string): Promise<string>;

  // ── Legacy helpers preserved for backwards compatibility ─────────────────

  /** @deprecated Use selectProvider("freighter") instead. */
  connect(): Promise<void>;

  /**
   * Generates a SEP-7 `stellar:sign` URI for the given XDR and opens it as a
   * deep link.  Returns the URI so the caller can display / poll.
   */
  signTxSep7(xdr: string, opts?: { msg?: string; callback?: string }): string;

  /** Whether Freighter was detected on the last `connect` attempt. */
  freighterAvailable: boolean;

  /** Whether the current device is mobile (set once on first `connect`). */
  onMobile: boolean;
}

// ── Store implementation ──────────────────────────────────────────────────────

export const useWallet = create<WalletStore>((set, get) => ({
  address: null,
  network: "TESTNET",
  connected: false,
  provider: null,
  providerType: null,
  freighterAvailable: false,
  onMobile: isMobile(),

  // ── selectProvider ────────────────────────────────────────────────────────

  selectProvider: async (type: ProviderType) => {
    // Disconnect any existing provider first.
    const existing = get().provider;
    if (existing) {
      try {
        await existing.disconnect();
      } catch {
        // Best-effort
      }
    }

    const network = get().network === "MAINNET" ? "mainnet" : "testnet";
    const instance = createProvider(type, NETWORK_PASSPHRASE, network);

    if (!(await instance.isAvailable())) {
      throw new Error(
        type === "freighter"
          ? "Freighter extension is not installed."
          : type === "ledger"
            ? "Ledger via WebUSB requires Chrome, Edge, or Brave."
            : "WalletConnect is not supported in this environment.",
      );
    }

    const address = await instance.connect();

    saveProviderType(type);
    set({
      provider: instance,
      providerType: type,
      address,
      connected: true,
      freighterAvailable: type === "freighter",
    });

    recordSessionAction("wallet", `Wallet connected via ${type}`, undefined, address);
  },

  // ── autoReconnect ─────────────────────────────────────────────────────────

  autoReconnect: async () => {
    const storedType = loadPersistedProviderType();
    if (!storedType) return;

    const network = get().network === "MAINNET" ? "mainnet" : "testnet";
    const instance = createProvider(storedType, NETWORK_PASSPHRASE, network);

    if (!(await instance.isAvailable())) return;

    // Ledger requires physical confirmation on each page load — skip auto-connect.
    if (storedType === "ledger") return;

    try {
      const address = await instance.connect();
      set({
        provider: instance,
        providerType: storedType,
        address,
        connected: true,
        freighterAvailable: storedType === "freighter",
      });
    } catch {
      // Silently fail — user will see the connect prompt instead.
    }
  },

  // ── disconnect ────────────────────────────────────────────────────────────

  disconnect: async () => {
    const { provider, address } = get();
    if (provider) {
      try {
        await provider.disconnect();
      } catch {
        // Best-effort
      }
    }
    clearProviderType();
    set({
      provider: null,
      providerType: null,
      address: null,
      connected: false,
      freighterAvailable: false,
    });
    recordSessionAction("wallet", "Wallet disconnected", undefined, address ?? undefined);
  },

  // ── signTx ────────────────────────────────────────────────────────────────

  signTx: async (xdr: string) => {
    const { provider, address } = get();
    if (!provider || !address) throw new Error("Wallet not connected");
    return provider.signXdr(xdr);
  },

  // ── Legacy: connect (Freighter shortcut) ─────────────────────────────────

  connect: async () => {
    const freighter = await isFreighterAvailable();
    set({ freighterAvailable: freighter, onMobile: isMobile() });

    if (!freighter) {
      throw new Error(
        "Freighter wallet is not installed or unavailable. " +
        "Use the wallet selector to choose an alternative provider.",
      );
    }

    await get().selectProvider("freighter");
  },

  // ── signTxSep7 ────────────────────────────────────────────────────────────

  signTxSep7: (xdr: string, opts = {}) => {
    const uri = buildSep7Uri({
      xdr,
      networkPassphrase: NETWORK_PASSPHRASE,
      msg: opts.msg,
      callback: opts.callback,
    });
    openSep7Link(uri);
    return uri;
  },
}));

// Re-export helpers so other modules can import from a single place.
export {
  isFreighterAvailable,
  isMobile,
  buildSep7Uri,
  generateQrDataUrl,
} from "./sep7";
export type { ProviderType, WalletProvider } from "./walletProvider";
