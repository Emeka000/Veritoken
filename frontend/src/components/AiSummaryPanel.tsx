/**
 * AiSummaryPanel — Issue #438
 *
 * Displays a plain-language AI-assisted summary of contract state.
 * Accepts a StateSummary object and renders it with a status-appropriate
 * colour scheme.
 */

import type { CSSProperties } from "react";
import type { StateSummary } from "../lib/aiSummary";

const STATUS_COLORS: Record<StateSummary["status"], { bg: string; border: string; label: string; dot: string }> = {
  healthy: {
    bg: "rgba(52, 211, 153, 0.08)",
    border: "rgba(52, 211, 153, 0.3)",
    label: "All Clear",
    dot: "var(--success, #34d399)",
  },
  warning: {
    bg: "rgba(251, 191, 36, 0.08)",
    border: "rgba(251, 191, 36, 0.3)",
    label: "Attention",
    dot: "var(--warning, #fbbf24)",
  },
  critical: {
    bg: "rgba(248, 113, 113, 0.08)",
    border: "rgba(248, 113, 113, 0.3)",
    label: "Critical",
    dot: "var(--danger, #f87171)",
  },
};

interface Props {
  summary: StateSummary;
  loading?: boolean;
  style?: CSSProperties;
}

export default function AiSummaryPanel({ summary, loading = false, style }: Props) {
  const colors = STATUS_COLORS[summary.status];

  if (loading) {
    return (
      <div
        style={{
          ...containerStyle,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          ...style,
        }}
        aria-busy="true"
        aria-label="Generating summary…"
      >
        <div style={headerStyle}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "var(--text-faint)",
              flexShrink: 0,
              animation: "pulse 1.4s ease-in-out infinite",
            }}
          />
          <span className="muted" style={{ fontSize: "0.8rem", fontWeight: 600 }}>
            Generating summary…
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      role="region"
      aria-label="AI-assisted contract state summary"
      style={{
        ...containerStyle,
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        ...style,
      }}
    >
      {/* Header */}
      <div style={headerStyle}>
        <span
          aria-hidden="true"
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: colors.dot,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontSize: "0.72rem",
            fontWeight: 700,
            textTransform: "uppercase" as const,
            letterSpacing: "0.07em",
            color: colors.dot,
          }}
        >
          AI Summary · {colors.label}
        </span>
        <span
          className="muted"
          style={{ marginLeft: "auto", fontSize: "0.72rem" }}
          aria-label={`Summary generated at ${new Date(summary.generatedAt).toLocaleTimeString()}`}
        >
          {new Date(summary.generatedAt).toLocaleTimeString()}
        </span>
      </div>

      {/* Headline */}
      <p style={{ fontWeight: 600, fontSize: "0.925rem", margin: "0.6rem 0 0.75rem" }}>
        {summary.headline}
      </p>

      {/* Bullet points */}
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "flex",
          flexDirection: "column",
          gap: "0.4rem",
        }}
        aria-label="Summary details"
      >
        {summary.bullets.map((b, i) => (
          <li
            key={i}
            style={{
              fontSize: "0.845rem",
              color: "var(--text-muted)",
              paddingLeft: "1.1rem",
              position: "relative",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                left: 0,
                top: "0.05em",
                color: "var(--text-faint)",
                fontSize: "0.7rem",
              }}
            >
              ›
            </span>
            {b}
          </li>
        ))}
      </ul>
    </div>
  );
}

const containerStyle: CSSProperties = {
  borderRadius: 12,
  padding: "1rem 1.1rem",
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.55rem",
};
