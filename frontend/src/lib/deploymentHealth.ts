/**
 * Deployment health checks and diagnostics.
 *
 * Issue #423: gives operators a structured view of which contracts are live,
 * whether their IDs are well-formed, and what state they hold post-deploy.
 * Surfaces actionable diagnostics instead of raw RPC errors so rollback
 * decisions can be made quickly during live operations.
 *
 * Usage:
 *   import { deploymentHealth } from "./deploymentHealth";
 *   const report = await deploymentHealth.fullReport();
 *   if (!report.healthy) console.error(report.diagnostics);
 */

import { CONTRACT_IDS, isValidContractId } from "./stellar";
import { contracts } from "./contracts/index";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ContractKey = keyof typeof CONTRACT_IDS;

export type HealthStatus = "ok" | "degraded" | "unreachable" | "misconfigured";

export interface ContractHealthEntry {
  key: ContractKey;
  contractId: string;
  status: HealthStatus;
  /** Human-readable description of any problem found. */
  message: string;
  /** Round-trip latency in milliseconds, or null when the call failed. */
  latencyMs: number | null;
  checkedAt: string;
}

export interface DeploymentHealthReport {
  /** True only when every configured contract is reachable and responsive. */
  healthy: boolean;
  /** Summary status across all contracts. */
  overallStatus: HealthStatus;
  entries: ContractHealthEntry[];
  /** Flat list of actionable diagnostic messages for operator tooling. */
  diagnostics: string[];
  generatedAt: string;
}

// ── Per-contract probe functions ──────────────────────────────────────────────

/**
 * Each probe issues the cheapest possible read to confirm a contract is live.
 * Returns latency on success, throws on failure.
 */
const PROBES: Record<ContractKey, () => Promise<void>> = {
  kycRegistry: async () => { await contracts.kyc.verifierCount(); },
  complianceEngine: async () => { await contracts.compliance.getRules(); },
  invoiceToken: async () => { await contracts.invoice.decimals(); },
  propertyToken: async () => { await contracts.property.decimals(); },
  carbonToken: async () => { await contracts.carbon.decimals(); },
  rwaToken: async () => { await contracts.rwa.assetType(); },
};

// ── Health check logic ────────────────────────────────────────────────────────

async function probeContract(key: ContractKey): Promise<ContractHealthEntry> {
  const contractId = CONTRACT_IDS[key];
  const checkedAt = new Date().toISOString();

  if (!contractId) {
    return {
      key,
      contractId: "",
      status: "misconfigured",
      message: `Contract ID not set. Check VITE_${key.toUpperCase().replace(/([A-Z])/g, "_$1")}_ID in your environment.`,
      latencyMs: null,
      checkedAt,
    };
  }

  if (!isValidContractId(contractId)) {
    return {
      key,
      contractId,
      status: "misconfigured",
      message: `Contract ID "${contractId}" is malformed. Soroban IDs must be 56-character strings starting with 'C'.`,
      latencyMs: null,
      checkedAt,
    };
  }

  const probe = PROBES[key];
  const t0 = Date.now();
  try {
    await probe();
    return {
      key,
      contractId,
      status: "ok",
      message: "Contract is responsive.",
      latencyMs: Date.now() - t0,
      checkedAt,
    };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const isSimError = /simulation|not found|does not exist/i.test(raw);
    return {
      key,
      contractId,
      status: isSimError ? "misconfigured" : "unreachable",
      message: isSimError
        ? `Contract responded with a simulation error — it may not be initialised or the ID points to the wrong deployment: ${raw}`
        : `RPC call failed — contract may be unreachable or the network is down: ${raw}`,
      latencyMs: Date.now() - t0,
      checkedAt,
    };
  }
}

function deriveOverallStatus(entries: ContractHealthEntry[]): HealthStatus {
  if (entries.every((e) => e.status === "ok")) return "ok";
  if (entries.some((e) => e.status === "misconfigured")) return "misconfigured";
  if (entries.every((e) => e.status === "unreachable")) return "unreachable";
  return "degraded";
}

function buildDiagnostics(entries: ContractHealthEntry[]): string[] {
  const diags: string[] = [];
  for (const entry of entries) {
    if (entry.status !== "ok") {
      diags.push(`[${entry.status.toUpperCase()}] ${entry.key}: ${entry.message}`);
    }
    if (entry.latencyMs !== null && entry.latencyMs > 3_000) {
      diags.push(`[SLOW] ${entry.key}: response took ${entry.latencyMs}ms (>3 s threshold).`);
    }
  }
  return diags;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run health probes against all configured contracts in parallel.
 * Safe to call without a wallet — all probes are read-only simulations.
 */
async function fullReport(): Promise<DeploymentHealthReport> {
  const keys = Object.keys(CONTRACT_IDS) as ContractKey[];
  const entries = await Promise.all(keys.map(probeContract));
  const overallStatus = deriveOverallStatus(entries);
  const diagnostics = buildDiagnostics(entries);

  return {
    healthy: overallStatus === "ok",
    overallStatus,
    entries,
    diagnostics,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Quick single-contract liveness probe.
 * Returns true when the contract is reachable and the probe succeeds.
 */
async function isLive(key: ContractKey): Promise<boolean> {
  const entry = await probeContract(key);
  return entry.status === "ok";
}

/**
 * Returns only the unhealthy entries from a full report.
 * Useful for conditional operator alerts.
 */
async function unhealthyContracts(): Promise<ContractHealthEntry[]> {
  const { entries } = await fullReport();
  return entries.filter((e) => e.status !== "ok");
}

export const deploymentHealth = { fullReport, isLive, unhealthyContracts };
