/**
 * DraftBanner — Issue #450
 *
 * Shown at the top of a multi-step form when a saved draft exists for that
 * flow. Lets the user resume where they left off or discard the draft and
 * start fresh.
 */

import type { DraftEntry } from "../lib/drafts";

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

interface DraftBannerProps {
  draft: DraftEntry;
  onResume: () => void;
  onDiscard: () => void;
}

export function DraftBanner({ draft, onResume, onDiscard }: DraftBannerProps) {
  return (
    <div role="status" style={styles.banner}>
      <span style={styles.text}>
        You have a saved draft from <strong>{relativeTime(draft.savedAt)}</strong>.
      </span>
      <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
        <button type="button" className="btn-accent" style={styles.btn} onClick={onResume}>
          Resume draft
        </button>
        <button type="button" className="btn-ghost" style={styles.btn} onClick={onDiscard}>
          Discard
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  banner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: "0.75rem",
    padding: "0.75rem 1rem",
    borderRadius: 10,
    marginBottom: "1.25rem",
    background: "var(--warning-soft, color-mix(in srgb, #e0a752 12%, transparent))",
    border: "1px solid var(--warning, #e0a752)",
  },
  text: { fontSize: "0.85rem", color: "var(--text)" },
  btn: { fontSize: "0.78rem", padding: "0.35rem 0.8rem" },
};
