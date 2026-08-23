/**
 * Unit tests for eventParser.ts
 *
 * Covers the topic discriminator for all 6 event types, plus the "unknown"
 * catch-all and gap detection edge cases.
 */

import { describe, it, expect } from "vitest";
import { parseEvent, parseEvents } from "../eventParser.js";
import type { RawSorobanEvent } from "../eventParser.js";
import type {
  ParsedTransfer,
  ParsedMint,
  ParsedBurn,
  ParsedApprove,
  ParsedComplianceViolation,
  ParsedKycChange,
} from "../types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * The Stellar SDK's scValToNative is called inside parseEvent for each topic
 * and value. In unit tests we pass already-native values (strings / numbers)
 * so we mock the SDK to return the value unchanged.
 */

// Mock @stellar/stellar-sdk to avoid XDR decoding in unit tests.
import { vi } from "vitest";
vi.mock("@stellar/stellar-sdk", () => ({
  scValToNative: (v: unknown) => v,
  xdr: {},
  rpc: { Server: class {} },
}));

function makeRaw(
  topics: unknown[],
  value: unknown,
  overrides: Partial<RawSorobanEvent> = {},
): RawSorobanEvent {
  return {
    contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
    ledger: 1000,
    ledgerClosedAt: "2024-01-15T12:00:00Z",
    pagingToken: "paging-001",
    topic: topics,
    value,
    inSuccessfulContractCall: true,
    ...overrides,
  };
}

// ── transfer ──────────────────────────────────────────────────────────────────

describe("parseEvent — transfer", () => {
  it("extracts from, to, amount from topics and value", () => {
    const raw = makeRaw(
      ["transfer", "GAAA…FROM", "GBBB…TO"],
      "1000000000",
    );
    const result = parseEvent(raw) as ParsedTransfer;
    expect(result.kind).toBe("transfer");
    expect(result.from).toBe("GAAA…FROM");
    expect(result.to).toBe("GBBB…TO");
    expect(result.amount).toBe("1000000000");
  });

  it("handles bigint amount", () => {
    const raw = makeRaw(["transfer", "FROM", "TO"], BigInt("5000000000"));
    const result = parseEvent(raw) as ParsedTransfer;
    expect(result.kind).toBe("transfer");
    expect(result.amount).toBe("5000000000");
  });

  it("sets contractId and ledgerSequence from raw", () => {
    const raw = makeRaw(["transfer", "FROM", "TO"], "100", {
      contractId: "CZZZZ",
      ledger: 42,
    });
    const result = parseEvent(raw) as ParsedTransfer;
    expect(result.contractId).toBe("CZZZZ");
    expect(result.ledgerSequence).toBe(42);
  });
});

// ── mint ──────────────────────────────────────────────────────────────────────

describe("parseEvent — mint", () => {
  it("extracts to and amount", () => {
    const raw = makeRaw(["mint", "GCCC…TO"], "250000000");
    const result = parseEvent(raw) as ParsedMint;
    expect(result.kind).toBe("mint");
    expect(result.to).toBe("GCCC…TO");
    expect(result.amount).toBe("250000000");
  });

  it("handles numeric amount", () => {
    const raw = makeRaw(["mint", "TO"], 100);
    const result = parseEvent(raw) as ParsedMint;
    expect(result.amount).toBe("100");
  });
});

// ── burn ──────────────────────────────────────────────────────────────────────

describe("parseEvent — burn", () => {
  it("extracts from and amount", () => {
    const raw = makeRaw(["burn", "GDDD…FROM"], "500000000");
    const result = parseEvent(raw) as ParsedBurn;
    expect(result.kind).toBe("burn");
    expect(result.from).toBe("GDDD…FROM");
    expect(result.amount).toBe("500000000");
  });
});

// ── approve ───────────────────────────────────────────────────────────────────

describe("parseEvent — approve", () => {
  it("extracts from, spender, expirationLedger and amount", () => {
    const raw = makeRaw(
      ["approve", "OWNER", "SPENDER", 9999],
      "750000000",
    );
    const result = parseEvent(raw) as ParsedApprove;
    expect(result.kind).toBe("approve");
    expect(result.from).toBe("OWNER");
    expect(result.spender).toBe("SPENDER");
    expect(result.expirationLedger).toBe(9999);
    expect(result.amount).toBe("750000000");
  });

  it("converts bigint expirationLedger to number", () => {
    const raw = makeRaw(["approve", "O", "S", BigInt(12345)], "0");
    const result = parseEvent(raw) as ParsedApprove;
    expect(result.expirationLedger).toBe(12345);
  });
});

// ── compliance_violation ──────────────────────────────────────────────────────

