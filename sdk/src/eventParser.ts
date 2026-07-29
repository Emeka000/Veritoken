/**
 * Typed event parsing for Veritoken contract events (#393).
 *
 * Every Veritoken contract publishes events as `env.events().publish(topics,
 * data)`, where `topics` is `(Symbol, ...)` and `topics[0]` is the event
 * name. This module decodes a raw `rpc.Api.EventResponse` (or a batch of
 * them from `getEvents`) into a `ParsedEvent` whose `data` field is typed
 * according to the event name, so callers can inspect transfer, admin, and
 * compliance activity without writing bespoke ScVal-decoding logic.
 *
 * ## Coverage
 * The canonical, fully-typed schema below mirrors the structured event
 * helpers in `contracts/rwa-token/src/events.rs` (topics + data shape are
 * shared across the token contracts for transfer/mint/burn/approve/freeze,
 * and across all contracts for the admin-transfer flow). Events published
 * with a topic name outside this list still decode — `data` is the raw
 * native value and `name` is typed as `string` rather than a known literal.
 *
 * | name        | topics (after name) | data                              |
 * |-------------|----------------------|------------------------------------|
 * | transfer    | from, to             | (amount: i128, ts: u64)            |
 * | mint        | to                   | (amount: i128, ts: u64)            |
 * | burn        | from                 | (amount: i128, ts: u64)            |
 * | approve     | from, spender        | (amount: i128, exp: u32)           |
 * | freeze      | addr                 | ()                                  |
 * | unfreeze    | addr                 | ()                                  |
 * | adm_prp     | —                    | (new_admin: Address, nonce: u64)   |
 * | adm_set     | —                    | (old: Address, new: Address)       |
 * | kyc_upd     | —                    | (new_registry: Address, nonce: u64)|
 * | ce_upd      | —                    | (new_engine: Address, nonce: u64)  |
 * | role_set    | —                    | (role: Symbol, holder: Address, nonce: u64) |
 * | role_rev    | —                    | (role: Symbol, nonce: u64)         |
 * | migrated    | —                    | (new_version: String, nonce: u64)  |
 * | rcv_exe     | —                    | (old_admin: Address, new_admin: Address) |
 * | kyc_stale   | addr                 | (is_active: bool, expiry: u64)     |
 */

import { scValToNative, type rpc } from "@stellar/stellar-sdk";
import type {
  TransferEventData, MintEventData, BurnEventData, ApproveEventData,
  FreezeEventData, AdminProposedEventData, AdminSetEventData,
  KycUpdatedEventData, CeUpdatedEventData, RoleAssignedEventData,
  RoleRevokedEventData, MigrationEventData, RecoveryExecutedEventData,
  KycStaleEventData,
} from "./events.js";

// ── Result shape ─────────────────────────────────────────────────────────────

interface ParsedEventBase {
  /** Decoded topic values after topic[0] (the event name symbol). */
  topics: unknown[];
  id: string;
  ledger: number;
  ledgerClosedAt: string;
  txHash: string;
  pagingToken: string;
  contractId?: string;
  inSuccessfulContractCall: boolean;
}

/** Maps a known event name to its typed data payload. */
export interface EventDataMap {
  transfer: TransferEventData;
  mint: MintEventData;
  burn: BurnEventData;
  approve: ApproveEventData;
  freeze: FreezeEventData;
  unfreeze: FreezeEventData;
  adm_prp: AdminProposedEventData;
  adm_set: AdminSetEventData;
  kyc_upd: KycUpdatedEventData;
  ce_upd: CeUpdatedEventData;
  role_set: RoleAssignedEventData;
  role_rev: RoleRevokedEventData;
  migrated: MigrationEventData & { nonce: bigint };
  rcv_exe: RecoveryExecutedEventData;
  kyc_stale: KycStaleEventData;
}

/** Event names with a typed entry in `EventDataMap`. */
export type KnownEventName = keyof EventDataMap;

/** A decoded event whose name matched a known schema — `data` is fully typed. */
export type KnownParsedEvent = {
  [K in KnownEventName]: ParsedEventBase & { known: true; name: K; data: EventDataMap[K] };
}[KnownEventName];

/** A decoded event whose name didn't match any known schema — `data` is the raw decoded value. */
export type UnknownParsedEvent = ParsedEventBase & { known: false; name: string; data: unknown };

/**
 * A decoded contract event. `known` is a `true`/`false` discriminant checked
 * *before* `name` so TypeScript can narrow `data` to the matching typed
 * payload:
 *
 * ```ts
 * if (e.known && e.name === "transfer") {
 *   e.data.amount; // typed as bigint
 * }
 * ```
 *
 * (Checking `e.name` alone does not narrow `data` — `UnknownParsedEvent.name`
 * is `string`, which TypeScript can't rule out from a bare `===` comparison,
 * so `known` must be checked first.) Prefer `filterByName(events, "transfer")`
 * to narrow a whole array at once without the two-step check.
 */
export type ParsedEvent = KnownParsedEvent | UnknownParsedEvent;

// ── Per-event decoders ────────────────────────────────────────────────────────

