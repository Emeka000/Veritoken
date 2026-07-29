export type AssetType = "invoice" | "property" | "carbon_credit";

// Contract-facing domain values are owned by the SDK so browser and Node
// consumers decode u64/i128 fields to the same native `bigint` types.
export type {
  KycStatus,
  KycRecord,
  InvoiceMeta,
  PropertyMeta,
  ProjectMeta,
  RetirementReceipt,
  ComplianceRules,
  TokenExportMetadata,
  TierPolicy,
  RiskConfig,
  KycStatusMirror,
  KycSyncStatus,
} from "@veritoken/sdk";

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
