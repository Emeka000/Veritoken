import { describe, it, expect, beforeEach } from "vitest";
import {
  detectConflicts,
  registerPendingAction,
  resolveAction,
  clearAllPendingActions,
  loadPendingActions,
} from "../conflictDetection";

beforeEach(() => {
  clearAllPendingActions();
});

describe("detectConflicts — pause/unpause", () => {
  it("blocks pausing when already paused", () => {
    const warnings = detectConflicts("pause", true, false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe("blocking");
    expect(warnings[0].message).toMatch(/already paused/i);
  });

  it("blocks unpausing when not paused", () => {
    const warnings = detectConflicts("unpause", false, false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe("blocking");
    expect(warnings[0].message).toMatch(/not currently paused/i);
  });

  it("returns no warnings for a valid pause", () => {
    const warnings = detectConflicts("pause", false, false);
    expect(warnings).toHaveLength(0);
  });

  it("returns no warnings for a valid unpause", () => {
    const warnings = detectConflicts("unpause", true, false);
    expect(warnings).toHaveLength(0);
  });
});

describe("detectConflicts — rule changes", () => {
  it("warns when proposing rules while a pending change exists", () => {
    const warnings = detectConflicts("rules_propose", false, true);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe("warning");
    expect(warnings[0].message).toMatch(/queued/i);
  });

  it("warns on immediate rules when pending change exists", () => {
    const warnings = detectConflicts("rules_immediate", false, true);
    expect(warnings.some((w) => w.message.match(/queued/i))).toBe(true);
  });

  it("blocks activating when no pending rules exist", () => {
    const warnings = detectConflicts("rules_activate", false, false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe("blocking");
    expect(warnings[0].message).toMatch(/no pending rules/i);
  });

  it("returns no warnings for rules_propose when queue is empty", () => {
    const warnings = detectConflicts("rules_propose", false, false);
    expect(warnings).toHaveLength(0);
  });
});

describe("detectConflicts — cross-action warnings from registered operators", () => {
  it("warns about proposing rules while a pause is in flight", () => {
    registerPendingAction({
      type: "pause",
      initiatedBy: "GABCDEFG",
      initiatedAt: Date.now(),
      description: "Emergency pause",
    });
    const warnings = detectConflicts("rules_propose", false, false);
    expect(warnings.some((w) => w.message.match(/pause\/unpause/i))).toBe(true);
  });

  it("warns about pausing while rule change is in flight", () => {
    registerPendingAction({
      type: "rules_propose",
      initiatedBy: "GABCDEFG",
      initiatedAt: Date.now(),
      description: "Rule change proposal",
      activateAt: Date.now() / 1000 + 3600,
    });
    const warnings = detectConflicts("pause", false, false);
    expect(warnings.some((w) => w.message.match(/rule change/i))).toBe(true);
  });

  it("warns about pausing while a KYC action is in flight", () => {
    registerPendingAction({
      type: "kyc_approve",
      initiatedBy: "GXYZ1234",
      initiatedAt: Date.now(),
      description: "KYC approval",
    });
    const warnings = detectConflicts("pause", false, false);
    expect(warnings.some((w) => w.message.match(/kyc/i))).toBe(true);
  });
});

describe("registerPendingAction / resolveAction", () => {
  it("persists a registered action", () => {
    registerPendingAction({
      type: "blocklist_add",
      initiatedBy: "GABC",
      initiatedAt: Date.now(),
      description: "Block spammer",
    });
    const pending = loadPendingActions();
    expect(pending).toHaveLength(1);
    expect(pending[0].type).toBe("blocklist_add");
  });

  it("resolves removes all actions of the given type", () => {
    registerPendingAction({ type: "pause", initiatedBy: "GA", initiatedAt: 0, description: "" });
    registerPendingAction({ type: "pause", initiatedBy: "GB", initiatedAt: 0, description: "" });
    registerPendingAction({ type: "unpause", initiatedBy: "GC", initiatedAt: 0, description: "" });
    resolveAction("pause");
    const remaining = loadPendingActions();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].type).toBe("unpause");
  });
});

describe("clearAllPendingActions", () => {
  it("empties the pending list", () => {
    registerPendingAction({ type: "pause", initiatedBy: "GA", initiatedAt: 0, description: "" });
    clearAllPendingActions();
    expect(loadPendingActions()).toHaveLength(0);
  });
});
