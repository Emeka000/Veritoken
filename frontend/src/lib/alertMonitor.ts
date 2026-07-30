/**
 * alertMonitor — polls the compliance engine's event stream and surfaces
 * alert-worthy activity (pauses, blocklist changes, emergency rule changes,
 * jurisdiction blocks, repeated violations) through the notification center.
 *
 * Issue #444 — Automated Alerting for Rule Violations and Suspicious Activity
 *
 * Usage (admin/operator surfaces):
 *   useEffect(() => startComplianceAlertMonitor(), []);
 */

import { alertForComplianceEvent, ViolationTracker, type Alert } from "@veritoken/sdk";
import { fetchContractEvents, CONTRACT_IDS } from "./stellar";
import { useNotificationStore, type NotificationCategory } from "./notificationStore";

const POLL_INTERVAL_MS = 30_000;
const MAX_SEEN_KEYS = 500;
const REPEATED_VIOLATION_WINDOW_MINUTES = 10;

function categoryFor(alert: Alert): NotificationCategory {
  if (/paused|resumed/i.test(alert.title)) return "pause";
  return "compliance";
}

function pushAlert(alert: Alert): void {
  useNotificationStore.getState().push({
    title: alert.title,
    message: alert.message,
    severity: alert.severity,
    category: categoryFor(alert),
    txHash: alert.txHash,
    href: "/admin",
  });
}

/**
 * Start polling the compliance engine for alert-worthy events and pushing
 * them into the notification center. Returns a cleanup function that stops
 * polling — call it from a `useEffect` cleanup so the interval doesn't leak
 * across navigations.
 */
export function startComplianceAlertMonitor(): () => void {
  const contractId = CONTRACT_IDS.complianceEngine;
  if (!contractId) return () => {};

  const seen = new Set<string>();
  const tracker = new ViolationTracker(
    REPEATED_VIOLATION_WINDOW_MINUTES * 60_000,
  );
  let cancelled = false;

  const poll = async () => {
    let events;
    try {
      events = await fetchContractEvents(contractId, { limit: 20 });
    } catch {
      // Transient RPC errors are expected while polling; skip this cycle.
      return;
    }
    if (cancelled) return;

    for (const event of events) {
      const key = event.pagingToken ?? event.id ?? `${event.txHash ?? ""}:${event.type}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const detail = String(event.args?.[0] ?? event.counterparty ?? "");
      const alert = alertForComplianceEvent(event.type, detail, event.txHash);
      if (!alert) continue;

      pushAlert(alert);

      if (alert.address) {
        const { count, repeated } = tracker.record(alert.address);
        if (repeated) {
          pushAlert(
            ViolationTracker.alertForRepeat(
              alert.address,
              count,
              REPEATED_VIOLATION_WINDOW_MINUTES,
            ),
          );
        }
      }
    }

    if (seen.size > MAX_SEEN_KEYS) {
      let excess = seen.size - MAX_SEEN_KEYS;
      for (const key of seen) {
        if (excess-- <= 0) break;
        seen.delete(key);
      }
    }
  };

  void poll();
  const interval = setInterval(() => void poll(), POLL_INTERVAL_MS);

  return () => {
    cancelled = true;
    clearInterval(interval);
  };
}
