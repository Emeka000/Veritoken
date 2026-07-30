import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  useDraftStore,
  getDraft,
  saveDraft,
  discardDraft,
  hasDraft,
  DRAFT_FORMAT_VERSION,
} from "../drafts";

beforeEach(() => {
  useDraftStore.setState({ drafts: {} });
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("drafts store", () => {
  it("has no draft for a flow that was never saved", () => {
    expect(getDraft("deploy:invoice")).toBeUndefined();
    expect(hasDraft("deploy:invoice")).toBe(false);
  });

  it("saveDraft() then getDraft() round-trips the values", () => {
    saveDraft("deploy:invoice", { name: "Acme", symbol: "ACM" });
    const draft = getDraft("deploy:invoice");
    expect(draft).toBeDefined();
    expect(draft?.values).toEqual({ name: "Acme", symbol: "ACM" });
    expect(draft?.version).toBe(DRAFT_FORMAT_VERSION);
    expect(hasDraft("deploy:invoice")).toBe(true);
  });

  it("keeps drafts for different flows independent", () => {
    saveDraft("deploy:invoice", { name: "Invoice Co" });
    saveDraft("deploy:carbon", { name: "Carbon Co" });
    expect(getDraft("deploy:invoice")?.values).toEqual({ name: "Invoice Co" });
    expect(getDraft("deploy:carbon")?.values).toEqual({ name: "Carbon Co" });
  });

  it("discardDraft() removes the entry", () => {
    saveDraft("deploy:invoice", { name: "Acme" });
    expect(hasDraft("deploy:invoice")).toBe(true);
    discardDraft("deploy:invoice");
    expect(hasDraft("deploy:invoice")).toBe(false);
  });

  it("expires a draft once its TTL has elapsed, and purges it from the store", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    saveDraft("deploy:invoice", { name: "Acme" }, 1000);

    vi.setSystemTime(new Date("2026-01-01T00:00:01.001Z"));
    expect(getDraft("deploy:invoice")).toBeUndefined();

    // Expired entry is purged as a side effect of reading it.
    expect(useDraftStore.getState().drafts["deploy:invoice"]).toBeUndefined();
  });

  it("keeps an unexpired draft available right up to its TTL", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    saveDraft("deploy:invoice", { name: "Acme" }, 1000);

    vi.setSystemTime(new Date("2026-01-01T00:00:00.500Z"));
    expect(getDraft("deploy:invoice")).toBeDefined();
  });

  it("treats a corrupted/old-format entry as absent and purges it", () => {
    useDraftStore.setState({
      drafts: {
        // @ts-expect-error intentionally malformed for the test
        "deploy:invoice": { version: 0, flow: "deploy:invoice" },
      },
    });
    expect(getDraft("deploy:invoice")).toBeUndefined();
    expect(useDraftStore.getState().drafts["deploy:invoice"]).toBeUndefined();
  });

  it("persists drafts to localStorage under the expected key", () => {
    saveDraft("deploy:invoice", { name: "Acme" });
    const raw = localStorage.getItem("veritoken-drafts");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string);
    expect(parsed.state.drafts["deploy:invoice"].values).toEqual({ name: "Acme" });
  });
});
