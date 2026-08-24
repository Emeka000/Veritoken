/**
 * Shared TypeScript types for the event indexer service.
 */

// ── Database row shapes ───────────────────────────────────────────────────────

export interface DbCursor {
  contract_id: string;
  last_cursor: string;
  updated_at: Date;
}

export interface DbEvent {
  id: bigint;
  contract_id: string;
  event_type: string;
  ledger_sequence: bigint;
  timestamp: Date;
  topics: unknown[];
  value: unknown;
  paging_token: string;
}

export interface DbComplianceViolation {
  id: bigint;
  contract_id: string;
  from_addr: string;
  to_addr: string;
  deny_reason: string;
  ledger_sequence: bigint;
  timestamp: Date;
}

export interface DbKycChange {
  id: bigint;
  subject: string;
  verifier: string;
  new_status: string;
  tier: number;
  jurisdiction: string;
  expiry: bigint;
  ledger_sequence: bigint;
  timestamp: Date;
}

// ── Event classification ──────────────────────────────────────────────────────

/**
 * The six typed event categories the parser discriminates by topic[0].
 * `unknown` is used as a catch-all for events that don't match any pattern.
 */
export type EventKind =
  | "transfer"
  | "mint"
  | "burn"
  | "approve"
  | "compliance_violation"
  | "kyc_change"
  | "unknown";

export interface ParsedEvent {
  kind: EventKind;
  contractId: string;
  ledgerSequence: number;
  timestamp: Date;
  pagingToken: string;
  /** Raw decoded topics array */
  topics: unknown[];
  /** Raw decoded value */
  value: unknown;
}

export interface ParsedTransfer extends ParsedEvent {
  kind: "transfer";
  from: string;
  to: string;
  amount: string;
}

export interface ParsedMint extends ParsedEvent {
  kind: "mint";
  to: string;
  amount: string;
}

export interface ParsedBurn extends ParsedEvent {
  kind: "burn";
  from: string;
  amount: string;
}

export interface ParsedApprove extends ParsedEvent {
  kind: "approve";
  from: string;
  spender: string;
  amount: string;
  expirationLedger: number;
}

export interface ParsedComplianceViolation extends ParsedEvent {
  kind: "compliance_violation";
  fromAddr: string;
  toAddr: string;
  denyReason: string;
}

export interface ParsedKycChange extends ParsedEvent {
  kind: "kyc_change";
  subject: string;
  verifier: string;
  newStatus: string;
  tier: number;
  jurisdiction: string;
  expiry: number;
}

export type AnyParsedEvent =
  | ParsedTransfer
  | ParsedMint
  | ParsedBurn
  | ParsedApprove
  | ParsedComplianceViolation
  | ParsedKycChange
  | ParsedEvent;

// ── Config ────────────────────────────────────────────────────────────────────

export interface ContractConfig {
  contractId: string;
  /** Human-readable label, e.g. "rwa-token" */
  label: string;
}

export interface IndexerConfig {
  rpcUrl: string;
  networkPassphrase: string;
  pollIntervalMs: number;
  contracts: ContractConfig[];
  port: number;
}
