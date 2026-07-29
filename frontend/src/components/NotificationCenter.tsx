/**
 * NotificationCenter — bell icon + dropdown for high-priority contract events.
 *
 * Renders a badge with the unread count in the header. Clicking opens a
 * dropdown listing recent notifications with severity colours, category
 * badges, and mark-read / dismiss controls.
 *
 * Issue #435 — Notification Center for Important Contract Activity
 */

import { useRef, useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  useNotificationStore,
  type AppNotification,
  type NotificationSeverity,
} from "../lib/notificationStore";

// ── Severity colours ──────────────────────────────────────────────────────────

const SEV_COLOR: Record<NotificationSeverity, { dot: string; bg: string; text: string }> = {
  info:     { dot: "#60a5fa", bg: "rgba(96,165,250,0.08)",  text: "#93c5fd" },
  warning:  { dot: "#fbbf24", bg: "rgba(251,191,36,0.08)",  text: "#fcd34d" },
  critical: { dot: "#f87171", bg: "rgba(248,113,113,0.10)", text: "#fca5a5" },
};

// ── Single notification row ───────────────────────────────────────────────────

function NotificationRow({
  n,
  onRead,
  onDismiss,
}: {
  n: AppNotification;
  onRead: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const c = SEV_COLOR[n.severity];
  return (
    <div
      style={{
        padding: "0.65rem 0.85rem",
        borderBottom: "1px solid var(--border)",
        background: n.read ? "transparent" : c.bg,
        display: "flex",
        gap: "0.6rem",
        alignItems: "flex-start",
      }}
    >
      {/* Severity dot */}
      <span
        aria-hidden="true"
        style={{
          marginTop: "0.3rem",
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: c.dot,
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "0.4rem" }}>
          <span style={{ fontWeight: 600, fontSize: "0.8rem", color: "var(--text)" }}>
            {n.title}
          </span>
          <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
            {new Date(n.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
        <p style={{ margin: "0.15rem 0 0", fontSize: "0.78rem", color: "var(--text-muted)", lineHeight: 1.4 }}>
          {n.message}
        </p>
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.3rem", alignItems: "center" }}>
          {n.href && (
            <Link
              to={n.href}
              style={{ fontSize: "0.7rem", color: "var(--accent, #7c6ef7)", textDecoration: "none" }}
            >
              View →
            </Link>
          )}
          {!n.read && (
            <button
              onClick={() => onRead(n.id)}
              style={ghostBtn}
              aria-label="Mark as read"
            >
              Mark read
            </button>
          )}
          <button
            onClick={() => onDismiss(n.id)}
            style={ghostBtn}
            aria-label="Dismiss notification"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function NotificationCenter() {
  const { notifications, unreadCount, markRead, markAllRead, dismiss, clearAll } =
    useNotificationStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside.
  const handleOutside = useCallback((e: MouseEvent) => {
    if (ref.current && !ref.current.contains(e.target as Node)) {
      setOpen(false);
    }
  }, []);

  useEffect(() => {
    if (open) document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open, handleOutside]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      {/* Bell button */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ""}`}
        aria-expanded={open}
        aria-haspopup="true"
        style={{
          position: "relative",
          background: "none",
          border: "1px solid var(--border)",
          borderRadius: 8,
          width: 36,
          height: 36,
          display: "grid",
          placeItems: "center",
          cursor: "pointer",
          color: "var(--text-muted)",
          fontSize: "1rem",
        }}
      >
        🔔
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              top: -4,
              right: -4,
              background: "#ef4444",
              color: "#fff",
              fontSize: "0.6rem",
              fontWeight: 700,
              borderRadius: 999,
              minWidth: 16,
              height: 16,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0 3px",
              lineHeight: 1,
            }}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          role="dialog"
          aria-label="Notification center"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            width: 340,
            maxHeight: 480,
            overflowY: "auto",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
            zIndex: 200,
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "0.7rem 0.85rem",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <span style={{ fontWeight: 700, fontSize: "0.875rem" }}>
              Notifications
              {unreadCount > 0 && (
                <span
                  style={{
                    marginLeft: "0.4rem",
                    background: "#ef4444",
                    color: "#fff",
                    borderRadius: 999,
                    fontSize: "0.65rem",
                    padding: "0.1rem 0.45rem",
                    fontWeight: 700,
                  }}
                >
                  {unreadCount}
                </span>
              )}
            </span>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              {unreadCount > 0 && (
                <button onClick={markAllRead} style={ghostBtn} aria-label="Mark all read">
                  Mark all read
                </button>
              )}
              {notifications.length > 0 && (
                <button onClick={clearAll} style={ghostBtn} aria-label="Clear all notifications">
                  Clear all
                </button>
              )}
            </div>
          </div>

          {/* List */}
          {notifications.length === 0 ? (
            <div
              style={{
                padding: "2rem 1rem",
                textAlign: "center",
                color: "var(--text-muted)",
                fontSize: "0.85rem",
              }}
            >
              No notifications yet
            </div>
          ) : (
            notifications.map((n) => (
              <NotificationRow
                key={n.id}
                n={n}
                onRead={markRead}
                onDismiss={dismiss}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

const ghostBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  fontSize: "0.7rem",
  color: "var(--text-muted)",
  padding: "0.1rem 0.3rem",
};
