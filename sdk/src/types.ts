export type KycStatus = "Pending" | "Approved" | "Rejected" | "Revoked";

/**
 * Mirror of the compliance engine's `DenyReason` enum — the reason a
 * transfer failed `evaluate_transfer`. All variants are fieldless, so (like
 * `KycStatus`) each decodes to a plain string.
 */
export type DenyReason =
  | "CompliancePaused"
  | "FromBlocklisted"
  | "ToBlocklisted"
  | "FromKycMissing"
  | "ToKycMissing"
  | "FromKycExpired"
  | "ToKycExpired"
  | "FromKycRevoked"
  | "ToKycRevoked"
  | "FromKycRejected"
  | "ToKycRejected"
  | "FromKycPending"
  | "ToKycPending"
  | "FromJurisdictionBlocked"
  | "ToJurisdictionBlocked"
  | "SameJurisdictionRequired"
  | "AmountExceeded"
  | "HoldingPeriodNotMet"
  | "MaxHoldersReached"
  | "RecipientHoldingPeriodExceeded"
  | "TierPolicyBlocked"
  | "TierFromBelowMin"
  | "TierToBelowMin"
  | "TierAmountExceeded"
  | "RiskScoreTooHigh";

/**
 * Decoded result of `ComplianceEngineClient.evaluateTransfer()` — the same
 * check the compliance engine runs internally before a transfer executes,
 * exposed as a read call so callers can pre-flight a transfer and explain
 * *why* it would be denied instead of just getting a reverted transaction.
 */
export type TransferDecision =
  | { allowed: true }
  | { allowed: false; reason: DenyReason };

export interface KycRecord {
  status: KycStatus;
  verifier: string;
  tier: number;
  expiry: bigint;
  jurisdiction: string;
}

export interface InvoiceMeta {
  invoice_id: string;
  issuer: string;
  debtor: string;
  face_value_usd: bigint;
  discount_rate_bps: number;
  due_date: bigint;
  currency: string;
  ipfs_doc_hash: string;
  transfer_fee_bps: number;
  fee_recipient: string | null;
  notification_webhook: string;
}

export interface PropertyMeta {
  property_id: string;
  legal_name: string;
  jurisdiction: string;
  address: string;
  total_valuation_usd: bigint;
  total_shares: bigint;
  property_type: string;
  ipfs_title_hash: string;
  kyc_tier_required: number;
}

export interface ProjectMeta {
  project_id: string;
  standard: string;
  vintage_year: number;
  project_name: string;
  project_type: string;
  country: string;
  verifier: string;
  ipfs_cert_hash: string;
  registry_url: string;
  registry_project_id: string;
}

export interface RetirementReceipt {
  retiree: string;
  amount: bigint;
  timestamp: bigint;
  beneficiary: string;
  retirement_reason: string;
  beneficiary_address: string | null;
}

export interface ComplianceRules {
  max_transfer_amount: bigint;
  min_holding_period: bigint;
  max_holders: number;
  require_same_jurisdiction: boolean;
  paused: boolean;
  allowlist_mode: boolean;
  max_holding_period: bigint;
}

/**
 * A point-in-time view of an address's holding-period ("lockup") status,
 * returned by `ComplianceEngineClient.getLockupStatus()`.
 *
 * All `bigint` timestamp/duration fields use `0n` to mean "not applicable" —
 * mirroring the `ComplianceRules` convention where `0` means a rule is
 * disabled — so callers never have to null-check.
 */
export interface LockupStatus {
  /** Whether the address is a currently registered holder (has a balance). */
  is_holder: boolean;
  /** Unix timestamp the address became a holder, or `0n` if not a holder. */
  holder_since: bigint;
  /** The active `min_holding_period` rule, in seconds (`0n` = disabled). */
  min_holding_period: bigint;
  /** The active `max_holding_period` rule, in seconds (`0n` = disabled). */
  max_holding_period: bigint;
  /**
   * Unix timestamp the address may transfer out, or `0n` if not locked by a
   * minimum holding period.
   */
  min_release_at: bigint;
  /**
   * Unix timestamp by which the address must transfer out, or `0n` if no
   * maximum holding period applies.
   */
  max_release_at: bigint;
  /** `true` if the address is currently blocked from transferring out. */
  locked: boolean;
  /** Seconds remaining until `min_release_at`, or `0n` if not locked. */
  seconds_until_unlock: bigint;
}

