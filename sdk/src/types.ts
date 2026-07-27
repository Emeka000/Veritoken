export type KycStatus = "Pending" | "Approved" | "Rejected" | "Revoked";

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
}

export interface RetirementReceipt {
  retiree: string;
  amount: bigint;
  timestamp: bigint;
  beneficiary: string;
  retirement_reason: string;
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

export type Network = "testnet" | "mainnet";
