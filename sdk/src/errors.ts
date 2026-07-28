export interface ContractError { code: number; name: string; message: string; }
export type ContractName = "rwa" | "carbon" | "invoice" | "property" | "kyc" | "compliance";

const RWA: ContractError[] = [
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
const CARBON: ContractError[] = [
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
const INVOICE: ContractError[] = [
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
const PROPERTY: ContractError[] = [
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
const KYC: ContractError[] = [
  { code: 1, name: "NotInitialized", message: "KYC registry has not been initialized" },
  { code: 2, name: "AlreadyInitialized", message: "KYC registry is already initialized" },
  { code: 3, name: "Unauthorized", message: "Caller is not authorized to perform this action" },
  { code: 4, name: "NoPendingAdmin", message: "No pending admin transfer is in progress" },
];
const COMPLIANCE: ContractError[] = [
  { code: 1, name: "NotInitialized", message: "Compliance engine has not been initialized" },
  { code: 2, name: "AlreadyInitialized", message: "Compliance engine is already initialized" },
  { code: 3, name: "Unauthorized", message: "Caller is not authorized to perform this action" },
  { code: 4, name: "RuleChangeTooSoon", message: "Compliance rule change is still in the timelock period" },
  { code: 5, name: "NoPendingAdmin", message: "No pending admin transfer is in progress" },
];

const MAPS: Record<ContractName, Map<number, ContractError>> = {
  rwa: new Map(RWA.map((e) => [e.code, e])),
  carbon: new Map(CARBON.map((e) => [e.code, e])),
  invoice: new Map(INVOICE.map((e) => [e.code, e])),
  property: new Map(PROPERTY.map((e) => [e.code, e])),
  kyc: new Map(KYC.map((e) => [e.code, e])),
  compliance: new Map(COMPLIANCE.map((e) => [e.code, e])),
};

export function lookupError(contract: ContractName, code: number): ContractError | null {
  return MAPS[contract]?.get(code) ?? null;
}

export function parseContractError(contract: ContractName, raw: string): ContractError | null {
  const m = raw.match(/Error\(Contract,\s*#(\d+)\)/);
  if (!m) return null;
  return lookupError(contract, parseInt(m[1], 10));
}

export function formatContractError(contract: ContractName, err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const p = parseContractError(contract, raw);
  if (p) return `${p.message} (${p.name} #${p.code})`;
  return raw;
}
