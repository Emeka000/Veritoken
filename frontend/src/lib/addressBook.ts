import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { recordSessionAction } from "./sessionHistory";

export interface AddressEntry {
  address: string;
  label: string;
}

export interface AddressBookStore {
  entries: AddressEntry[];
  addEntry: (address: string, label: string) => void;
  removeEntry: (address: string) => void;
  updateEntry: (address: string, label: string) => void;
  getEntry: (address: string) => AddressEntry | undefined;
  search: (query: string) => AddressEntry[];
}

const STORAGE_KEY = "veritoken-address-book";

export const useAddressBook = create<AddressBookStore>()(
  persist(
    (set, get) => ({
      entries: [],
      addEntry: (address: string, label: string) => {
        set((state) => {
          // Check if address already exists
          const existing = state.entries.find((e) => e.address === address);
          if (existing) {
            return {
              entries: state.entries.map((e) =>
                e.address === address ? { address, label } : e
              ),
            };
          }
          return {
            entries: [...state.entries, { address, label }],
          };
        });
        recordSessionAction("address_management", "Address book entry added", label, address);
      },
      removeEntry: (address: string) => {
        set((state) => ({
          entries: state.entries.filter((e) => e.address !== address),
        }));
        recordSessionAction("address_management", "Address book entry removed", undefined, address);
      },
      updateEntry: (address: string, label: string) => {
        set((state) => ({
          entries: state.entries.map((e) =>
            e.address === address ? { address, label } : e
          ),
        }));
        recordSessionAction("address_management", "Address book entry updated", label, address);
      },
      getEntry: (address: string) => {
        return get().entries.find((e) => e.address === address);
      },
      search: (query: string) => {
        const lowerQuery = query.toLowerCase();
        return get().entries.filter(
          (e) =>
            e.address.toLowerCase().includes(lowerQuery) ||
            e.label.toLowerCase().includes(lowerQuery)
        );
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
    }
  )
);
