/**
 * Veritoken Structured Event Types
 *
 * All Veritoken contracts emit events via Soroban's event system.
 * Each event has a topic tuple (first element is always the event name Symbol)
 * and a data payload.
 *
 * Use Stellar RPC `getEvents` with a `ContractId` filter and a topic[0] filter
 * to subscribe to specific event types.
 *
 * @example
 * ```ts
 * const events = await server.getEvents({
 *   startLedger: fromLedger,
 *   filters: [{
 *     type: "contract",
 *     contractIds: [rwaTokenContractId],
 *     topics: [[TOPIC_TRANSFER]], // base64-encoded Symbol XDR
 *   }],
 * });
 * ```
 */

// ── Topic name constants ───────────────────────────────────────────────────────
// These match the Soroban Symbol values emitted by the contracts.

/** Token transfer (rwa-token, property-token, carbon-credit-token, invoice-token) */
export const TOPIC_TRANSFER = "transfer";
/** Token mint */
export const TOPIC_MINT = "mint";
/** Token burn */
export const TOPIC_BURN = "burn";
/** SEP-41 approval */
export const TOPIC_APPROVE = "approve";
/** Account frozen */
export const TOPIC_FREEZE = "freeze";
/** Account unfrozen */
export const TOPIC_UNFREEZE = "unfreeze";
/** Admin transfer proposed */
export const TOPIC_ADMIN_PROPOSED = "adm_prp";
/** Admin transfer executed */
export const TOPIC_ADMIN_SET = "adm_set";
/** KYC registry address updated */
export const TOPIC_KYC_UPDATED = "kyc_upd";
/** Compliance engine address updated */
export const TOPIC_CE_UPDATED = "ce_upd";
/** Compliance rules proposed (with time-lock) */
export const TOPIC_RULES_PROPOSED = "rules_prp";
/** Compliance rules activated */
export const TOPIC_RULES_ACTIVATED = "rules_act";
/** Compliance rules set immediately (bypasses time-lock) */
export const TOPIC_RULES_SET = "rules_set";
/** Compliance paused */
export const TOPIC_PAUSED = "paused";
/** Compliance unpaused */
export const TOPIC_UNPAUSED = "unpaused";
/** Address added to blocklist */
export const TOPIC_BLOCKED = "blocked";
/** Jurisdiction blocked */
export const TOPIC_JUR_ADDED = "jur_add";
/** Jurisdiction unblocked */
export const TOPIC_JUR_REMOVED = "jur_rem";
/** Allowlist address added */
export const TOPIC_AL_ADDED = "al_add";
/** Allowlist address removed */
export const TOPIC_AL_REMOVED = "al_rem";
/** KYC record approved */
export const TOPIC_KYC_APPROVED = "kyc_apr";
/** KYC record revoked */
export const TOPIC_KYC_REVOKED = "kyc_rev";
/** Verifier added to KYC registry */
export const TOPIC_VERIFIER_ADDED = "vfy_add";
/** Verifier removed from KYC registry */
export const TOPIC_VERIFIER_REMOVED = "vfy_rem";
/** Carbon credit retired */
export const TOPIC_RETIRED = "retired";
/** Contract migrated to new version */
export const TOPIC_MIGRATED = "migrated";
/** Recovery config updated */
export const TOPIC_RECOVERY_CONFIGURED = "rcv_cfg";
/** Recovery proposed */
export const TOPIC_RECOVERY_PROPOSED = "rcv_prp";
/** Recovery approved by a member */
export const TOPIC_RECOVERY_APPROVED = "rcv_apr";
/** Recovery executed — new admin set */
export const TOPIC_RECOVERY_EXECUTED = "rcv_exe";
/** Recovery cancelled by admin */
export const TOPIC_RECOVERY_CANCELLED = "rcv_cnl";

// ── Payload type definitions ──────────────────────────────────────────────────
// These describe what the `data` field of each event contains after decoding.
// All amounts are i128 (represented as bigint in JS). Timestamps are u64 (bigint).

export interface TransferEventData {
  /** Sourced from topic[1] — not part of the on-chain data payload. */
  from: string;
  /** Sourced from topic[2] — not part of the on-chain data payload. */
  to: string;
  amount: bigint;
  timestamp: bigint;
}

export interface MintEventData {
  /** Sourced from topic[1] — not part of the on-chain data payload. */
  to: string;
  amount: bigint;
  timestamp: bigint;
}

export interface BurnEventData {
  /** Sourced from topic[1] — not part of the on-chain data payload. */
  from: string;
  amount: bigint;
  timestamp: bigint;
}

export interface ApproveEventData {
  /** Sourced from topic[1] — not part of the on-chain data payload. */
  from: string;
  /** Sourced from topic[2] — not part of the on-chain data payload. */
  spender: string;
  amount: bigint;
  expirationLedger: number;
}

export interface FreezeEventData {
  /** Sourced from topic[1] — not part of the on-chain data payload. */
  addr: string;
}

export interface AdminProposedEventData {
  newAdmin: string;
  /** Admin nonce consumed by this operation. */
  nonce: bigint;
}

export interface AdminSetEventData {
  oldAdmin: string;
  newAdmin: string;
}

export interface KycUpdatedEventData {
  newRegistry: string;
  nonce: bigint;
}

export interface CeUpdatedEventData {
  newEngine: string;
  nonce: bigint;
}

export interface RoleAssignedEventData {
  role: string;
  holder: string;
  nonce: bigint;
}

export interface RoleRevokedEventData {
  role: string;
  nonce: bigint;
}

export interface KycStaleEventData {
  /** Sourced from topic[1] — not part of the on-chain data payload. */
  addr: string;
  isActive: boolean;
  expiry: bigint;
}

export interface MigrationEventData {
  /** The new version string after the migration */
  newVersion: string;
}

export interface RecoveryApprovedEventData {
  approver: string;
  totalApprovals: number;
}

export interface RecoveryExecutedEventData {
  oldAdmin: string;
  newAdmin: string;
}
