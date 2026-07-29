/**
 * ContractStateSummary — Issue #438
 *
 * Fetches the global contract snapshot and renders an AI-assisted
 * plain-language summary via AiSummaryPanel.  Designed to be embedded on
 * the Admin page or the Operator Dashboard.
 */

import { useState, useEffect } from "react";
import { readApi } from "../lib/readApi";
import { summariseGlobalSnapshot } from "../lib/aiSummary";
import AiSummaryPanel from "./AiSummaryPanel";
import type { StateSummary } from "../lib/aiSummary";
import type { CSSProperties } from "react";

interface Props {
  /** Refresh the summary every N ms. Pass 0 to disable auto-refresh. Default: 0. */
  refreshIntervalMs?: number;
  style?: CSSProperties;
}

export default function ContractStateSummary({ refreshIntervalMs = 0, style }: Props) {
  const [summary, setSummary] = useState<StateSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const snap = await readApi.globalSnapshot();
      setSummary(summariseGlobalSnapshot(snap));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load contract state.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    if (refreshIntervalMs > 0) {
      const id = setInterval(load, refreshIntervalMs);
      return () => clearInterval(id);
    }
  }, [refreshIntervalMs]);

  if (error) {
    return (
      <div
        role="alert"
        style={{
          borderRadius: 12,
          border: "1px solid rgba(248,113,113,0.3)",
          background: "rgba(248,113,113,0.07)",
          padding: "0.85rem 1rem",
          fontSize: "0.845rem",
          color: "#f87171",
          ...style,
        }}
      >
        Could not load contract summary: {error}
      </div>
    );
  }

  // While loading, show the panel in skeleton state
  const placeholderSummary: StateSummary = {
    headline: "",
    status: "healthy",
    bullets: [],
    generatedAt: new Date().toISOString(),
  };

  return (
    <div style={style}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.6rem" }}>
        <span style={{ fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-faint)" }}>
          AI-Assisted State Summary
        </span>
        <button
          onClick={load}
          disabled={loading}
          aria-label="Refresh summary"
          style={{
            background: "none",
            border: "none",
            cursor: loading ? "default" : "pointer",
            color: "var(--accent-2)",
            fontSize: "0.78rem",
            padding: "0.2rem 0.4rem",
            borderRadius: 6,
            opacity: loading ? 0.4 : 1,
          }}
        >
          ↻ Refresh
        </button>
      </div>
      <AiSummaryPanel
        summary={summary ?? placeholderSummary}
        loading={loading}
      />
    </div>
  );
}
