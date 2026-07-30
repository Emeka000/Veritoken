import type { FieldSchema } from "./formSchema";
import {
  validateAdminAddress,
  validateKycRegistry,
  validateComplianceEngine,
  validateTokenName,
  validateTokenSymbol,
  validateIsin,
  validateIpfsHash,
  validateLegalEntity,
  validateGoverningLaw,
  validateVintageYear,
} from "./metadataValidation";

export type AssetType = "invoice" | "property" | "carbon";

export interface DeployPreset {
  label: string;
  wasm: string;
  assetType: string;
  description: string;
  requiredFields: string[];
  optionalFields: string[];
  /** Contract-driven form schema (issue #447) — the single source of truth for this preset's fields. */
  fields: FieldSchema[];
  /** Builds the deploy CLI command from the form's current values. */
  buildCommand: (values: Record<string, string>) => string;
}

const RWA_CORE_FIELDS: (nameLabel: string, namePlaceholder: string, symbolPlaceholder: string) => FieldSchema[] =
  (nameLabel, namePlaceholder, symbolPlaceholder) => [
    { key: "admin", label: "Admin address", kind: "address", required: true, placeholder: "G…", validate: validateAdminAddress },
    { key: "name", label: nameLabel, kind: "text", required: true, placeholder: namePlaceholder, validate: validateTokenName },
    { key: "symbol", label: "Token symbol", kind: "text", required: true, placeholder: symbolPlaceholder, validate: validateTokenSymbol },
    { key: "kyc_registry", label: "KYC registry address", kind: "contract-id", required: true, placeholder: "C…", validate: validateKycRegistry },
    { key: "compliance_engine", label: "Compliance engine address", kind: "contract-id", required: true, placeholder: "C…", validate: validateComplianceEngine },
  ];

const INVOICE_FIELDS: FieldSchema[] = [
  ...RWA_CORE_FIELDS("Token name", "Acme Invoice Token", "IVTK"),
  { key: "legal_entity", label: "Legal entity", kind: "text", placeholder: "Acme Corp LLC", validate: validateLegalEntity },
  { key: "governing_law", label: "Governing law", kind: "text", placeholder: "New York", validate: validateGoverningLaw },
  { key: "isin", label: "ISIN", kind: "text", placeholder: "US1234567890", validate: validateIsin },
  { key: "prospectus_hash", label: "Prospectus hash (IPFS)", kind: "text", placeholder: "Qm… or baf…", validate: validateIpfsHash },
];

const PROPERTY_FIELDS: FieldSchema[] = [
  ...RWA_CORE_FIELDS("Token name", "123 Main St Token", "PROP"),
  { key: "legal_entity", label: "Legal entity", kind: "text", placeholder: "Realty Partners LLC", validate: validateLegalEntity },
  { key: "governing_law", label: "Governing law", kind: "text", placeholder: "Delaware", validate: validateGoverningLaw },
  { key: "isin", label: "ISIN", kind: "text", placeholder: "US0000000000", validate: validateIsin },
  { key: "prospectus_hash", label: "Title hash (IPFS)", kind: "text", placeholder: "Qm… or baf…", validate: validateIpfsHash },
];

const CARBON_FIELDS: FieldSchema[] = [
  ...RWA_CORE_FIELDS("Token name", "Acme Carbon Credit", "ACC"),
  { key: "vintage_year", label: "Vintage year", kind: "text", placeholder: "2024", validate: validateVintageYear },
  { key: "methodology", label: "Methodology", kind: "text", placeholder: "VCS VM0010" },
  { key: "registry", label: "Registry", kind: "text", placeholder: "Verra" },
  { key: "project_id", label: "Project ID", kind: "text", placeholder: "VCS-1234" },
];

