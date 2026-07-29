import { describe, it, expect, beforeEach } from "vitest";
import {
  useSnapshotStore,
  createSnapshot,
  addSnapshot,
  removeSnapshot,
  listSnapshots,
  isValidSnapshot,
  SNAPSHOT_FORMAT_VERSION,
} from "../snapshots";
import type { ComplianceRules } from "../../types";

const RULES: ComplianceRules = {
  max_transfer_amount: 1000n,
  min_holding_period: 0n,
  max_holding_period: 0n,
  max_holders: 0,
  require_same_jurisdiction: false,
  paused: false,
  allowlist_mode: false,
};

beforeEach(() => {
  useSnapshotStore.setState({ snapshots: [] });
  localStorage.clear();
});

describe("createSnapshot", () => {
  it("builds a snapshot from live compliance state", () => {
    const snap = createSnapshot("Baseline", "testnet", RULES, [], null, ["GADDR1"]);
    expect(snap.version).toBe(SNAPSHOT_FORMAT_VERSION);
    expect(snap.label).toBe("Baseline");
    expect(snap.network).toBe("testnet");
    expect(snap.blocklist).toEqual(["GADDR1"]);
    expect(snap.config.rules.max_transfer_amount).toBe("1000");
    expect(typeof snap.id).toBe("string");
    expect(typeof snap.createdAt).toBe("string");
  });
});

describe("snapshot store", () => {
  it("starts empty", () => {
    expect(listSnapshots()).toEqual([]);
  });

  it("addSnapshot() then listSnapshots() returns it", () => {
    const snap = createSnapshot("Baseline", "testnet", RULES, [], null, []);
    addSnapshot(snap);
    expect(listSnapshots()).toHaveLength(1);
    expect(listSnapshots()[0].id).toBe(snap.id);
  });

  it("lists snapshots newest first", () => {
    const first = createSnapshot("First", "testnet", RULES, [], null, []);
    addSnapshot(first);
    const second = createSnapshot("Second", "testnet", RULES, [], null, []);
    addSnapshot(second);
    const listed = listSnapshots();
    expect(listed[0].label).toBe("Second");
    expect(listed[1].label).toBe("First");
  });

  it("caps the list at 25 entries, dropping the oldest", () => {
    for (let i = 0; i < 30; i++) {
      addSnapshot(createSnapshot(`Snap ${i}`, "testnet", RULES, [], null, []));
    }
    const listed = listSnapshots();
    expect(listed).toHaveLength(25);
    expect(listed[0].label).toBe("Snap 29");
    expect(listed.some((s) => s.label === "Snap 0")).toBe(false);
  });

  it("removeSnapshot() deletes a single entry", () => {
    const a = createSnapshot("A", "testnet", RULES, [], null, []);
    const b = createSnapshot("B", "testnet", RULES, [], null, []);
    addSnapshot(a);
    addSnapshot(b);
    removeSnapshot(a.id);
    const listed = listSnapshots();
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(b.id);
  });
});

describe("isValidSnapshot", () => {
  it("accepts a well-formed snapshot", () => {
    const snap = createSnapshot("Baseline", "testnet", RULES, [], null, []);
    expect(isValidSnapshot(snap)).toBe(true);
  });

  it("rejects malformed or old-format data", () => {
    expect(isValidSnapshot(null)).toBe(false);
    expect(isValidSnapshot({})).toBe(false);
    expect(isValidSnapshot({ version: 0, id: "x", label: "x", network: "x", createdAt: "x", config: {}, blocklist: [] })).toBe(false);
    expect(isValidSnapshot({ version: SNAPSHOT_FORMAT_VERSION, id: "x" })).toBe(false);
  });

  it("filters corrupted entries out of listSnapshots()", () => {
    useSnapshotStore.setState({
      snapshots: [
        // @ts-expect-error intentionally malformed for the test
        { version: 0, id: "bad" },
        createSnapshot("Good", "testnet", RULES, [], null, []),
      ],
    });
    const listed = listSnapshots();
    expect(listed).toHaveLength(1);
    expect(listed[0].label).toBe("Good");
  });
});
