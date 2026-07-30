import { useState, useEffect, useCallback } from "react";
import { PageHeader, Card, Icon } from "../components/ui";
import { deploymentHealth } from "../lib/deploymentHealth";
import type { DeploymentHealthReport, ContractHealthEntry, HealthStatus } from "../lib/deploymentHealth";

const REFRESH_INTERVAL_MS = 60_000;

// ── Status colours ────────────────────────────────────────────────────────────

function statusColor(status: HealthStatus): string {
  switch (status) {
    case "ok": return "var(--success, #22c55e)";
    case "degraded": return "var(--warning, #f59e0b)";
    case "misconfigured": return "var(--warning, #f59e0b)";
    case "unreachable": return "var(--danger, #ef4444)";
  }
}

function statusBg(status: HealthStatus): string {
  switch (status) {
    case "ok": return "color-mix(in srgb, #22c55e 10%, transparent)";
    case "degraded": return "color-mix(in srgb, #f59e0b 10%, transparent)";
    case "misconfigured": return "color-mix(in srgb, #f59e0b 10%, transparent)";
    case "unreachable": return "color-mix(in srgb, #ef4444 10%, transparent)";
  }
}

function statusLabel(status: HealthStatus): string {
  switch (status) {
    case "ok": return "Operational";
    case "degraded": return "Degraded";
    case "misconfigured": return "Misconfigured";
    case "unreachable": return "Unreachable";
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function OverallBanner({ report }: { report: DeploymentHealthReport }) {
  const color = statusColor(report.overallStatus);
  const bg = statusBg(report.overallStatus);
  const label = statusLabel(report.overallStatus);

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        padding: "1.25rem 1.5rem",
        borderRadius: 12,
        border: `1.5px solid ${color}`,
        background: bg,
        marginBottom: "1.5rem",
        display: "flex",
        alignItems: "center",
        gap: "1rem",
      }}
    >
      <span style={{ width: 14, height: 14, borderRadius: "50%", background: color, boxShadow: `0 0 0 4px color-mix(in srgb, ${color} 25%, transparent)`, flexShrink: 0 }} />
      <div>
        <p style={{ fontSize: "1.1rem", fontWeight: 700, color, margin: 0 }}>
          {label}
        </p>
        <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: 0, marginTop: "0.2rem" }}>
          Last checked: {new Date(report.generatedAt).toLocaleTimeString()}
        </p>
      </div>
    </div>
  );
}

function ContractRow({ entry }: { entry: ContractHealthEntry }) {
  const color = statusColor(entry.status);
  const label = statusLabel(entry.status);

  return (
    <div style={{
      display: "flex",
      alignItems: "flex-start",
      gap: "0.75rem",
      padding: "0.75rem 0",
      borderBottom: "1px solid var(--border)",
    }}>
      <span style={{ width: 10, height: 10, borderRadius: "50%", background: color, marginTop: "0.35rem", flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>{entry.key}</span>
          <span style={{
            fontSize: "0.7rem",
            padding: "0.1rem 0.5rem",
            borderRadius: 999,
            background: `color-mix(in srgb, ${color} 14%, transparent)`,
            color,
            fontWeight: 600,
          }}>
            {label}
          </span>
          {entry.latencyMs !== null && entry.status === "ok" && (
            <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
              {entry.latencyMs} ms
            </span>
          )}
        </div>
        <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", margin: "0.2rem 0 0", lineHeight: 1.5 }}>
          {entry.message}
        </p>
        <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", margin: "0.15rem 0 0", fontFamily: "monospace", opacity: 0.7, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {entry.contractId || "—"}
        </p>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function StatusPage() {
  const [report, setReport] = useState<DeploymentHealthReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runCheck = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await deploymentHealth.fullReport();
      setReport(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Health check failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    runCheck();
    const timer = setInterval(runCheck, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [runCheck]);

  return (
    <div className="form-narrow">
      <PageHeader
        eyebrow="Operations"
        icon={<Icon.shield size={22} />}
        title="Deployment Status"
        description="Live health of all deployed Veritoken contracts. Refreshes every 60 seconds."
      />

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "1rem" }}>
        <button
          className="btn-ghost"
          style={{ fontSize: "0.8rem", padding: "0.4rem 0.9rem" }}
          onClick={runCheck}
          disabled={loading}
          aria-label="Refresh status"
        >
          {loading ? "Checking…" : "Refresh now"}
        </button>
      </div>

      {error && !loading && (
        <div role="alert" style={{
          padding: "0.85rem 1rem",
          borderRadius: 10,
          background: "color-mix(in srgb, #ef4444 12%, transparent)",
          border: "1px solid color-mix(in srgb, #ef4444 35%, transparent)",
          color: "#ef4444",
          fontSize: "0.875rem",
          marginBottom: "1.25rem",
        }}>
          <strong>Health check error:</strong> {error}
        </div>
      )}

      {!report && loading && (
        <div style={{ textAlign: "center", padding: "3rem 1rem", color: "var(--text-muted)", fontSize: "0.9rem" }}>
          Running health checks…
        </div>
      )}

      {report && (
        <>
          <OverallBanner report={report} />

          <Card title="Contract Health">
            <div style={{ marginTop: "-0.25rem" }}>
              {report.entries.map((entry) => (
                <ContractRow key={entry.key} entry={entry} />
              ))}
            </div>
          </Card>

          {report.diagnostics.length > 0 && (
            <Card title="Diagnostics" style={{ marginTop: "1.25rem" }}>
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {report.diagnostics.map((msg, i) => (
                  <li key={i} style={{ fontSize: "0.82rem", color: "var(--text)", lineHeight: 1.5, padding: "0.4rem 0.6rem", borderRadius: 6, background: "var(--surface-2)", fontFamily: "monospace" }}>
                    {msg}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", textAlign: "center", marginTop: "1.5rem" }}>
            Auto-refreshes every 60 s · Generated at {new Date(report.generatedAt).toISOString()}
          </p>
        </>
      )}
    </div>
  );
}
