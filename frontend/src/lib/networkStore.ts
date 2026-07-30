import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type Network = "testnet" | "mainnet";

export interface NetworkStore {
  network: Network;
  setNetwork: (network: Network) => void;
}

const STORAGE_KEY = "veritoken-network";

export const useNetworkStore = create<NetworkStore>()(
  persist(
    (set) => ({
      network: (import.meta.env.VITE_STELLAR_NETWORK as Network) ?? "testnet",
      setNetwork: (network: Network) => set({ network }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
    }
  )
);

// RPC URL / passphrase resolution (including custom RPC overrides, #451) now
// lives in `@veritoken/sdk`'s `resolveNetworkConfig` — see `stellar.ts`'s
// `getRpcUrl`/`getNetworkPassphrase`, which bridge this store's `network`
// plus `VITE_SOROBAN_RPC_URL` / `VITE_STELLAR_NETWORK_PASSPHRASE` /
// `VITE_RPC_ALLOW_HTTP` into it.
