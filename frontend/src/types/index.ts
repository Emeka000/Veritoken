export type AssetType = "invoice" | "property" | "carbon_credit";

export type KycStatus = "Pending" | "Approved" | "Rejected" | "Revoked";

export interface KycRecord {
  status: KycStatus;
  verifier: string;
  tier: number;
  expiry: number;
  jurisdiction: string;
}

export interface InvoiceMeta {
  invoice_id: string;
  issuer: string;
  debtor: string;
  face_value_usd: bigint;
  discount_rate_bps: number;
  due_date: number;
  currency: string;
  ipfs_doc_hash: string;
  /** Optional HTTPS webhook URL for off-chain notification services. */
  notification_webhook: string;
  /** Fee in basis points deducted from the sender on each transfer (0 = no fee). */
  transfer_fee_bps: number;
  /** Address that receives collected transfer fees. Null when no fee is configured. */
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
  timestamp: number;
  beneficiary: string;
  retirement_reason: string;
}

/** One recorded entry in the per-invoice state transition journal. */
export interface JournalEntry {
  from_status: number;
  to_status: number;
  ledger: number;
  timestamp: number;
}

/** One dividend deposit event recorded by the property contract. */
export interface DividendEvent {
  amount: bigint;
  timestamp: number;
  running_total_dps: bigint;
  /** 0 = Rent, 1 = Capital, 2 = Other */
  distribution_type: number;
}

/** Per-holder dividend summary returned by get_dividend_summary. */
export interface DividendSummary {
  holder: string;
  shares: bigint;
  pending_stroops: bigint;
  claimed_dps: bigint;
}

/** Result of verify_receipt on the carbon contract. */
export interface ReceiptVerification {
  index: number;
  valid: boolean;
  retiree: string;
  amount: bigint;
  timestamp: number;
  project_id: string;
  /** Computed serial: project_id + "-" + index */
  serial: string;
}

export interface ContractEvent {
  id?: string;
  type: string;
  amount: string;
  counterparty: string;
  timestamp: string;
  contractId?: string;
  ledger?: number;
  txHash?: string;
  pagingToken?: string;
  topics?: string[];
  args?: unknown[];
  value?: unknown;
  inSuccessfulContractCall?: boolean;
}

export interface ComplianceRules {
  max_transfer_amount: bigint;
  min_holding_period: number;
  max_holders: number;
  require_same_jurisdiction: boolean;
  paused: boolean;
  allowlist_mode: boolean;
  max_holding_period: number;
}

/**
 * Canonical metadata export snapshot returned by `get_token_export`.
 *
 * This is the primary integration point for blockchain explorers, dashboards,
 * and metadata APIs. All optional fields are null when unset on-chain.
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
  /** Optional URI pointing to an off-chain extended metadata document. */
  external_uri: string | null;
}

/**
 * A tier-to-tier transfer policy entry in the compliance engine.
 *
 * Use 4294967295 (0xFFFFFFFF) as a wildcard for fromTier or toTier.
 * Exact matches take precedence over wildcards.
 *
 * KYC tier conventions: 0 = Basic, 1 = Accredited, 2 = Institutional.
 */
export interface TierPolicy {
  /** When true, all transfers matching this tier pair are unconditionally blocked. */
  blocked: boolean;
  /**
   * Per-tier-pair maximum single-transfer amount. 0 = inherit global limit.
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
 * - `max_score = 0` disables risk scoring entirely.
 * - `default_score` is used for jurisdictions with no explicit entry.
 *
 * Score conventions: 0 = no risk, 100 = fully blocked.
 */
export interface RiskConfig {
  /** Maximum allowed risk score for either party. 0 = inactive. */
  max_score: number;
  /** Fallback score for jurisdictions with no explicit entry. Range: 0–100. */
  default_score: number;
}

/**
 * Mirror of the on-chain KycStatus enum as returned by check_kyc_status.
 */
export type KycStatusMirror = "Pending" | "Approved" | "Rejected" | "Revoked";

/**
 * Live KYC state snapshot returned by `check_kyc_status` on the token contract.
 *
 * - `is_active`: true only when Approved AND not expired
 * - `expiry`: 0 = no expiry; otherwise Unix timestamp in seconds
 * - `checked_at`: Ledger timestamp when the snapshot was taken
 */
export interface KycSyncStatus {
  status: KycStatusMirror;
  is_active: boolean;
  expiry: bigint;
  tier: number;
  jurisdiction: string;
  checked_at: bigint;
}

export interface WalletState {
  address: string | null;
  network: string;
  connected: boolean;
}

/** Attestation types supported for off-chain compliance references (#370). */
export type AttestationType = "Legal" | "KYC" | "Compliance" | "AML" | "Accreditation" | "Other";

/**
 * Off-chain attestation record.  The `reference_url` must point to a
 * verifiable document (https:// or ipfs://).
 */
export interface AttestationRecord {
  /** Unique identifier for this attestation (client-generated UUID or hash). */
  id: string;
  /** Stellar address of the entity being attested. */
  subject: string;
  /** Category of the attestation. */
  attestation_type: AttestationType;
  /**
   * External reference to the attestation document.
   * Must start with `https://` or `ipfs://`.
   */
  reference_url: string;
  /** Issuer's Stellar address or well-known DID. */
  issuer: string;
  /** Unix timestamp when the attestation was issued. */
  issued_at: number;
  /** Optional human-readable notes. */
  notes?: string;
}
