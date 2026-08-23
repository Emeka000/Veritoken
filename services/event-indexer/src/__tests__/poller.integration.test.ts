/**
 * Integration tests for ContractPoller — mock RPC server + mock DB helpers.
 *
 * Verifies:
 *   1. All 3 pages of events are consumed in order.
 *   2. The cursor is advanced after each successful batch.
 *   3. No duplicate events are inserted on restart (upsert idempotency).
 *   4. compliance_violation and kyc_change events hit their specialist tables.
 *   5. Empty RPC response → no DB writes.
 *   6. RPC error → no crash, no DB writes.
 *   7. DB error → ROLLBACK called, cursor not advanced.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoist all mock fn references so vi.mock factories can close over them ─────

const mockGetEvents   = vi.hoisted(() => vi.fn());
const mockGetLatest   = vi.hoisted(() => vi.fn());

const mockUpsertEvent     = vi.hoisted(() => vi.fn());
const mockUpsertCursor    = vi.hoisted(() => vi.fn());
const mockInsertViolation = vi.hoisted(() => vi.fn());
const mockInsertKycChange = vi.hoisted(() => vi.fn());
const mockGetCursor       = vi.hoisted(() => vi.fn());
const mockPoolConnect     = vi.hoisted(() => vi.fn());
const mockClientQuery     = vi.hoisted(() => vi.fn());
const mockClientRelease   = vi.hoisted(() => vi.fn());

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@stellar/stellar-sdk", () => ({
  scValToNative: (v: unknown) => v,
  xdr: {},
  rpc: {
    Server: vi.fn().mockImplementation(() => ({
      getEvents:       mockGetEvents,
      getLatestLedger: mockGetLatest,
    })),
  },
}));

vi.mock("../db/pool.js", () => ({
  pool: {
    connect: mockPoolConnect,
    query:   vi.fn(),
    end:     vi.fn(),
  },
}));

vi.mock("../db/queries.js", () => ({
  getCursor:       mockGetCursor,
  upsertCursor:    mockUpsertCursor,
  upsertEvent:     mockUpsertEvent,
  insertViolation: mockInsertViolation,
  insertKycChange: mockInsertKycChange,
  getAllCursors:    vi.fn().mockResolvedValue([]),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRawEvent(
  pagingToken: string,
  kind: string,
  ledger: number,
  extra: Record<string, unknown> = {},
) {
  return {
    contractId:              "CTEST",
    ledger,
    ledgerClosedAt:          "2024-01-15T12:00:00Z",
    pagingToken,
    topic:                   [kind, "ADDR_A", "ADDR_B"],
    value:                   "1000",
    inSuccessfulContractCall: true,
    ...extra,
  };
}

// ── Imports (after mocks are registered) ─────────────────────────────────────

import { ContractPoller } from "../poller.js";
import { rpc } from "@stellar/stellar-sdk";
import type { ContractConfig } from "../types.js";

const CONTRACT: ContractConfig = { contractId: "CTEST", label: "test-contract" };

function makePoller(): ContractPoller {
  const server = new rpc.Server("http://localhost:8000");
  return new ContractPoller(server, CONTRACT, 5000);
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  mockGetCursor.mockResolvedValue("");
  mockGetLatest.mockResolvedValue({ sequence: 1000 });

  const client = { query: mockClientQuery, release: mockClientRelease };
  mockPoolConnect.mockResolvedValue(client);
  mockClientQuery.mockResolvedValue({ rows: [] });

  mockUpsertEvent.mockResolvedValue(undefined);
  mockUpsertCursor.mockResolvedValue(undefined);
  mockInsertViolation.mockResolvedValue(undefined);
  mockInsertKycChange.mockResolvedValue(undefined);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ContractPoller — multi-page indexing", () => {
  it("indexes all 3 pages of events in order", async () => {
    const page1 = [
      makeRawEvent("tok-1", "transfer", 100),
      makeRawEvent("tok-2", "transfer", 101),
      makeRawEvent("tok-3", "transfer", 102),
    ];
    const page2 = [
      makeRawEvent("tok-4", "mint", 103),
      makeRawEvent("tok-5", "mint", 104),
      makeRawEvent("tok-6", "compliance_violation", 105, {
        topic: ["compliance_violation", "FROM", "TO"],
        value: "KycNotApproved",
      }),
    ];
    const page3 = [
      makeRawEvent("tok-7", "kyc_change", 106, {
        topic: ["kyc_change", "SUBJ", "Approved"],
        value: { verifier: "VER", tier: 1, jurisdiction: "US", expiry: 1893456000 },
      }),
    ];

    mockGetEvents
      .mockResolvedValueOnce({ events: page1 })
      .mockResolvedValueOnce({ events: page2 })
      .mockResolvedValueOnce({ events: page3 })
      .mockResolvedValue({ events: [] });

    const poller = makePoller();
    await poller.poll(); // page 1
    await poller.poll(); // page 2
    await poller.poll(); // page 3

    // All 7 events upserted
    expect(mockUpsertEvent).toHaveBeenCalledTimes(7);

    // Cursor advanced 3 times
    expect(mockUpsertCursor).toHaveBeenCalledTimes(3);
    expect(mockUpsertCursor).toHaveBeenLastCalledWith(
      expect.anything(),
      "CTEST",
      "tok-7",
    );

    // compliance_violation → insertViolation once
    expect(mockInsertViolation).toHaveBeenCalledTimes(1);
    const vCall = mockInsertViolation.mock.calls[0][1] as Record<string, unknown>;
    expect(vCall.from_addr).toBe("FROM");
    expect(vCall.to_addr).toBe("TO");
    expect(vCall.deny_reason).toBe("KycNotApproved");

    // kyc_change → insertKycChange once
    expect(mockInsertKycChange).toHaveBeenCalledTimes(1);
    const kCall = mockInsertKycChange.mock.calls[0][1] as Record<string, unknown>;
    expect(kCall.subject).toBe("SUBJ");
    expect(kCall.new_status).toBe("Approved");
  });
});

describe("ContractPoller — restart idempotency", () => {
  it("resumes from stored cursor without re-indexing old events", async () => {
    mockGetCursor.mockResolvedValue("tok-5");

    const newEvents = [
      makeRawEvent("tok-6", "transfer", 106),
      makeRawEvent("tok-7", "transfer", 107),
    ];
    mockGetEvents
      .mockResolvedValueOnce({ events: newEvents })
      .mockResolvedValue({ events: [] });

    const poller = makePoller();
    await poller.poll();

    // Only 2 new events indexed (not the old ones before tok-5)
    expect(mockUpsertEvent).toHaveBeenCalledTimes(2);
    expect(mockUpsertCursor).toHaveBeenCalledWith(
      expect.anything(),
      "CTEST",
      "tok-7",
    );
  });
});

describe("ContractPoller — empty response", () => {
  it("does not write to the DB when there are no new events", async () => {
    mockGetEvents.mockResolvedValue({ events: [] });

    const poller = makePoller();
    await poller.poll();

    expect(mockUpsertEvent).not.toHaveBeenCalled();
    expect(mockUpsertCursor).not.toHaveBeenCalled();
  });
});

describe("ContractPoller — RPC error resilience", () => {
  it("logs and skips the cycle on RPC failure without crashing", async () => {
    mockGetEvents.mockRejectedValue(new Error("Connection refused"));

    const poller = makePoller();
    await expect(poller.poll()).resolves.toBeUndefined();

    expect(mockUpsertEvent).not.toHaveBeenCalled();
  });
});

describe("ContractPoller — DB rollback on error", () => {
  it("calls ROLLBACK and does not advance cursor when a DB write fails", async () => {
    mockGetEvents.mockResolvedValueOnce({
      events: [makeRawEvent("tok-1", "transfer", 100)],
    });
    mockUpsertEvent.mockRejectedValueOnce(new Error("DB write error"));

    const poller = makePoller();
    await poller.poll();

    // ROLLBACK must appear in client.query calls
    const calls = (mockClientQuery.mock.calls as Array<[string]>).map((c) => c[0]);
    expect(calls).toContain("ROLLBACK");

    // Cursor must NOT advance
    expect(mockUpsertCursor).not.toHaveBeenCalled();
  });
});

describe("ContractPoller — gap detection tracking", () => {
  it("records the last processed ledger after a successful poll", async () => {
    mockGetEvents.mockResolvedValueOnce({
      events: [
        makeRawEvent("tok-1", "transfer", 200),
        makeRawEvent("tok-2", "transfer", 201),
      ],
    });

    const poller = makePoller();
    expect(poller.getLastProcessedLedger()).toBe(0);
    await poller.poll();
    expect(poller.getLastProcessedLedger()).toBe(201);
  });
});