export const DEPLOY_PRESETS: Record<AssetType, DeployPreset> = {
  invoice: {
    label: "Invoice Token",
    wasm: "rwa_token.wasm",
    assetType: "invoice",
    description: "Tokenized invoice backed by a receivable. Supports face value, currency, and IPFS document hash.",
    requiredFields: ["admin", "name", "symbol", "kyc_registry", "compliance_engine"],
    optionalFields: ["legal_entity", "governing_law", "isin", "prospectus_hash"],
    fields: INVOICE_FIELDS,
    buildCommand: (values) => buildRwaDeployCommand(values as unknown as RwaDeployParams, DEPLOY_PRESETS.invoice),
  },
  property: {
    label: "Property Token",
    wasm: "rwa_token.wasm",
    assetType: "property",
    description: "Tokenized real-estate asset. Supports legal name, jurisdiction, and IPFS title hash.",
    requiredFields: ["admin", "name", "symbol", "kyc_registry", "compliance_engine"],
    optionalFields: ["legal_entity", "governing_law", "isin", "prospectus_hash"],
    fields: PROPERTY_FIELDS,
    buildCommand: (values) => buildRwaDeployCommand(values as unknown as RwaDeployParams, DEPLOY_PRESETS.property),
  },
  carbon: {
    label: "Carbon Credit Token",
    wasm: "carbon_credit_token.wasm",
    assetType: "carbon",
    description: "Tokenized voluntary carbon credit. Supports vintage year, methodology, registry, and project ID.",
    requiredFields: ["admin", "name", "symbol", "kyc_registry", "compliance_engine"],
    optionalFields: ["vintage_year", "methodology", "registry", "project_id"],
    fields: CARBON_FIELDS,
    buildCommand: (values) => buildCarbonDeployCommand(values as unknown as CarbonDeployParams),
  },
};

export interface RwaDeployParams {
  admin: string;
  name: string;
  symbol: string;
  kyc_registry: string;
  compliance_engine: string;
  legal_entity?: string;
  governing_law?: string;
  isin?: string;
  prospectus_hash?: string;
}

export interface CarbonDeployParams {
  admin: string;
  name: string;
  symbol: string;
  kyc_registry: string;
  compliance_engine: string;
  vintage_year?: string;
  methodology?: string;
  registry?: string;
  project_id?: string;
}

function flagArg(name: string, value?: string): string {
  return value?.trim() ? ` \\\n  --${name} "${value.trim()}"` : "";
}

/** Generate the Stellar CLI deploy command for an invoice or property token. */
export function buildRwaDeployCommand(params: RwaDeployParams, preset: DeployPreset): string {
  const metaPairs: string[] = [];
  if (params.legal_entity?.trim()) metaPairs.push(`legal_entity="${params.legal_entity.trim()}"`);
  if (params.governing_law?.trim()) metaPairs.push(`governing_law="${params.governing_law.trim()}"`);
  if (params.isin?.trim()) metaPairs.push(`isin="${params.isin.trim()}"`);
  if (params.prospectus_hash?.trim()) metaPairs.push(`prospectus_hash="${params.prospectus_hash.trim()}"`);

  let cmd =
    `stellar contract deploy \\\n` +
    `  --wasm ${preset.wasm} \\\n` +
    `  --source <YOUR_KEYPAIR> \\\n` +
    `  --network testnet \\\n` +
    `  -- \\\n` +
    `  --admin "${params.admin}" \\\n` +
    `  --decimal 7 \\\n` +
    `  --name "${params.name}" \\\n` +
    `  --symbol "${params.symbol}" \\\n` +
    `  --asset_type "${preset.assetType}" \\\n` +
    `  --kyc_registry "${params.kyc_registry}" \\\n` +
    `  --compliance_engine "${params.compliance_engine}"`;

  if (metaPairs.length > 0) {
    cmd += ` \\\n  --compliance_metadata '{${metaPairs.join(", ")}}'`;
  }
  return cmd;
}

/** Generate the Stellar CLI deploy command for a carbon credit token. */
export function buildCarbonDeployCommand(params: CarbonDeployParams): string {
  return (
    `stellar contract deploy \\\n` +
    `  --wasm carbon_credit_token.wasm \\\n` +
    `  --source <YOUR_KEYPAIR> \\\n` +
    `  --network testnet \\\n` +
    `  -- \\\n` +
    `  --admin "${params.admin}" \\\n` +
    `  --decimal 7 \\\n` +
    `  --name "${params.name}" \\\n` +
    `  --symbol "${params.symbol}" \\\n` +
    `  --kyc_registry "${params.kyc_registry}" \\\n` +
    `  --compliance_engine "${params.compliance_engine}"` +
    flagArg("vintage_year", params.vintage_year) +
    flagArg("methodology", params.methodology) +
    flagArg("registry", params.registry) +
    flagArg("project_id", params.project_id)
  );
}

/** Returns true if all required fields for the given preset are filled. */
export function isDeployReady(params: Record<string, string>, preset: DeployPreset): boolean {
  return preset.requiredFields.every((f) => params[f]?.trim());
}
