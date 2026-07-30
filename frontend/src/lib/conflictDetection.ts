/**
 * Conflict detection for overlapping admin actions.
 *
 * When multiple administrators act concurrently, contradictory changes can
 * create confusion: a pending time-locked rule change paired with an immediate
 * override, or a pause that races a KYC revocation. This module tracks in-flight
 * admin actions in localStorage and surfaces warnings before execution so that
 * operators can coordinate rather than collide.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type AdminActionType =
  | "pause"
  | "unpause"
  | "rules_propose"
  | "rules_immediate"
  | "rules_activate"
  | "blocklist_add"
  | "blocklist_remove"
  | "kyc_approve"
  | "kyc_revoke";

export interface PendingAdminAction {
  type: AdminActionType;
  initiatedBy: string;
  initiatedAt: number;
  description: string;
  /** Unix timestamp when a time-locked action becomes activatable. */
  activateAt?: number;
}

export interface ConflictWarning {
  severity: "warning" | "blocking";
  message: string;
}

// ── Storage ───────────────────────────────────────────────────────────────────

const STORAGE_KEY = "veritoken:pending_admin_actions";

export function loadPendingActions(): PendingAdminAction[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PendingAdminAction[]) : [];
  } catch {
    return [];
  }
}

function savePendingActions(actions: PendingAdminAction[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(actions));
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Register an admin action so that future conflict checks can account for it.
 * Call this immediately after an action is submitted to the chain.
 */
export function registerPendingAction(action: PendingAdminAction): void {
  const existing = loadPendingActions();
  existing.push(action);
  savePendingActions(existing);
}

/**
 * Remove all registered actions of a given type (e.g. after successful
 * activation or cancellation).
 */
export function resolveAction(type: AdminActionType): void {
  savePendingActions(loadPendingActions().filter((a) => a.type !== type));
}

/** Clear every registered pending action. */
export function clearAllPendingActions(): void {
  savePendingActions([]);
}

/**
 * Evaluate whether a proposed action conflicts with the current admin state.
 *
 * @param proposed        The action the operator is about to take.
 * @param isPaused        Current pause state of the compliance engine.
 * @param hasPendingRules Whether a time-locked rule change is queued.
 * @returns               Array of warnings to surface in the UI.
 */
export function detectConflicts(
  proposed: AdminActionType,
  isPaused: boolean,
  hasPendingRules: boolean,
): ConflictWarning[] {
  const warnings: ConflictWarning[] = [];
  const pending = loadPendingActions();

  // ── Pause / unpause conflicts ───────────────────────────────────────────────

  if (proposed === "pause" && isPaused) {
    warnings.push({
      severity: "blocking",
      message: "All transfers are already paused — a second pause has no effect.",
    });
  }

  if (proposed === "unpause" && !isPaused) {
    warnings.push({
      severity: "blocking",
      message: "Transfers are not currently paused — nothing to unpause.",
    });
  }

  // ── Rule change conflicts ───────────────────────────────────────────────────

  if (
    (proposed === "rules_propose" || proposed === "rules_immediate") &&
    hasPendingRules
  ) {
    warnings.push({
      severity: "warning",
      message:
        "A rule change is already queued in the time-lock. " +
        "Proposing another change may override it before it activates. " +
        "Coordinate with other administrators before proceeding.",
    });
  }

  if (proposed === "rules_activate" && !hasPendingRules) {
    warnings.push({
      severity: "blocking",
      message: "There are no pending rules to activate.",
    });
  }

  // ── Cross-action conflicts from other registered operators ──────────────────

  const pausePending = pending.find(
    (a) => a.type === "pause" || a.type === "unpause",
  );
  if (
    pausePending &&
    (proposed === "rules_propose" || proposed === "rules_immediate")
  ) {
    warnings.push({
      severity: "warning",
      message:
        `A pause/unpause action initiated by ${shortAddr(pausePending.initiatedBy)} is in flight. ` +
        "Changing rules while the pause state is transitioning may produce unexpected compliance behaviour.",
    });
  }

  const rulesPending = pending.find(
    (a) => a.type === "rules_propose" || a.type === "rules_immediate",
  );
  if (rulesPending && proposed === "pause") {
    warnings.push({
      severity: "warning",
      message:
        `A rule change proposed by ${shortAddr(rulesPending.initiatedBy)} is still pending. ` +
        "Pausing now will block the pending rule activation until transfers are re-enabled.",
    });
  }

  const kycPending = pending.find(
    (a) => a.type === "kyc_approve" || a.type === "kyc_revoke",
  );
  if (kycPending && proposed === "pause") {
    warnings.push({
      severity: "warning",
      message:
        `A KYC action by ${shortAddr(kycPending.initiatedBy)} is pending. ` +
        "Pausing while KYC status is being updated may affect which addresses can transfer once transfers resume.",
    });
  }

  return warnings;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function shortAddr(address: string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 8)}…`;
}
