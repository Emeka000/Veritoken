/**
 * backupHistory.ts — Issue #454
 *
 * Lightweight, localStorage-backed history of compliance-config backup
 * (export) and restore (apply) events, so an operator can see at a glance
 * when the config was last backed up and what was last restored — without
 * needing to dig through the browser's download folder or the Governance
 * Log's per-field diffs.
 *
 * Follows the same raw-localStorage + `storage`-event pattern as
 * GovernanceLog (components/GovernanceLog.tsx) rather than a zustand store,
 * since this is a plain data log with no reactive form state attached.
 */

export type BackupEventType = "export" | "restore";

export interface BackupHistoryEntry {
  id: string;
  type: BackupEventType;
  label: string;
  network: string;
  timestamp: string; // ISO 8601
  /** Short human-readable summary, e.g. "2 tier policies, risk config applied". */
  summary?: string;
}

const STORAGE_KEY = "veritoken-backup-history";
const MAX_ENTRIES = 100;

function loadEntries(): BackupHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as BackupHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function saveEntries(entries: BackupHistoryEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    // Storage quota exceeded; silently drop.
  }
}

/** Append a new backup/restore event. Call after a successful export or apply. */
export function recordBackupEvent(input: {
  type: BackupEventType;
  label: string;
  network: string;
  summary?: string;
}): void {
  const entry: BackupHistoryEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: input.type,
    label: input.label,
    network: input.network,
    summary: input.summary,
    timestamp: new Date().toISOString(),
  };
  saveEntries([entry, ...loadEntries()]);
  window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
}

/** Returns backup/restore history, most recent first. */
export function getBackupHistory(): BackupHistoryEntry[] {
  return loadEntries();
}

/** Clears all recorded backup/restore history. */
export function clearBackupHistory(): void {
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
}
