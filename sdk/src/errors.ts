/**
 * Typed contract error model shared across SDK and frontend.
 *
 * Every Soroban contract emits numeric #[contracterror] discriminants.
 * This module provides:
 * - Structured ContractError with code, name, and message
 * - Lookup tables for all six Veritoken contracts
 * - Error parsing from raw Soroban error strings
 */

export interface ContractError {
  code: number;
  name: string;
  message: string;
}

export type ContractName =
  | "rwa"
  | "carbon"
  | "invoice"
  | "property"
  | "kyc"
  | "compliance";

// ── RWA Token errors ──────────────────────────────────────────────────────────
const RWA_ERRORS: ContractError[] = [
  { code: 1, name: "NotInitialized", message: "Contract has not been initialized" },
  { code: 2, name: "AlreadyInitialized", message: "Contract is already initialized" },
  { code: 3, name: "Unauthorized", message: "Caller is not authorized to perform this action" },
  { code: 4, name: "InsufficientBalance", message: "Insufficient token balance" },
  { code: 5, name: "InvalidAmount", message: "Amount must be greater than zero" },
  { code: 6, name: "KycNotApproved", message: "Address has not passed KYC verification" },
  { code: 7, name: "CompliancePaused", message: "Compliance engine is currently paused" },
  { code: 8, name: "Blocklisted", message: "Address is on the compliance blocklist" },
  { code: 9, name: "TransferNotAllowed", message: "Transfer is not permitted under current compliance rules" },
  { code: 10, name: "MaxHoldersReached", message: "Maximum number of token holders has been reached" },
  { code: 11, name: "InvalidAssetType", message: "Unsupported or invalid asset type" },
  { code: 12, name: "InvalidMetadata", message: "One or more metadata fields are invalid" },
  { code: 13, name: "NoPendingAdmin", message: "No pending admin transfer is in progress" },
  { code: 14, name: "AlreadyRetired", message: "Tokens have already been retired" },
  { code: 15, name: "RecoveryNotConfigured", message: "Recovery address has not been configured" },
  { code: 16, name: "ExceedsMaxSupply", message: "Mint would exceed the maximum token supply" },
];

// ── Carbon Credit Token errors ────────────────────────────────────────────────
const CARBON_ERRORS: ContractError[] = [
  { code: 1, name: "NotInitialized", message: "Contract has not been initialized" },
  { code: 2, name: "AlreadyInitialized", message: "Contract is already initialized" },
  { code: 3, name: "Unauthorized", message: "Caller is not authorized to perform this action" },
  { code: 4, name: "InsufficientBalance", message: "Insufficient token balance for retirement" },
  { code: 5, name: "KycNotApproved", message: "Address has not passed KYC verification" },
  { code: 6, name: "CompliancePaused", message: "Compliance engine is currently paused" },
  { code: 7, name: "Blocklisted", message: "Address is on the compliance blocklist" },
  { code: 8, name: "TransferNotAllowed", message: "Transfer is not permitted under current compliance rules" },
  { code: 9, name: "MaxHoldersReached", message: "Maximum number of token holders has been reached" },
  { code: 10, name: "InvalidAmount", message: "Amount must be greater than zero" },
  { code: 11, name: "InvalidMetadata", message: "One or more metadata fields are invalid" },
  { code: 12, name: "NoPendingAdmin", message: "No pending admin transfer is in progress" },
];

// ── Invoice Token errors ──────────────────────────────────────────────────────
const INVOICE_ERRORS: ContractError[] = [
  { code: 1, name: "NotInitialized", message: "Contract has not been initialized" },
  { code: 2, name: "AlreadyInitialized", message: "Contract is already initialized" },
  { code: 3, name: "Unauthorized", message: "Caller is not authorized to perform this action" },
  { code: 4, name: "KycNotApproved", message: "Address has not passed KYC verification" },
  { code: 5, name: "CompliancePaused", message: "Compliance engine is currently paused" },
  { code: 6, name: "Blocklisted", message: "Address is on the compliance blocklist" },
  { code: 7, name: "TransferNotAllowed", message: "Transfer is not permitted under current compliance rules" },
  { code: 8, name: "MaxHoldersReached", message: "Maximum number of token holders has been reached" },
  { code: 9, name: "InsufficientBalance", message: "Insufficient token balance" },
  { code: 10, name: "InvalidAmount", message: "Amount must be greater than zero" },
  { code: 11, name: "InvoiceNotFound", message: "Invoice record not found" },
  { code: 12, name: "InvoiceAlreadySettled", message: "Invoice has already been settled" },
  { code: 13, name: "NoPendingAdmin", message: "No pending admin transfer is in progress" },
  { code: 20, name: "InvalidMetadata", message: "One or more invoice metadata fields are invalid" },
];

