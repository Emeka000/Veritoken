/**
 * ComplianceAlertTimeline — scrollable list of the last 50 compliance alerts.
 * Issue #547
 */

import { Component, type ReactNode } from "react";
import { Card } from "../ui";
import { useNotificationStore, type AppNotification } from "../../lib/notificationStore";
import { useNetworkStore } from "../../lib/networkStore";

// ── Error boundary ────────────────────────────────────────────────────────────

class AlertTimelineErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return (
        <Card title="Compliance Alerts">
          <p style={{ color: "#ef4444", fontSize: "0.875rem" }}>
            Failed to render alert timeline.
          </p>
        </Card>
      );
    }
    return this.props.children;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const SEVERITY_COLORS: Record<string, string> = {
  critical: "#ef4444",
  warning: "#f59e0b",
  info: "#6366f1",
};

function shortenAddress(addr?: string): string {
  if (!addr || addr.length < 10) return addr ?? "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function explorerUrl(network: string, txHash?: string): string | null {
  if (!txHash) return null;
  const base =
    network === "mainnet"
      ? "https://stellar.expert/explorer/public"
      : "https://stellar.expert/explorer/testnet";
  return `${base}/tx/${txHash}`;
}

// ── Alert row ─────────────────────────────────────────────────────────────────

function AlertRow({
  notification,
  network,
}: {
  notification: AppNotification;
  network: string;
}) {
  const color = SEVERITY_COLORS[notification.severity] ?? "#6366f1";
  const explorerLink = explorerUrl(network, notification.txHash);
  const timeLabel = new Date(notification.timestamp).toLocaleString();

  return (
    <li
      style={{
        display: "flex",
        gap: "0.75rem",
        padding: "0.65rem 0",
        borderBottom: "1px solid var(--border)",
      }}
    >
      {/* Timeline dot */}
      <div style={{ paddingTop: "0.2rem", flexShrink: 0 }}>
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: color,
          }}
          aria-hidden="true"
        />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: "0.5rem",
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontWeight: 600, fontSize: "0.85rem", color }}>
            {notification.title}
          </span>
          <time
            dateTime={notification.timestamp}
            className="muted"
            style={{ fontSize: "0.75rem", whiteSpace: "nowrap" }}
          >
            {timeLabel}
          </time>
        </div>

        <p
          className="muted"
          style={{ fontSize: "0.8rem", margin: "0.15rem 0 0", wordBreak: "break-word" }}
        >
          {notification.message}
        </p>

        {/* Addresses extracted from message */}
        {notification.txHash && (
          <p style={{ fontSize: "0.75rem", marginTop: "0.2rem" }}>
            Tx: <span className="mono">{shortenAddress(notification.txHash)}</span>
          </p>
        )}

        {explorerLink && (
          <a
            href={explorerLink}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: "0.75rem",
              color: "var(--accent-2)",
              textDecoration: "underline",
            }}
          >
            View on explorer ↗
          </a>
        )}
      </div>
    </li>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

function ComplianceAlertTimelineInner() {
  const { notifications, clearAll } = useNotificationStore();
  const { network } = useNetworkStore();

  // Show the 50 most recent, which are already at the front (push prepends)
  const visible = notifications.slice(0, 50);

  return (
    <Card title="Compliance Alerts">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "0.75rem",
        }}
      >
        <span className="muted" style={{ fontSize: "0.8rem" }}>
          {visible.length === 0
            ? "No alerts recorded this session."
            : `${visible.length} alert${visible.length !== 1 ? "s" : ""} (most recent first)`}
        </span>
        {visible.length > 0 && (
          <button
            className="btn-ghost"
            style={{ fontSize: "0.75rem", padding: "0.3rem 0.7rem" }}
            onClick={clearAll}
            onKeyDown={(e) => e.key === "Enter" && clearAll()}
          >
            Clear all
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <p className="muted" style={{ fontSize: "0.875rem" }}>
          Compliance alerts from this session will appear here.
        </p>
      ) : (
        <ul
          aria-label="Compliance alert timeline"
          style={{ listStyle: "none", margin: 0, padding: 0, maxHeight: 340, overflowY: "auto" }}
        >
          {visible.map((n) => (
            <AlertRow key={n.id} notification={n} network={network} />
          ))}
        </ul>
      )}
    </Card>
  );
}

export function ComplianceAlertTimeline() {
  return (
    <AlertTimelineErrorBoundary>
      <ComplianceAlertTimelineInner />
    </AlertTimelineErrorBoundary>
  );
}
