/**
 * GovernanceLog — transparent record of governance decisions made through the Admin Panel.
 *
 * Entries are persisted to localStorage so the log survives page reloads.
 * Each entry captures who took the action, what changed, and when.
 *
 * Issue #442 — Transparent Governance Voting Records
 */

import { useState, useEffect, useCallback } from "react";
import { Card } from "./ui";
import { CopyButton } from "./CopyButton";

// ── Types ─────────────────────────────────────────────────────────────────────

export type GovernanceActionType =
  | "rules_updated"
  | "pause"
  | "unpause"
  | "blocklist_add"
  | "blocklist_remove";

export interface GovernanceEntry {
  id: string;
  action: GovernanceActionType;
  actor: string;
  timestamp: string; // ISO 8601
  detail: string;
  txHash?: string;
}

const STORAGE_KEY = "veritoken-governance-log";
const MAX_ENTRIES = 200;

// ── Storage helpers ───────────────────────────────────────────────────────────

function loadEntries(): GovernanceEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as GovernanceEntry[]) : [];
  } catch {
    return [];
  }
}

function saveEntries(entries: GovernanceEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    // Storage quota exceeded; silently drop.
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Append a new governance entry. Call this after a confirmed on-chain action. */
export function recordGovernanceAction(
  action: GovernanceActionType,
  actor: string,
  detail: string,
  txHash?: string,
): void {
  const entry: GovernanceEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    action,
    actor,
    timestamp: new Date().toISOString(),
    detail,
    txHash,
  };
  const existing = loadEntries();
  saveEntries([entry, ...existing]);
  // Dispatch a storage event so any mounted GovernanceLog re-renders.
  window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
}

// ── Labels ────────────────────────────────────────────────────────────────────

const ACTION_LABELS: Record<GovernanceActionType, string> = {
  rules_updated: "Rules Updated",
  pause: "Paused",
  unpause: "Unpaused",
  blocklist_add: "Blocklisted",
  blocklist_remove: "Unblocklisted",
};

const ACTION_COLORS: Record<GovernanceActionType, string> = {
  rules_updated: "var(--accent, #7c6ef7)",
  pause: "#e05252",
  unpause: "#3db87a",
  blocklist_add: "#e05252",
  blocklist_remove: "#3db87a",
};

// ── Component ─────────────────────────────────────────────────────────────────

interface GovernanceLogProps {
  /** Limit the number of entries shown. Default: 50. */
  limit?: number;
}

export function GovernanceLog({ limit = 50 }: GovernanceLogProps) {
  const [entries, setEntries] = useState<GovernanceEntry[]>([]);

  const reload = useCallback(() => {
    setEntries(loadEntries().slice(0, limit));
  }, [limit]);

  useEffect(() => {
    reload();
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) reload();
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, [reload]);

  const handleClear = () => {
    localStorage.removeItem(STORAGE_KEY);
    setEntries([]);
  };

  return (
    <Card
      title="Governance Log"
      subtitle={`${entries.length} recorded action${entries.length === 1 ? "" : "s"}`}
      style={{ marginTop: "1.25rem" }}
    >
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "0.75rem" }}>
        <button
          onClick={handleClear}
          disabled={entries.length === 0}
          aria-label="Clear governance log"
          style={clearBtn}
        >
          Clear log
        </button>
      </div>

      {entries.length === 0 ? (
        <p style={{ fontSize: "0.875rem", color: "var(--text-muted)", padding: "1rem 0" }}>
          No governance actions recorded yet. Actions taken through the Admin Panel will appear here.
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                <th style={th}>Action</th>
                <th style={th}>Detail</th>
                <th style={th}>Actor</th>
                <th style={th}>Time</th>
                <th style={{ ...th, width: 60 }}></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={td}>
                    <span style={{
                      display: "inline-block",
                      padding: "0.15rem 0.5rem",
                      borderRadius: 4,
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      background: `color-mix(in srgb, ${ACTION_COLORS[entry.action]} 15%, transparent)`,
                      color: ACTION_COLORS[entry.action],
                    }}>
                      {ACTION_LABELS[entry.action]}
                    </span>
                  </td>
                  <td style={{ ...td, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {entry.detail}
                  </td>
                  <td style={{ ...td, fontFamily: "monospace", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {entry.actor.slice(0, 6)}…{entry.actor.slice(-6)}
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    {new Date(entry.timestamp).toLocaleString()}
                  </td>
                  <td style={td}>
                    {entry.txHash ? (
                      <CopyButton
                        text={entry.txHash}
                        label="Copy tx hash"
                        style={{ padding: "0.15rem 0.4rem", fontSize: "0.65rem", border: "none", background: "var(--surface-2)" }}
                      />
                    ) : (
                      <CopyButton
                        text={entry.actor}
                        label="Copy actor address"
                        style={{ padding: "0.15rem 0.4rem", fontSize: "0.65rem", border: "none", background: "var(--surface-2)" }}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

const th: React.CSSProperties = { padding: "0.4rem 0.5rem", fontWeight: 600, color: "var(--muted)" };
const td: React.CSSProperties = { padding: "0.4rem 0.5rem" };
const clearBtn: React.CSSProperties = {
  background: "none",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "0.25rem 0.7rem",
  cursor: "pointer",
  fontSize: "0.78rem",
  color: "var(--text-muted)",
};
