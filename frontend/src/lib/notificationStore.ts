/**
 * notificationStore — in-memory queue for high-priority contract notifications.
 *
 * Notifications are derived from ContractEvents and governance log entries.
 * They are stored in-memory (not persisted) so they reset on page load, which
 * avoids showing stale alerts on revisit.
 *
 * Issue #435 — Notification Center for Important Contract Activity
 */

import { create } from "zustand";

export type NotificationSeverity = "info" | "warning" | "critical";

export type NotificationCategory =
  | "kyc"
  | "compliance"
  | "transfer"
  | "pause"
  | "governance"
  | "system";

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  severity: NotificationSeverity;
  category: NotificationCategory;
  timestamp: string; // ISO 8601
  read: boolean;
  txHash?: string;
  /** Optional link for navigating to relevant page. */
  href?: string;
}

interface NotificationState {
  notifications: AppNotification[];
  unreadCount: number;
  /** Push a new notification onto the queue. */
  push: (n: Omit<AppNotification, "id" | "timestamp" | "read">) => void;
  /** Mark a single notification as read. */
  markRead: (id: string) => void;
  /** Mark all notifications as read. */
  markAllRead: () => void;
  /** Remove a notification entirely. */
  dismiss: (id: string) => void;
  /** Remove all notifications. */
  clearAll: () => void;
}

let _seq = 0;

function makeId(): string {
  return `notif-${Date.now()}-${++_seq}`;
}

export const useNotificationStore = create<NotificationState>((set, _get) => ({
  notifications: [],
  unreadCount: 0,

  push: (n) => {
    const entry: AppNotification = {
      ...n,
      id: makeId(),
      timestamp: new Date().toISOString(),
      read: false,
    };
    set((s) => ({
      notifications: [entry, ...s.notifications].slice(0, 100),
      unreadCount: s.unreadCount + 1,
    }));
  },

  markRead: (id) => {
    set((s) => {
      const notifications = s.notifications.map((n) =>
        n.id === id && !n.read ? { ...n, read: true } : n
      );
      return { notifications, unreadCount: notifications.filter((n) => !n.read).length };
    });
  },

  markAllRead: () => {
    set((s) => ({
      notifications: s.notifications.map((n) => ({ ...n, read: true })),
      unreadCount: 0,
    }));
  },

  dismiss: (id) => {
    set((s) => {
      const notifications = s.notifications.filter((n) => n.id !== id);
      return { notifications, unreadCount: notifications.filter((n) => !n.read).length };
    });
  },

  clearAll: () => set({ notifications: [], unreadCount: 0 }),
}));

// ── Convenience push helpers ──────────────────────────────────────────────────

const store = () => useNotificationStore.getState();

export const notifyKycApproval = (subject: string, tier: number) =>
  store().push({
    title: "KYC Approved",
    message: `Address ${subject.slice(0, 6)}…${subject.slice(-4)} approved at tier ${tier}.`,
    severity: "info",
    category: "kyc",
    href: "/kyc",
  });

export const notifyKycRevocation = (subject: string) =>
  store().push({
    title: "KYC Revoked",
    message: `KYC revoked for ${subject.slice(0, 6)}…${subject.slice(-4)}.`,
    severity: "warning",
    category: "kyc",
    href: "/kyc",
  });

export const notifyCompliancePaused = () =>
  store().push({
    title: "Transfers Paused",
    message: "All token transfers have been halted by an admin.",
    severity: "critical",
    category: "pause",
    href: "/admin",
  });

export const notifyComplianceResumed = () =>
  store().push({
    title: "Transfers Resumed",
    message: "Token transfers have been re-enabled.",
    severity: "info",
    category: "pause",
    href: "/admin",
  });

export const notifyRulesUpdated = () =>
  store().push({
    title: "Compliance Rules Updated",
    message: "The compliance engine rule set has been changed.",
    severity: "warning",
    category: "compliance",
    href: "/admin",
  });

export const notifyBlocklistChange = (addr: string, added: boolean) =>
  store().push({
    title: added ? "Address Blocklisted" : "Address Removed from Blocklist",
    message: `${addr.slice(0, 6)}…${addr.slice(-4)} ${added ? "added to" : "removed from"} blocklist.`,
    severity: added ? "warning" : "info",
    category: "compliance",
    href: "/admin",
  });

/** Generic push from a raw ContractEvent. */
export const notifyFromContractEvent = (type: string, detail: string, txHash?: string) =>
  store().push({
    title: type,
    message: detail,
    severity: "info",
    category: "transfer",
    txHash,
  });
