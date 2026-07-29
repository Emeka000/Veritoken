/**
 * Session action history — a lightweight, session-scoped audit trail of the
 * user's own interactions (wallet connects, form submissions, address book
 * and governance changes) for support and audit review.
 *
 * Entries live in `sessionStorage` (cleared when the tab closes) rather than
 * `localStorage` — this is a replay of the *current* session, distinct from
 * the permanent on-chain-action record kept by GovernanceLog.
 *
 * Issue #390 — Session Replay and Audit of User Actions
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

// ── Types ─────────────────────────────────────────────────────────────────────

export type SessionActionCategory =
  | "wallet"
  | "form_submission"
  | "rule_change"
  | "address_management"
  | "other";

export interface SessionActionEntry {
  id: string;
  category: SessionActionCategory;
  label: string;
  detail?: string;
  actor?: string;
  timestamp: string; // ISO 8601
}

interface SessionHistoryStore {
  entries: SessionActionEntry[];
  record: (category: SessionActionCategory, label: string, detail?: string, actor?: string) => void;
  clear: () => void;
}

const STORAGE_KEY = "veritoken-session-history";
const MAX_ENTRIES = 200;

// ── Store ─────────────────────────────────────────────────────────────────────

export const useSessionHistory = create<SessionHistoryStore>()(
  persist(
    (set) => ({
      entries: [],
      record: (category, label, detail, actor) => {
        const entry: SessionActionEntry = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          category,
          label,
          detail,
          actor,
          timestamp: new Date().toISOString(),
        };
        set((state) => ({ entries: [entry, ...state.entries].slice(0, MAX_ENTRIES) }));
      },
      clear: () => set({ entries: [] }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => sessionStorage),
    },
  ),
);

/**
 * Record a session action from outside a React component (e.g. a lib
 * module like wallet.ts or addressBook.ts that isn't a hook itself).
 */
export function recordSessionAction(
  category: SessionActionCategory,
  label: string,
  detail?: string,
  actor?: string,
): void {
  useSessionHistory.getState().record(category, label, detail, actor);
}
