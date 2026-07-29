/**
 * SessionHistory — displays the current session's recorded user actions for
 * support and audit review (wallet connects, form submissions, rule changes,
 * address book edits). Backed by `useSessionHistory` (sessionStorage-scoped —
 * cleared when the tab closes).
 *
 * Issue #390 — Session Replay and Audit of User Actions
 */

import { useSessionHistory, type SessionActionCategory } from "../lib/sessionHistory";
import { Card } from "./ui";
import { CopyButton } from "./CopyButton";

const CATEGORY_LABELS: Record<SessionActionCategory, string> = {
  wallet: "Wallet",
  form_submission: "Form Submission",
  rule_change: "Rule Change",
  address_management: "Address Management",
  other: "Other",
};

const CATEGORY_COLORS: Record<SessionActionCategory, string> = {
  wallet: "var(--accent, #7c6ef7)",
  form_submission: "#3db87a",
  rule_change: "#e0a752",
  address_management: "#4ea1e0",
  other: "var(--text-muted)",
};

interface SessionHistoryProps {
  /** Limit the number of entries shown. Default: 50. */
  limit?: number;
}

export function SessionHistory({ limit = 50 }: SessionHistoryProps) {
  const allEntries = useSessionHistory((s) => s.entries);
  const entries = allEntries.slice(0, limit);
  const clear = useSessionHistory((s) => s.clear);

  return (
    <Card
      title="Session History"
      subtitle={`${allEntries.length} action${allEntries.length === 1 ? "" : "s"} recorded this session`}
      style={{ marginTop: "1.25rem" }}
    >
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "0.75rem" }}>
        <button
          onClick={clear}
          disabled={entries.length === 0}
          aria-label="Clear session history"
          style={clearBtn}
        >
          Clear history
        </button>
      </div>

      {entries.length === 0 ? (
        <p style={{ fontSize: "0.875rem", color: "var(--text-muted)", padding: "1rem 0" }}>
          No actions recorded yet this session. Wallet connections, form submissions, and
          governance changes will appear here as you use the app.
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                <th style={th}>Type</th>
                <th style={th}>Action</th>
                <th style={th}>Detail</th>
                <th style={th}>Time</th>
                <th style={{ ...th, width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={td}>
                    <span
                      style={{
                        display: "inline-block",
                        padding: "0.15rem 0.5rem",
                        borderRadius: 4,
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        background: `color-mix(in srgb, ${CATEGORY_COLORS[entry.category]} 15%, transparent)`,
                        color: CATEGORY_COLORS[entry.category],
                      }}
                    >
                      {CATEGORY_LABELS[entry.category]}
                    </span>
                  </td>
                  <td style={td}>{entry.label}</td>
                  <td
                    style={{
                      ...td,
                      maxWidth: 220,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {entry.detail ?? ""}
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    {new Date(entry.timestamp).toLocaleString()}
                  </td>
                  <td style={td}>
                    {entry.actor && (
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
