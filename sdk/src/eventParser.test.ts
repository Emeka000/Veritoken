import { describe, it, expect } from "vitest";
import { nativeToScVal, Contract } from "@stellar/stellar-sdk";
import { parseEvent, parseEvents, filterByName, type ParsedEvent } from "./eventParser.js";

const CONTRACT_ID = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const ALICE = "GBQG2SJ7MXUH34SI3MJ2I256I5UMGM2QSQZM77YFX5S6JOHXUQJEPC3A";
const BOB = "GAQWW5UBJVPNKMM5NLAIBEL6QK24ODXABL7YAXBN6KNMH3OYNM5JXT35";

function rawEvent(topics: unknown[], value: unknown, overrides: Record<string, unknown> = {}) {
  return {
    id: "0000000001-0000000000",
    type: "contract",
    ledger: 12345,
    ledgerClosedAt: "2026-01-01T00:00:00Z",
    pagingToken: "12345-0",
    inSuccessfulContractCall: true,
    txHash: "abc123",
    contractId: new Contract(CONTRACT_ID),
    topic: topics.map((t) => nativeToScVal(t as never)),
    value: nativeToScVal(value as never),
    ...overrides,
  } as any;
}

describe("parseEvent — known event schema", () => {
  it("decodes transfer: addresses from topics, amount/timestamp from data", () => {
    const e = parseEvent(rawEvent(["transfer", ALICE, BOB], [nativeToScVal(500n, { type: "i128" }), nativeToScVal(999n, { type: "u64" })]));
    expect(e.name).toBe("transfer");
    if (e.known && e.name === "transfer") {
      expect(e.data.from).toBe(ALICE);
      expect(e.data.to).toBe(BOB);
      expect(e.data.amount).toBe(500n);
      expect(e.data.timestamp).toBe(999n);
    }
  });

  it("decodes mint: recipient from topic, amount/timestamp from data", () => {
    const e = parseEvent(rawEvent(["mint", ALICE], [nativeToScVal(100n, { type: "i128" }), nativeToScVal(1n, { type: "u64" })]));
    expect(e.name).toBe("mint");
    if (e.known && e.name === "mint") {
      expect(e.data.to).toBe(ALICE);
      expect(e.data.amount).toBe(100n);
    }
  });

  it("decodes burn", () => {
    const e = parseEvent(rawEvent(["burn", ALICE], [nativeToScVal(20n, { type: "i128" }), nativeToScVal(2n, { type: "u64" })]));
    expect(e.name).toBe("burn");
    if (e.known && e.name === "burn") {
      expect(e.data.from).toBe(ALICE);
      expect(e.data.amount).toBe(20n);
    }
  });

  it("decodes approve", () => {
    const e = parseEvent(rawEvent(["approve", ALICE, BOB], [nativeToScVal(30n, { type: "i128" }), nativeToScVal(500, { type: "u32" })]));
    expect(e.name).toBe("approve");
    if (e.known && e.name === "approve") {
      expect(e.data.from).toBe(ALICE);
      expect(e.data.spender).toBe(BOB);
      expect(e.data.expirationLedger).toBe(500);
    }
  });

  it("decodes freeze with no data payload", () => {
    const e = parseEvent(rawEvent(["freeze", ALICE], undefined));
    expect(e.name).toBe("freeze");
    if (e.known && (e.name === "freeze" || e.name === "unfreeze")) {
      expect(e.data.addr).toBe(ALICE);
    }
  });

  it("decodes adm_set (admin transfer)", () => {
    const e = parseEvent(rawEvent(["adm_set"], [ALICE, BOB]));
    expect(e.name).toBe("adm_set");
    if (e.known && e.name === "adm_set") {
      expect(e.data.oldAdmin).toBe(ALICE);
      expect(e.data.newAdmin).toBe(BOB);
    }
  });

  it("decodes adm_prp (proposed admin + nonce)", () => {
    const e = parseEvent(rawEvent(["adm_prp"], [nativeToScVal(ALICE, { type: "address" }), nativeToScVal(7n, { type: "u64" })]));
    expect(e.name).toBe("adm_prp");
    if (e.known && e.name === "adm_prp") {
      expect(e.data.newAdmin).toBe(ALICE);
      expect(e.data.nonce).toBe(7n);
    }
  });

  it("decodes role_set / role_rev", () => {
    const assigned = parseEvent(rawEvent(["role_set"], [nativeToScVal("verifier", { type: "symbol" }), nativeToScVal(ALICE, { type: "address" }), nativeToScVal(1n, { type: "u64" })]));
    expect(assigned.name).toBe("role_set");
    if (assigned.known && assigned.name === "role_set") {
      expect(assigned.data.role).toBe("verifier");
      expect(assigned.data.holder).toBe(ALICE);
    }

    const revoked = parseEvent(rawEvent(["role_rev"], [nativeToScVal("verifier", { type: "symbol" }), nativeToScVal(2n, { type: "u64" })]));
    expect(revoked.name).toBe("role_rev");
    if (revoked.known && revoked.name === "role_rev") expect(revoked.data.role).toBe("verifier");
  });

  it("decodes kyc_stale", () => {
    const e = parseEvent(rawEvent(["kyc_stale", ALICE], [nativeToScVal(true, { type: "bool" }), nativeToScVal(1234n, { type: "u64" })]));
    expect(e.name).toBe("kyc_stale");
    if (e.known && e.name === "kyc_stale") {
      expect(e.data.addr).toBe(ALICE);
      expect(e.data.isActive).toBe(true);
      expect(e.data.expiry).toBe(1234n);
    }
  });

  it("carries through envelope metadata (id, ledger, txHash, contractId)", () => {
    const e = parseEvent(rawEvent(["mint", ALICE], [nativeToScVal(1n, { type: "i128" }), nativeToScVal(1n, { type: "u64" })]));
    expect(e.id).toBe("0000000001-0000000000");
    expect(e.ledger).toBe(12345);
    expect(e.txHash).toBe("abc123");
    expect(e.contractId).toBe(CONTRACT_ID);
  });
});

describe("parseEvent — unknown events", () => {
  it("falls back to the raw decoded value and a string name", () => {
    const e = parseEvent(rawEvent(["some_future_event", ALICE], nativeToScVal("payload", { type: "string" })));
    expect(e.name).toBe("some_future_event");
    expect(e.data).toBe("payload");
  });
});

describe("parseEvents / filterByName", () => {
  it("parses a batch and filters by name with a narrowed type", () => {
    const events = parseEvents([
      rawEvent(["transfer", ALICE, BOB], [nativeToScVal(1n, { type: "i128" }), nativeToScVal(1n, { type: "u64" })]),
      rawEvent(["mint", ALICE], [nativeToScVal(2n, { type: "i128" }), nativeToScVal(2n, { type: "u64" })]),
      rawEvent(["transfer", BOB, ALICE], [nativeToScVal(3n, { type: "i128" }), nativeToScVal(3n, { type: "u64" })]),
    ]);
    const transfers = filterByName(events, "transfer");
    expect(transfers).toHaveLength(2);
    expect(transfers.every((t) => t.data.amount > 0n)).toBe(true);
  });
});

// Type-level check: ParsedEvent should be assignable from parseEvent's return.
const _typeCheck: ParsedEvent = parseEvent(rawEvent(["mint", ALICE], [nativeToScVal(1n, { type: "i128" }), nativeToScVal(1n, { type: "u64" })]));
void _typeCheck;