describe("parseEvent — compliance_violation", () => {
  it("extracts fromAddr, toAddr, denyReason", () => {
    const raw = makeRaw(
      ["compliance_violation", "FROM_ADDR", "TO_ADDR"],
      "KycNotApproved",
    );
    const result = parseEvent(raw) as ParsedComplianceViolation;
    expect(result.kind).toBe("compliance_violation");
    expect(result.fromAddr).toBe("FROM_ADDR");
    expect(result.toAddr).toBe("TO_ADDR");
    expect(result.denyReason).toBe("KycNotApproved");
  });

  it("handles empty denyReason", () => {
    const raw = makeRaw(["compliance_violation", "A", "B"], null);
    const result = parseEvent(raw) as ParsedComplianceViolation;
    expect(result.denyReason).toBe("");
  });
});

// ── kyc_change ────────────────────────────────────────────────────────────────

describe("parseEvent — kyc_change", () => {
  it("extracts subject, newStatus and value fields", () => {
    const raw = makeRaw(
      ["kyc_change", "SUBJECT_ADDR", "Approved"],
      {
        verifier:    "VERIFIER_ADDR",
        tier:        1,
        jurisdiction: "US",
        expiry:      1893456000,
      },
    );
    const result = parseEvent(raw) as ParsedKycChange;
    expect(result.kind).toBe("kyc_change");
    expect(result.subject).toBe("SUBJECT_ADDR");
    expect(result.newStatus).toBe("Approved");
    expect(result.verifier).toBe("VERIFIER_ADDR");
    expect(result.tier).toBe(1);
    expect(result.jurisdiction).toBe("US");
    expect(result.expiry).toBe(1893456000);
  });

  it("handles missing value fields gracefully", () => {
    const raw = makeRaw(["kyc_change", "SUBJ", "Revoked"], null);
    const result = parseEvent(raw) as ParsedKycChange;
    expect(result.kind).toBe("kyc_change");
    expect(result.verifier).toBe("");
    expect(result.tier).toBe(0);
    expect(result.expiry).toBe(0);
  });
});

// ── unknown ───────────────────────────────────────────────────────────────────

describe("parseEvent — unknown", () => {
  it("returns kind='unknown' for unrecognised topic[0]", () => {
    const raw = makeRaw(["dividend_deposit", "ADDR"], "1000");
    const result = parseEvent(raw);
    expect(result.kind).toBe("unknown");
  });

  it("returns kind='unknown' for empty topics", () => {
    const raw = makeRaw([], null);
    expect(parseEvent(raw).kind).toBe("unknown");
  });
});

// ── parseEvents (batch) ───────────────────────────────────────────────────────

describe("parseEvents", () => {
  it("filters out failed contract call events by default", () => {
    const events = [
      makeRaw(["mint", "TO"], "100", { inSuccessfulContractCall: true }),
      makeRaw(["mint", "TO"], "200", { inSuccessfulContractCall: false }),
    ];
    const result = parseEvents(events);
    expect(result).toHaveLength(1);
  });

  it("includes failed events when includeFailures=true", () => {
    const events = [
      makeRaw(["mint", "TO"], "100", { inSuccessfulContractCall: true }),
      makeRaw(["mint", "TO"], "200", { inSuccessfulContractCall: false }),
    ];
    const result = parseEvents(events, true);
    expect(result).toHaveLength(2);
  });

  it("handles mixed event kinds in a batch", () => {
    const events = [
      makeRaw(["transfer", "A", "B"], "100", { pagingToken: "t1", inSuccessfulContractCall: true }),
      makeRaw(["mint", "C"], "200",          { pagingToken: "t2", inSuccessfulContractCall: true }),
      makeRaw(["burn", "D"], "300",           { pagingToken: "t3", inSuccessfulContractCall: true }),
    ];
    const result = parseEvents(events);
    expect(result.map((e) => e.kind)).toEqual(["transfer", "mint", "burn"]);
  });
});

// ── cursor / gap logic (unit) ─────────────────────────────────────────────────

describe("ledger gap detection helper", () => {
  it("identifies a gap when sequence jumps by more than 1", () => {
    const sequences = [100, 101, 105, 106]; // gap at 101→105
    const gaps: number[] = [];
    for (let i = 1; i < sequences.length; i++) {
      if (sequences[i] - sequences[i - 1] > 1) gaps.push(sequences[i - 1]);
    }
    expect(gaps).toEqual([101]);
  });

  it("finds no gap in a consecutive sequence", () => {
    const sequences = [200, 201, 202, 203];
    const gaps: number[] = [];
    for (let i = 1; i < sequences.length; i++) {
      if (sequences[i] - sequences[i - 1] > 1) gaps.push(sequences[i - 1]);
    }
    expect(gaps).toHaveLength(0);
  });
});
