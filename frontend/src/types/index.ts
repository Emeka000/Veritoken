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
