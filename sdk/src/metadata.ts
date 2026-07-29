/**
 * Contract metadata discovery (#452).
 *
 * Integrators need a consistent, discoverable way to learn which contracts
 * are deployed in the current environment and what role each one plays,
 * without manually cross-referencing `deployment/config.*.json` or guessing
 * from env var names. `CONTRACT_METADATA` mirrors the `declared_metadata`
 * block already recorded for each contract in the deployment configs, and
 * `discoverContracts` merges it with whatever contract IDs the caller has
 * configured (typically `CONTRACT_IDS` from the host app's env) into one
 * structured payload the frontend dashboard (or any external consumer) can
 * render directly.
 *
 * @example
 * ```ts
 * const report = discoverContracts(
 *   { kycRegistry: "C...", complianceEngine: "C..." },
 *   "testnet",
 * );
 * report.contracts.find((c) => c.key === "kycRegistry")?.role; // "identity_registry"
 * ```
 */

import type { ClientKey } from "./factory.js";
import type { Network } from "./types.js";

// ── Static metadata table ───────────────────────────────────────────────────

export interface ContractMetadata {
  /** Cargo package name, matching `declared_metadata.package` in deployment configs. */
  package: string;
  /** Short role identifier, matching `declared_metadata.role` in deployment configs. */
  role: string;
}

/**
 * Package/role metadata for every contract the SDK knows how to build a
 * client for (see `ClientKey` in factory.ts). Kept in sync with the
 * `declared_metadata` blocks in `deployment/config.testnet.json` and
 * `deployment/config.mainnet.example.json`.
 */
export const CONTRACT_METADATA: Record<ClientKey, ContractMetadata> = {
  kycRegistry: { package: "kyc-registry", role: "identity_registry" },
  complianceEngine: { package: "compliance-engine", role: "transfer_policy" },
  invoiceToken: { package: "invoice-token", role: "invoice_asset" },
  propertyToken: { package: "property-token", role: "property_asset" },
  carbonToken: { package: "carbon-credit-token", role: "carbon_asset" },
  rwaToken: { package: "rwa-token", role: "generic_rwa_asset" },
};

// ── Discovery ────────────────────────────────────────────────────────────────

export interface ContractMetadataEntry extends ContractMetadata {
  key: ClientKey;
  /** The deployed contract ID for this environment, or null when not configured. */
  contractId: string | null;
  /** True when `contractId` is present (non-empty). */
  configured: boolean;
}

export interface ContractDiscoveryReport {
  network: Network | "unknown";
  /** ISO timestamp supplied by the caller — this module performs no I/O of its own. */
  generatedAt: string;
  contracts: ContractMetadataEntry[];
}

/**
 * Build a structured metadata report for the current environment from a map
 * of contract IDs (e.g. `CONTRACT_IDS` in a host app). Pure function — no
 * network calls, no filesystem access; contracts without a configured ID are
 * still listed with `configured: false` so consumers can render "not yet
 * deployed" states.
 *
 * `generatedAt` defaults to the current time via `Date.now()`, but callers
 * that need determinism (tests, snapshot pipelines) can pass an explicit
 * value.
 */
export function discoverContracts(
  contractIds: Partial<Record<ClientKey, string>>,
  network: Network | "unknown" = "unknown",
  generatedAt: string = new Date().toISOString(),
): ContractDiscoveryReport {
  const contracts: ContractMetadataEntry[] = (Object.keys(CONTRACT_METADATA) as ClientKey[]).map((key) => {
    const contractId = contractIds[key];
    return {
      key,
      ...CONTRACT_METADATA[key],
      contractId: contractId ? contractId : null,
      configured: Boolean(contractId),
    };
  });

  return { network, generatedAt, contracts };
}
