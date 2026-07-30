import { describe, it, expect, beforeEach, vi } from "vitest";
import { recordBackupEvent, getBackupHistory, clearBackupHistory } from "../backupHistory";

beforeEach(() => {
  localStorage.clear();
});

describe("recordBackupEvent / getBackupHistory", () => {
  it("returns an empty list when nothing has been recorded", () => {
    expect(getBackupHistory()).toEqual([]);
  });

  it("records an export event retrievable via getBackupHistory", () => {
    recordBackupEvent({ type: "export", label: "Testnet staging", network: "testnet" });
    const history = getBackupHistory();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ type: "export", label: "Testnet staging", network: "testnet" });
    expect(history[0].id).toBeTruthy();
    expect(history[0].timestamp).toBeTruthy();
  });

  it("orders entries most-recent-first", () => {
    recordBackupEvent({ type: "export", label: "First", network: "testnet" });
    recordBackupEvent({ type: "restore", label: "Second", network: "testnet" });
    const history = getBackupHistory();
    expect(history.map((e) => e.label)).toEqual(["Second", "First"]);
  });

  it("stores an optional summary", () => {
    recordBackupEvent({
      type: "restore",
      label: "Institutional preset",
      network: "mainnet",
      summary: "2 tier policies, risk config applied",
    });
    expect(getBackupHistory()[0].summary).toBe("2 tier policies, risk config applied");
  });

  it("caps history at 100 entries", () => {
    for (let i = 0; i < 105; i++) {
      recordBackupEvent({ type: "export", label: `Entry ${i}`, network: "testnet" });
    }
    expect(getBackupHistory()).toHaveLength(100);
    // Most recent (highest index) survives; oldest are dropped.
    expect(getBackupHistory()[0].label).toBe("Entry 104");
  });

  it("dispatches a storage event so mounted listeners can refresh", () => {
    const handler = vi.fn();
    window.addEventListener("storage", handler);
    recordBackupEvent({ type: "export", label: "x", network: "testnet" });
    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener("storage", handler);
  });
});

describe("clearBackupHistory", () => {
  it("removes all entries", () => {
    recordBackupEvent({ type: "export", label: "x", network: "testnet" });
    expect(getBackupHistory()).toHaveLength(1);
    clearBackupHistory();
    expect(getBackupHistory()).toEqual([]);
  });
});
