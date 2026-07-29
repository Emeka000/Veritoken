import { describe, it, expect, beforeEach } from "vitest";
import { useSessionHistory, recordSessionAction } from "../sessionHistory";

beforeEach(() => {
  useSessionHistory.getState().clear();
  sessionStorage.clear();
});

describe("sessionHistory store", () => {
  it("starts empty", () => {
    expect(useSessionHistory.getState().entries).toEqual([]);
  });

  it("record() prepends a new entry with a timestamp", () => {
    useSessionHistory.getState().record("wallet", "Wallet connected", "detail", "GADDR");
    const entries = useSessionHistory.getState().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      category: "wallet",
      label: "Wallet connected",
      detail: "detail",
      actor: "GADDR",
    });
    expect(typeof entries[0].timestamp).toBe("string");
    expect(typeof entries[0].id).toBe("string");
  });

  it("newest entries appear first", () => {
    useSessionHistory.getState().record("wallet", "First");
    useSessionHistory.getState().record("wallet", "Second");
    const entries = useSessionHistory.getState().entries;
    expect(entries[0].label).toBe("Second");
    expect(entries[1].label).toBe("First");
  });

  it("recordSessionAction() is a working shorthand for store.record()", () => {
    recordSessionAction("form_submission", "Form submitted");
    expect(useSessionHistory.getState().entries).toHaveLength(1);
    expect(useSessionHistory.getState().entries[0].category).toBe("form_submission");
  });

  it("clear() empties the history", () => {
    recordSessionAction("wallet", "Wallet connected");
    expect(useSessionHistory.getState().entries).toHaveLength(1);
    useSessionHistory.getState().clear();
    expect(useSessionHistory.getState().entries).toEqual([]);
  });

  it("caps the history at 200 entries, dropping the oldest", () => {
    for (let i = 0; i < 205; i++) {
      recordSessionAction("other", `action-${i}`);
    }
    const entries = useSessionHistory.getState().entries;
    expect(entries).toHaveLength(200);
    // Most recent (action-204) is first; oldest 5 were dropped.
    expect(entries[0].label).toBe("action-204");
    expect(entries.some((e) => e.label === "action-0")).toBe(false);
  });

  it("persists entries to sessionStorage under the expected key", () => {
    recordSessionAction("wallet", "Wallet connected");
    const raw = sessionStorage.getItem("veritoken-session-history");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string);
    expect(parsed.state.entries).toHaveLength(1);
  });
});
