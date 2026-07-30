/**
 * snapshots.ts — Issue #448
 *
 * Historical state snapshots for admin/compliance configuration, so
 * maintainers can inspect a past configuration and restore it if a change
 * goes wrong. Snapshot scope mirrors `complianceConfig.ts` (issue #436): the
 * compliance rules, tier policies, and risk config, plus the blocklist,
 * since both are already fetched together in the Admin and Compliance Config
 * I/O pages.
 *
 * Restoring a snapshot is intentionally *not* a direct on-chain write from
 * this module — a snapshot's `config` is handed to the same
 * import/apply/ConfirmDialog flow already used for file-based config import,
 * so there's exactly one code path that submits a compliance rule change.
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { exportConfig, type ComplianceConfigExport } from "./complianceConfig";
import type { ComplianceRules, TierPolicy, RiskConfig } from "../types";

export const SNAPSHOT_FORMAT_VERSION = 1;
const MAX_SNAPSHOTS = 25;
const STORAGE_KEY = "veritoken-snapshots";

export interface AdminSnapshot {
  version: number;
  id: string;
  label: string;
  network: string;
  createdAt: string; // ISO 8601
  config: ComplianceConfigExport;
  blocklist: string[];
}

interface SnapshotStoreState {
  snapshots: AdminSnapshot[];
  addSnapshot: (snapshot: AdminSnapshot) => void;
  removeSnapshot: (id: string) => void;
}

export const useSnapshotStore = create<SnapshotStoreState>()(
  persist(
    (set) => ({
      snapshots: [],
      addSnapshot: (snapshot) =>
        set((state) => ({
          snapshots: [snapshot, ...state.snapshots].slice(0, MAX_SNAPSHOTS),
        })),
      removeSnapshot: (id) =>
        set((state) => ({
          snapshots: state.snapshots.filter((s) => s.id !== id),
        })),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

export function isValidSnapshot(raw: unknown): raw is AdminSnapshot {
  if (typeof raw !== "object" || raw === null) return false;
  const s = raw as Record<string, unknown>;
  return (
    s.version === SNAPSHOT_FORMAT_VERSION &&
    typeof s.id === "string" &&
    typeof s.label === "string" &&
    typeof s.network === "string" &&
    typeof s.createdAt === "string" &&
    typeof s.config === "object" &&
    s.config !== null &&
    Array.isArray(s.blocklist)
  );
}

/** Build a new snapshot entry from the currently-fetched on-chain state. */
export function createSnapshot(
  label: string,
  network: string,
  rules: ComplianceRules,
  tierPolicies: Array<{ fromTier: number; toTier: number; policy: TierPolicy | null }>,
  riskConfig: RiskConfig | null,
  blocklist: string[],
): AdminSnapshot {
  const config = exportConfig(rules, tierPolicies, riskConfig, { label, network });
  return {
    version: SNAPSHOT_FORMAT_VERSION,
    id: `snap-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    label,
    network,
    createdAt: config.exportedAt,
    config,
    blocklist,
  };
}

/** Snapshots newest first, with any corrupted/old-format entries filtered out. */
export function listSnapshots(): AdminSnapshot[] {
  return useSnapshotStore.getState().snapshots.filter(isValidSnapshot);
}

export function addSnapshot(snapshot: AdminSnapshot): void {
  useSnapshotStore.getState().addSnapshot(snapshot);
}

export function removeSnapshot(id: string): void {
  useSnapshotStore.getState().removeSnapshot(id);
}
