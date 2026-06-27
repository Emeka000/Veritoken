import {
  isConnected,
  getPublicKey,
  signTransaction,
  setAllowed,
} from "@stellar/freighter-api";
import { create } from "zustand";
import type { WalletState } from "../types";
import { NETWORK_PASSPHRASE } from "./stellar";

interface WalletStore extends WalletState {
  connect: () => Promise<void>;
  disconnect: () => void;
  signTx: (xdr: string) => Promise<string>;
}

export const useWallet = create<WalletStore>((set, get) => ({
  address: null,
  network: "TESTNET",
  connected: false,

  connect: async () => {
    if (!(await isConnected())) {
      throw new Error("Freighter wallet is not installed or unavailable");
    }
    await setAllowed();
    const address = await getPublicKey();
    set({ address, connected: true });
  },

  disconnect: () => {
    set({ address: null, connected: false });
  },

  signTx: async (xdr: string) => {
    const { address } = get();
    if (!address) throw new Error("Wallet not connected");
    return signTransaction(xdr, { networkPassphrase: NETWORK_PASSPHRASE });
  },
}));
