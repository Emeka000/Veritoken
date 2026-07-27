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
}

export interface WalletState {
  address: string | null;
  network: string;
  connected: boolean;
}
