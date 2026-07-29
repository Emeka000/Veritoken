/**
 * drafts.ts — Issue #450
 *
 * Session-based drafts for multi-step forms and transaction workflows, so a
 * user can leave a long admin flow partway through and resume it later
 * without losing context. Entries live in `localStorage` (unlike
 * `sessionHistory.ts`, which is scoped to the current tab session) since the
 * whole point of a draft is to survive closing the tab and coming back.
 *
 * Drafts are opaque per-flow blobs keyed by an arbitrary `flow` string, so
 * any page can adopt this store without drafts.ts knowing its shape.
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export const DRAFT_FORMAT_VERSION = 1;

/** How long an autosaved draft stays valid before it's treated as stale. */
export const DEFAULT_DRAFT_TTL_MS = 72 * 60 * 60 * 1000; // 72 hours

export interface DraftEntry {
  version: number;
  flow: string;
  values: Record<string, unknown>;
  savedAt: string; // ISO 8601
  expiresAt: string; // ISO 8601
}

interface DraftStoreState {
  drafts: Record<string, DraftEntry>;
  saveDraft: (flow: string, values: Record<string, unknown>, ttlMs?: number) => void;
  discardDraft: (flow: string) => void;
}

const STORAGE_KEY = "veritoken-drafts";

export const useDraftStore = create<DraftStoreState>()(
  persist(
    (set) => ({
      drafts: {},
      saveDraft: (flow, values, ttlMs = DEFAULT_DRAFT_TTL_MS) => {
        const now = new Date();
        const entry: DraftEntry = {
          version: DRAFT_FORMAT_VERSION,
          flow,
          values,
          savedAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
        };
        set((state) => ({ drafts: { ...state.drafts, [flow]: entry } }));
      },
      discardDraft: (flow) => {
        set((state) => {
          if (!(flow in state.drafts)) return state;
          const drafts = { ...state.drafts };
          delete drafts[flow];
          return { drafts };
        });
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

function isValidDraft(raw: unknown): raw is DraftEntry {
  if (typeof raw !== "object" || raw === null) return false;
  const d = raw as Record<string, unknown>;
  return (
    d.version === DRAFT_FORMAT_VERSION &&
    typeof d.flow === "string" &&
    typeof d.values === "object" &&
    d.values !== null &&
    typeof d.savedAt === "string" &&
    typeof d.expiresAt === "string"
  );
}

/**
 * Read a draft for a flow, returning `undefined` if none exists, it's
 * malformed/from an older format, or it has expired. Invalid or expired
 * entries are purged from the store as a side effect.
 */
export function getDraft(flow: string): DraftEntry | undefined {
  const raw = useDraftStore.getState().drafts[flow];
  if (!raw) return undefined;

  if (!isValidDraft(raw) || new Date(raw.expiresAt).getTime() <= Date.now()) {
    useDraftStore.getState().discardDraft(flow);
    return undefined;
  }
  return raw;
}

export function hasDraft(flow: string): boolean {
  return getDraft(flow) !== undefined;
}

export function saveDraft(flow: string, values: Record<string, unknown>, ttlMs?: number): void {
  useDraftStore.getState().saveDraft(flow, values, ttlMs);
}

export function discardDraft(flow: string): void {
  useDraftStore.getState().discardDraft(flow);
}