/**
 * Canonical export snapshot returned by `RwaTokenClient.getTokenExport()`.
 *
 * This is the single source of truth for external integrations — explorers,
 * dashboards, metadata indexers.  All optional fields are `null` when unset.
 */
export interface TokenExportMetadata {
  // Core token fields
  name: string;
  symbol: string;
  decimals: number;
  asset_type: string;
  total_supply: bigint;
  max_supply: bigint;
  contract_version: string;
  // Linked contract addresses
  kyc_registry: string;
  compliance_engine: string;
  // Compliance / legal metadata
  legal_entity: string | null;
  governing_law: string | null;
  isin: string | null;
  prospectus_hash: string | null;
  /** Optional URI pointing to an off-chain metadata document. */
  external_uri: string | null;
}

/**
 * A tier-to-tier transfer policy entry in the compliance engine.
 *
 * Use `u32.MAX` (4294967295) as a wildcard for `from_tier` or `to_tier`
 * to match any tier value.  Exact matches take precedence over wildcards.
 */
export interface TierPolicy {
  /** When true, all transfers matching this tier pair are unconditionally blocked. */
  blocked: boolean;
  /**
   * Per-tier-pair maximum single-transfer amount.  0 = inherit global limit.
   * The more restrictive of global and tier-pair limits applies.
   */
  max_transfer_amount: bigint;
  /** Minimum required KYC tier for the sender. */
  min_from_tier: number;
  /** Minimum required KYC tier for the recipient. */
  min_to_tier: number;
}

/**
 * Configuration for the jurisdiction-based risk scoring system.
 *
 * Risk scores are integers in [0, 100].
 * - `max_score = 0` disables risk scoring entirely.
 * - `default_score` is applied to jurisdictions without an explicit entry.
 *
 * ## Score conventions
 * - 0     No risk; always allowed
 * - 1–49  Low-to-medium risk
 * - 50–74 Elevated risk (FATF grey-list range)
 * - 75–99 High risk (sanctioned / scrutinised)
 * - 100   Blocked (equivalent to jurisdiction blocklist)
 */
export interface RiskConfig {
  /** Maximum score allowed for either party's jurisdiction. 0 = inactive. */
  max_score: number;
  /** Score applied to jurisdictions with no explicit entry. Range: 0–100. */
  default_score: number;
}

/**
 * Mirror of the KYC registry's KycStatus enum as seen from the token contract.
 */
export type KycStatusMirror = "Pending" | "Approved" | "Rejected" | "Revoked";

/**
 * Snapshot of an address's live KYC state returned by `check_kyc_status`.
 *
 * Gives frontends and external tools a single call to determine whether
 * an address can participate in token operations right now.
 *
 * ## Key fields
 * - `is_active`: `true` only when `status === "Approved"` AND not expired
 * - `expiry`: `0n` means no expiry; otherwise a Unix timestamp (seconds)
 * - `checked_at`: Ledger timestamp at the moment of this snapshot
 */
export interface KycSyncStatus {
  status: KycStatusMirror;
  is_active: boolean;
  expiry: bigint;
  tier: number;
  jurisdiction: string;
  checked_at: bigint;
}

/** The four networks the SDK ships built-in RPC/passphrase defaults for. */
export type KnownNetwork = "testnet" | "mainnet" | "futurenet" | "standalone";

/**
 * A network name: one of the built-in {@link KnownNetwork}s, or any other
 * string identifying a custom network (see `resolveNetworkConfig` in
 * network.ts — custom names require an explicit `rpcUrl` and
 * `networkPassphrase` since there's no built-in default to fall back to).
 * The `string & {}` intersection keeps editor autocomplete suggesting the
 * known values without narrowing the type to a closed union.
 */
export type Network = KnownNetwork | (string & {});