// ── Property Token errors ─────────────────────────────────────────────────────
const PROPERTY_ERRORS: ContractError[] = [
  { code: 1, name: "NotInitialized", message: "Contract has not been initialized" },
  { code: 2, name: "AlreadyInitialized", message: "Contract is already initialized" },
  { code: 3, name: "Unauthorized", message: "Caller is not authorized to perform this action" },
  { code: 4, name: "KycNotApproved", message: "Address has not passed KYC verification" },
  { code: 5, name: "KycTierInsufficient", message: "KYC tier is too low for this operation" },
  { code: 6, name: "CompliancePaused", message: "Compliance engine is currently paused" },
  { code: 7, name: "Blocklisted", message: "Address is on the compliance blocklist" },
  { code: 8, name: "TransferNotAllowed", message: "Transfer is not permitted under current compliance rules" },
  { code: 9, name: "MaxHoldersReached", message: "Maximum number of token holders has been reached" },
  { code: 10, name: "InvalidMetadata", message: "One or more property metadata fields are invalid" },
  { code: 11, name: "NoPendingAdmin", message: "No pending admin transfer is in progress" },
  { code: 12, name: "InvalidAmount", message: "Amount must be greater than zero" },
];

// ── KYC Registry errors ───────────────────────────────────────────────────────
const KYC_ERRORS: ContractError[] = [
  { code: 1, name: "NotInitialized", message: "KYC registry has not been initialized" },
  { code: 2, name: "AlreadyInitialized", message: "KYC registry is already initialized" },
  { code: 3, name: "Unauthorized", message: "Caller is not authorized to perform this action" },
  { code: 4, name: "NoPendingAdmin", message: "No pending admin transfer is in progress" },
];

// ── Compliance Engine errors ──────────────────────────────────────────────────
const COMPLIANCE_ERRORS: ContractError[] = [
  { code: 1, name: "NotInitialized", message: "Compliance engine has not been initialized" },
  { code: 2, name: "AlreadyInitialized", message: "Compliance engine is already initialized" },
  { code: 3, name: "Unauthorized", message: "Caller is not authorized to perform this action" },
  { code: 4, name: "RuleChangeTooSoon", message: "Compliance rule change is still in the timelock period" },
  { code: 5, name: "NoPendingAdmin", message: "No pending admin transfer is in progress" },
];

// ── API ───────────────────────────────────────────────────────────────────────

const ERROR_MAPS: Record<ContractName, Map<number, ContractError>> = {
  rwa: new Map(RWA_ERRORS.map((e) => [e.code, e])),
  carbon: new Map(CARBON_ERRORS.map((e) => [e.code, e])),
  invoice: new Map(INVOICE_ERRORS.map((e) => [e.code, e])),
  property: new Map(PROPERTY_ERRORS.map((e) => [e.code, e])),
  kyc: new Map(KYC_ERRORS.map((e) => [e.code, e])),
  compliance: new Map(COMPLIANCE_ERRORS.map((e) => [e.code, e])),
};

/**
 * Look up a human-readable error by code.
 * Returns null if the code is unrecognised for the given contract.
 */
export function lookupError(
  contract: ContractName,
  code: number,
): ContractError | null {
  return ERROR_MAPS[contract]?.get(code) ?? null;
}

/**
 * Parse a raw Soroban error string (e.g. "Error(Contract, #7)") and return
 * the corresponding ContractError, or null if unparseable or unknown.
 */
export function parseContractError(
  contract: ContractName,
  rawError: string,
): ContractError | null {
  const match = rawError.match(/Error\(Contract,\s*#(\d+)\)/);
  if (!match) return null;
  return lookupError(contract, parseInt(match[1], 10));
}

/**
 * Convert any thrown error from a contract call into a display string.
 * Tries to parse Soroban contract error codes first; falls back to the raw message.
 */
export function formatContractError(
  contract: ContractName,
  err: unknown,
): string {
  const raw = err instanceof Error ? err.message : String(err);
  const parsed = parseContractError(contract, raw);
  if (parsed) return `${parsed.message} (${parsed.name} #${parsed.code})`;
  return raw;
}