type Decoder = (topics: unknown[], data: unknown) => unknown;

/** Soroban tuples decode to JS arrays; `()` decodes to undefined/null. */
const asTuple = (data: unknown): unknown[] =>
  Array.isArray(data) ? data : data === undefined || data === null ? [] : [data];

const DECODERS: Record<string, Decoder> = {
  transfer: (topics, data) => {
    const [amount, timestamp] = asTuple(data) as [bigint, bigint];
    const [from, to] = topics as [string, string];
    return { from, to, amount, timestamp } satisfies TransferEventData;
  },
  mint: (topics, data) => {
    const [amount, timestamp] = asTuple(data) as [bigint, bigint];
    const [to] = topics as [string];
    return { to, amount, timestamp } satisfies MintEventData;
  },
  burn: (topics, data) => {
    const [amount, timestamp] = asTuple(data) as [bigint, bigint];
    const [from] = topics as [string];
    return { from, amount, timestamp } satisfies BurnEventData;
  },
  approve: (topics, data) => {
    const [amount, expirationLedger] = asTuple(data) as [bigint, number];
    const [from, spender] = topics as [string, string];
    return { from, spender, amount, expirationLedger } satisfies ApproveEventData;
  },
  freeze: (topics) => ({ addr: topics[0] as string }) satisfies FreezeEventData,
  unfreeze: (topics) => ({ addr: topics[0] as string }) satisfies FreezeEventData,
  adm_prp: (_topics, data) => {
    const [newAdmin, nonce] = asTuple(data) as [string, bigint];
    return { newAdmin, nonce } satisfies AdminProposedEventData;
  },
  adm_set: (_topics, data) => {
    const [oldAdmin, newAdmin] = asTuple(data) as [string, string];
    return { oldAdmin, newAdmin } satisfies AdminSetEventData;
  },
  kyc_upd: (_topics, data) => {
    const [newRegistry, nonce] = asTuple(data) as [string, bigint];
    return { newRegistry, nonce } satisfies KycUpdatedEventData;
  },
  ce_upd: (_topics, data) => {
    const [newEngine, nonce] = asTuple(data) as [string, bigint];
    return { newEngine, nonce } satisfies CeUpdatedEventData;
  },
  role_set: (_topics, data) => {
    const [role, holder, nonce] = asTuple(data) as [string, string, bigint];
    return { role, holder, nonce } satisfies RoleAssignedEventData;
  },
  role_rev: (_topics, data) => {
    const [role, nonce] = asTuple(data) as [string, bigint];
    return { role, nonce } satisfies RoleRevokedEventData;
  },
  migrated: (_topics, data) => {
    const [newVersion, nonce] = asTuple(data) as [string, bigint];
    return { newVersion, nonce } satisfies MigrationEventData & { nonce: bigint };
  },
  rcv_exe: (_topics, data) => {
    const [oldAdmin, newAdmin] = asTuple(data) as [string, string];
    return { oldAdmin, newAdmin } satisfies RecoveryExecutedEventData;
  },
  kyc_stale: (topics, data) => {
    const [isActive, expiry] = asTuple(data) as [boolean, bigint];
    return { addr: topics[0] as string, isActive, expiry } satisfies KycStaleEventData;
  },
};

// ── contractId normalisation ──────────────────────────────────────────────────

function contractIdToString(contractId: unknown): string | undefined {
  if (!contractId) return undefined;
  if (typeof contractId === "string") return contractId;
  if (typeof contractId === "object" && "contractId" in (contractId as object)) {
    try {
      return (contractId as { contractId: () => string }).contractId();
    } catch {
      /* fall through to String() below */
    }
  }
  return String(contractId);
}

// ── Public API ─────────────────────────────────────────────────────────────────

/** Decode a single raw RPC event into a typed `ParsedEvent`. */
export function parseEvent(event: rpc.Api.EventResponse): ParsedEvent {
  const decodedTopics = event.topic.map((t) => scValToNative(t));
  const [name, ...rest] = decodedTopics as [string, ...unknown[]];
  const data = scValToNative(event.value);
  const decoder = DECODERS[name];
  const known = Boolean(decoder);
  const parsedData = decoder ? decoder(rest, data) : data;

  return {
    known,
    name,
    data: parsedData,
    topics: rest,
    id: event.id,
    ledger: event.ledger,
    ledgerClosedAt: event.ledgerClosedAt,
    txHash: event.txHash,
    pagingToken: event.pagingToken,
    contractId: contractIdToString(event.contractId),
    inSuccessfulContractCall: event.inSuccessfulContractCall,
  } as ParsedEvent;
}

/** Decode a batch of raw RPC events (e.g. `getEvents(...).events`). */
export function parseEvents(events: rpc.Api.EventResponse[]): ParsedEvent[] {
  return events.map(parseEvent);
}

/** Narrow a list of parsed events down to a single known event name. */
export function filterByName<N extends KnownEventName>(
  events: ParsedEvent[],
  name: N,
): Extract<KnownParsedEvent, { name: N }>[] {
  return events.filter(
    (e): e is Extract<KnownParsedEvent, { name: N }> => e.known && e.name === name,
  );
}
