import type { ConflictWarning } from "../lib/conflictDetection";

interface Props {
  warnings: ConflictWarning[];
}

export default function ConflictWarningBanner({ warnings }: Props) {
  if (warnings.length === 0) return null;

  const hasBlocking = warnings.some((w) => w.severity === "blocking");

  return (
    <div
      role="alert"
      style={{
        marginBottom: "1rem",
        borderRadius: 10,
        border: `1px solid ${hasBlocking ? "var(--danger, #ef4444)" : "var(--warning, #f59e0b)"}`,
        background: hasBlocking
          ? "color-mix(in srgb, #ef4444 10%, transparent)"
          : "color-mix(in srgb, #f59e0b 10%, transparent)",
        padding: "0.75rem 1rem",
      }}
    >
      <p style={{ fontSize: "0.8rem", fontWeight: 700, marginBottom: warnings.length > 1 ? "0.5rem" : 0, color: hasBlocking ? "var(--danger, #ef4444)" : "var(--warning, #f59e0b)" }}>
        {hasBlocking ? "Action blocked — conflict detected" : "Conflict warning"}
      </p>
      {warnings.length === 1 ? (
        <p style={{ fontSize: "0.8rem", color: "var(--text)", margin: 0, lineHeight: 1.5 }}>
          {warnings[0].message}
        </p>
      ) : (
        <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
          {warnings.map((w, i) => (
            <li key={i} style={{ fontSize: "0.8rem", color: "var(--text)", lineHeight: 1.5 }}>
              {w.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
