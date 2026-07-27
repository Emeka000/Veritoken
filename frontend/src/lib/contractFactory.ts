export type AssetType = "invoice" | "property" | "carbon";

export interface DeployPreset {
  label: string;
  wasm: string;
  assetType: string;
  description: string;
  requiredFields: string[];
  optionalFields: string[];
}

export const DEPLOY_PRESETS: Record<AssetType, DeployPreset> = {
  invoice: {
    label: "Invoice Token",
    wasm: "rwa_token.wasm",
    assetType: "invoice",
    description: "Tokenized invoice backed by a receivable. Supports face value, currency, and IPFS document hash.",
    requiredFields: ["admin", "name", "symbol", "kyc_registry", "compliance_engine"],
    optionalFields: ["legal_entity", "governing_law", "isin", "prospectus_hash"],
  },
  property: {
    label: "Property Token",
    wasm: "rwa_token.wasm",
    assetType: "property",
    description: "Tokenized real-estate asset. Supports legal name, jurisdiction, and IPFS title hash.",
    requiredFields: ["admin", "name", "symbol", "kyc_registry", "compliance_engine"],
    optionalFields: ["legal_entity", "governing_law", "isin", "prospectus_hash"],
  },
  carbon: {
    label: "Carbon Credit Token",
    wasm: "carbon_credit_token.wasm",
    assetType: "carbon",
    description: "Tokenized voluntary carbon credit. Supports vintage year, methodology, registry, and project ID.",
    requiredFields: ["admin", "name", "symbol", "kyc_registry", "compliance_engine"],
    optionalFields: ["vintage_year", "methodology", "registry", "project_id"],
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
