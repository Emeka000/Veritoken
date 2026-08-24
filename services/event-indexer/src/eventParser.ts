/**
 * eventParser — topic-based discriminator for Soroban contract events.
 *
 * The Veritoken contracts emit events whose first topic is a Symbol that
 * identifies the event kind (e.g. "transfer", "mint", "kyc_change").
 * This module decodes the raw XDR topic/value arrays returned by the
 * Soroban RPC into strongly-typed ParsedEvent variants.
 *
 * Topic layout per event kind (matches the contracts in contracts/):
 *
 *   transfer           topics: ["transfer", from, to]  value: amount (i128)
 *   mint               topics: ["mint",     to]         value: amount (i128)
 *   burn               topics: ["burn",     from]       value: amount (i128)
 *   approve            topics: ["approve",  from, spender, expiration_ledger]  value: amount
 *   compliance_viol.   topics: ["compliance_violation", from, to]  value: deny_reason (Sym)
 *   kyc_change         topics: ["kyc_change", subject, new_status]
 *                               value: { verifier, tier, jurisdiction, expiry }
 *
 * Any event not matching the above is returned with kind = "unknown".
 */

import { scValToNative, xdr } from "@stellar/stellar-sdk";
import type {
  AnyParsedEvent,
  EventKind,
  ParsedApprove,
  ParsedBurn,
  ParsedComplianceViolation,
  ParsedEvent,
  ParsedKycChange,
  ParsedMint,
  ParsedTransfer,
} from "./types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeNative(scVal: unknown): unknown {
  try {
    return scValToNative(scVal as xdr.ScVal);
  } catch {
    if (typeof scVal === "string") return scVal;
    return null;
  }
}

function toString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number") return String(v);
  return String(v);
}

function toBigString(v: unknown): string {
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v;
  return "0";
}

function toNumber(v: unknown): number {
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number") return v;
  if (typeof v === "string") return parseInt(v, 10) || 0;
  return 0;
}

// ── Topic kind discriminator ──────────────────────────────────────────────────

const KIND_SYMBOLS = new Set([
  "transfer",
  "mint",
  "burn",
  "approve",
  "compliance_violation",
  "kyc_change",
]);

function extractKind(rawTopics: unknown[]): EventKind {
  if (!rawTopics.length) return "unknown";
  const first = safeNative(rawTopics[0]);
  const s = toString(first).toLowerCase();
  if (KIND_SYMBOLS.has(s)) return s as EventKind;

  // Some contracts use short symbols like "transfer" encoded as Sym
  // and some use "xfer". Normalise common aliases.
  if (s === "xfer") return "transfer";
  return "unknown";
}

// ── Raw event shape coming from RPC ──────────────────────────────────────────

export interface RawSorobanEvent {
  contractId: string;
  ledger: number;
  ledgerClosedAt: string;
  pagingToken: string;
  topic: unknown[];          // array of raw xdr.ScVal (or already native)
  value: unknown;            // raw xdr.ScVal (or already native)
  inSuccessfulContractCall?: boolean;
}

// ── Main parser ───────────────────────────────────────────────────────────────

/**
 * Parse a single raw Soroban event into a typed `AnyParsedEvent`.
 *
 * @param raw - The raw event object from the RPC `getEvents` response.
 * @returns   A typed parsed event; `kind` is `"unknown"` when unrecognised.
 */
export function parseEvent(raw: RawSorobanEvent): AnyParsedEvent {
  const nativeTopics = raw.topic.map(safeNative);
  const nativeValue = safeNative(raw.value);

  const base: ParsedEvent = {
    kind: "unknown",
    contractId: raw.contractId ?? "",
    ledgerSequence: raw.ledger,
    timestamp: new Date(raw.ledgerClosedAt),
    pagingToken: raw.pagingToken,
    topics: nativeTopics,
    value: nativeValue,
  };

  const kind = extractKind(raw.topic);

  switch (kind) {
    case "transfer": {
      const from = toString(nativeTopics[1]);
      const to   = toString(nativeTopics[2]);
      const amount = toBigString(nativeValue);
      return { ...base, kind: "transfer", from, to, amount } satisfies ParsedTransfer;
    }

    case "mint": {
      const to = toString(nativeTopics[1]);
      const amount = toBigString(nativeValue);
      return { ...base, kind: "mint", to, amount } satisfies ParsedMint;
    }

    case "burn": {
      const from = toString(nativeTopics[1]);
      const amount = toBigString(nativeValue);
      return { ...base, kind: "burn", from, amount } satisfies ParsedBurn;
    }

    case "approve": {
      const from             = toString(nativeTopics[1]);
      const spender          = toString(nativeTopics[2]);
      const expirationLedger = toNumber(nativeTopics[3]);
      const amount           = toBigString(nativeValue);
      return {
        ...base,
        kind: "approve",
        from,
        spender,
        amount,
        expirationLedger,
      } satisfies ParsedApprove;
    }

    case "compliance_violation": {
      const fromAddr  = toString(nativeTopics[1]);
      const toAddr    = toString(nativeTopics[2]);
      const denyReason = toString(nativeValue);
      return {
        ...base,
        kind: "compliance_violation",
        fromAddr,
        toAddr,
        denyReason,
      } satisfies ParsedComplianceViolation;
    }

    case "kyc_change": {
      const subject   = toString(nativeTopics[1]);
      const newStatus = toString(nativeTopics[2]);
      // value is { verifier, tier, jurisdiction, expiry } or individual fields
      const val = (nativeValue && typeof nativeValue === "object")
        ? (nativeValue as Record<string, unknown>)
        : {};
      const verifier    = toString(val["verifier"]);
      const tier        = toNumber(val["tier"]);
      const jurisdiction = toString(val["jurisdiction"]);
      const expiry      = toNumber(val["expiry"]);
      return {
        ...base,
        kind: "kyc_change",
        subject,
        verifier,
        newStatus,
        tier,
        jurisdiction,
        expiry,
      } satisfies ParsedKycChange;
    }

    default:
      return base;
  }
}

/**
 * Parse an array of raw events. Filters out events from failed contract
 * calls unless `includeFailures` is true.
 */
export function parseEvents(
  rawEvents: RawSorobanEvent[],
  includeFailures = false,
): AnyParsedEvent[] {
  return rawEvents
    .filter((e) => includeFailures || e.inSuccessfulContractCall !== false)
    .map(parseEvent);
}
