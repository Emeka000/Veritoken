/**
 * Alert detection (#444) — turns raw compliance signals into actionable,
 * human-readable alerts.
 *
 * This module is pure and has no I/O: it classifies a `DenyReason` (from
 * `ComplianceEngineClient.evaluateTransfer()`) or a compliance-engine event
 * topic (from `fetchContractEvents`/`parseEvents`) into an `Alert`, and
 * tracks repeated violations per address so callers can escalate severity.
 * Frontend/backend consumers are responsible for polling/subscribing and
 * pushing the resulting `Alert`s into their own notification surface.
 */

import type { DenyReason } from "./types.js";

export type AlertSeverity = "info" | "warning" | "critical";

export type AlertCategory =
  | "blocked_transfer"
  | "repeated_violation"
  | "unusual_amount"
  | "compliance_event";

export interface Alert {
  severity: AlertSeverity;
  category: AlertCategory;
  title: string;
  message: string;
  /** The address most relevant to this alert (sender, blocked address, etc). */
  address?: string;
  reason?: DenyReason;
  txHash?: string;
}

function shortAddr(addr: string): string {
  return addr.length > 10 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

// ── Denied-transfer classification ──────────────────────────────────────────

const DENY_REASON_INFO: Record<DenyReason, { severity: AlertSeverity; label: string }> = {
  CompliancePaused: { severity: "critical", label: "transfers are paused" },
  FromBlocklisted: { severity: "critical", label: "the sender is blocklisted" },
  ToBlocklisted: { severity: "critical", label: "the recipient is blocklisted" },
  RiskScoreTooHigh: { severity: "critical", label: "a jurisdiction risk score exceeded the configured limit" },
  FromJurisdictionBlocked: { severity: "critical", label: "the sender's jurisdiction is blocked" },
  ToJurisdictionBlocked: { severity: "critical", label: "the recipient's jurisdiction is blocked" },
  TierPolicyBlocked: { severity: "warning", label: "the sender/recipient tier pair is blocked" },
  AmountExceeded: { severity: "warning", label: "the amount exceeds the global transfer limit" },
  TierAmountExceeded: { severity: "warning", label: "the amount exceeds the tier transfer limit" },
  HoldingPeriodNotMet: { severity: "warning", label: "the sender's minimum holding period has not elapsed" },
  RecipientHoldingPeriodExceeded: { severity: "warning", label: "the recipient's maximum holding period has elapsed" },
  MaxHoldersReached: { severity: "warning", label: "the maximum holder count has been reached" },
  SameJurisdictionRequired: { severity: "warning", label: "sender and recipient must share a jurisdiction" },
  TierFromBelowMin: { severity: "warning", label: "the sender's KYC tier is below the required minimum" },
  TierToBelowMin: { severity: "warning", label: "the recipient's KYC tier is below the required minimum" },
  FromKycMissing: { severity: "info", label: "the sender has no KYC record" },
  ToKycMissing: { severity: "info", label: "the recipient has no KYC record" },
  FromKycExpired: { severity: "info", label: "the sender's KYC has expired" },
  ToKycExpired: { severity: "info", label: "the recipient's KYC has expired" },
  FromKycRevoked: { severity: "warning", label: "the sender's KYC has been revoked" },
  ToKycRevoked: { severity: "warning", label: "the recipient's KYC has been revoked" },
  FromKycRejected: { severity: "info", label: "the sender's KYC was rejected" },
  ToKycRejected: { severity: "info", label: "the recipient's KYC was rejected" },
  FromKycPending: { severity: "info", label: "the sender's KYC is still pending" },
  ToKycPending: { severity: "info", label: "the recipient's KYC is still pending" },
  FromNotAllowlisted: { severity: "critical", label: "the sender is not on the allowlist" },
  ToNotAllowlisted: { severity: "critical", label: "the recipient is not on the allowlist" },
};

/** Look up the severity + plain-language explanation for a `DenyReason`. */
export function classifyDenyReason(reason: DenyReason): { severity: AlertSeverity; label: string } {
  return DENY_REASON_INFO[reason];
}

/** Build an alert for a transfer that `evaluateTransfer()` reported would be denied. */
export function alertForDeniedTransfer(params: {
  from: string;
  to: string;
  amount: bigint;
  reason: DenyReason;
  txHash?: string;
}): Alert {
  const { severity, label } = classifyDenyReason(params.reason);
  return {
    severity,
    category: "blocked_transfer",
    title: "Transfer Would Be Blocked",
    message: `Transfer of ${params.amount} from ${shortAddr(params.from)} to ${shortAddr(params.to)} would be denied: ${label}.`,
    address: params.from,
    reason: params.reason,
    txHash: params.txHash,
  };
}

// ── Compliance-engine event classification ──────────────────────────────────

interface EventAlertTemplate {
  severity: AlertSeverity;
  title: string;
  message: (detail: string) => string;
}

/**
 * Compliance-engine event topics worth surfacing as alerts, keyed by the
 * topic strings the contract actually publishes (see
 * `contracts/compliance-engine/src/lib.rs`). Topics not listed here (e.g.
 * `rules_set`, which always co-fires with `rules_wrn` on the same admin
 * action) are intentionally not alerted on to avoid duplicate notifications.
 */
const COMPLIANCE_EVENT_TEMPLATES: Partial<Record<string, EventAlertTemplate>> = {
  paused: {
    severity: "critical",
    title: "Transfers Paused",
    message: () => "All token transfers have been halted by an admin.",
  },
  unpaused: {
    severity: "info",
    title: "Transfers Resumed",
    message: () => "Token transfers have been re-enabled.",
  },
  blocked: {
    severity: "warning",
    title: "Address Blocklisted",
    message: (addr) => `${shortAddr(addr)} was added to the compliance blocklist.`,
  },
  rules_wrn: {
    severity: "warning",
    title: "Emergency Rule Change",
    message: () => "Compliance rules were changed immediately, bypassing the normal time-lock delay.",
  },
  jur_add: {
    severity: "warning",
    title: "Jurisdiction Blocked",
    message: (j) => `Jurisdiction "${j}" was added to the blocked list.`,
  },
  risk_jur: {
    severity: "info",
    title: "Jurisdiction Risk Score Updated",
    message: (j) => `Risk score updated for jurisdiction "${j}".`,
  },
};

/**
 * Classify a raw compliance-engine event (as produced by
 * `fetchContractEvents`/`parseEvents`, where `type` is the decoded first
 * topic and `detail` is a human-readable rendering of the event payload)
 * into an `Alert`. Returns `null` for event types that aren't alert-worthy.
 */
export function alertForComplianceEvent(type: string, detail: string, txHash?: string): Alert | null {
  const template = COMPLIANCE_EVENT_TEMPLATES[type];
  if (!template) return null;
  return {
    severity: template.severity,
    category: "compliance_event",
    title: template.title,
    message: template.message(detail),
    address: type === "blocked" ? detail : undefined,
    txHash,
  };
}

// ── Unusual-amount detection ─────────────────────────────────────────────────

/**
 * Flag a transfer/mint amount as "unusual" when it consumes at least 90% of
 * the configured `max_transfer_amount` ceiling. `0` (or a non-positive
 * ceiling) means the rule is disabled, so nothing is ever flagged.
 */
export function isUnusualAmount(amount: bigint, maxTransferAmount: bigint): boolean {
  if (maxTransferAmount <= 0n || amount <= 0n) return false;
  return amount * 10n >= maxTransferAmount * 9n;
}

export function alertForUnusualAmount(params: {
  address: string;
  amount: bigint;
  maxTransferAmount: bigint;
  txHash?: string;
}): Alert {
  return {
    severity: "warning",
    category: "unusual_amount",
    title: "Unusually Large Amount",
    message: `${shortAddr(params.address)} moved ${params.amount}, close to the configured limit of ${params.maxTransferAmount}.`,
    address: params.address,
    txHash: params.txHash,
  };
}

// ── Repeated-violation tracking ──────────────────────────────────────────────

/**
 * Tracks how many times each address has triggered an alert-worthy
 * condition within a sliding time window, so callers can escalate severity
 * once a threshold is crossed (a single denied transfer is routine; five in
 * ten minutes from the same address is suspicious).
 */
export class ViolationTracker {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly windowMs = 10 * 60_000,
    private readonly threshold = 3,
  ) {}

  /** Record a hit for `address` and report whether it has crossed the threshold. */
  record(address: string, atMs: number = Date.now()): { count: number; repeated: boolean } {
    const recent = (this.hits.get(address) ?? []).filter((t) => atMs - t < this.windowMs);
    recent.push(atMs);
    this.hits.set(address, recent);
    return { count: recent.length, repeated: recent.length >= this.threshold };
  }

  /** Build a "repeated violation" alert once `record()` reports `repeated: true`. */
  static alertForRepeat(address: string, count: number, windowMinutes: number): Alert {
    return {
      severity: "critical",
      category: "repeated_violation",
      title: "Repeated Rule Violations",
      message: `${shortAddr(address)} triggered ${count} compliance alerts in the last ${windowMinutes} minutes.`,
      address,
    };
  }

  clear(): void {
    this.hits.clear();
  }
}
