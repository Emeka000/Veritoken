import {
  getPublicKey,
  signTransaction,
  setAllowed,
} from "@stellar/freighter-api";
import { create } from "zustand";
import type { WalletState } from "../types";
import { NETWORK_PASSPHRASE } from "./stellar";
import { buildSep7Uri, isFreighterAvailable, isMobile, openSep7Link } from "./sep7";
import { recordSessionAction } from "./sessionHistory";

interface WalletStore extends WalletState {
  connect: () => Promise<void>;
  disconnect: () => void;
  signTx: (xdr: string) => Promise<string>;
  /**
   * Generates a SEP-7 `stellar:sign` URI for the given XDR and opens it as a
   * deep link.  For mobile users this hands off to the device's registered
   * Stellar wallet (LOBSTR, xBull, etc.).  On desktop the URI can be scanned
   * via the QR code shown in WalletGuard.
   *
   * Because mobile wallets sign and submit independently, this path does NOT
   * return a signed XDR — it returns the URI so the caller can display / poll.
   */
  signTxSep7: (xdr: string, opts?: { msg?: string; callback?: string }) => string;
  /** Whether Freighter was detected on the last `connect` attempt. */
  freighterAvailable: boolean;
  /** Whether the current device is mobile (set once on first `connect`). */
  onMobile: boolean;
}

export const useWallet = create<WalletStore>((set, get) => ({
  address: null,
  network: "TESTNET",
  connected: false,
  freighterAvailable: false,
  onMobile: isMobile(),

  connect: async () => {
    const freighter = await isFreighterAvailable();
    set({ freighterAvailable: freighter, onMobile: isMobile() });

    if (!freighter) {
      throw new Error(
        "Freighter wallet is not installed or unavailable. " +
        "Use the mobile wallet option to sign transactions.",
      );
    }
    await setAllowed();
    const address = await getPublicKey();
    set({ address, connected: true });
    recordSessionAction("wallet", "Wallet connected", undefined, address);
  },

  disconnect: () => {
    const { address } = get();
    set({ address: null, connected: false });
    recordSessionAction("wallet", "Wallet disconnected", undefined, address ?? undefined);
  },

  signTx: async (xdr: string) => {
    const { address } = get();
    if (!address) throw new Error("Wallet not connected");
    return signTransaction(xdr, { networkPassphrase: NETWORK_PASSPHRASE });
  },

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
export { isFreighterAvailable, isMobile, buildSep7Uri, generateQrDataUrl } from "./sep7";
