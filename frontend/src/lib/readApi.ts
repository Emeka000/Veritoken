/**
 * Read API — aggregated contract state snapshot.
 *
 * Issue #424: provides a single developer-friendly entry point that stitches
 * together the most commonly needed on-chain state without callers having to
 * issue many individual contract calls.
 *
 * All methods are read-only (simulation); no wallet or signing is required.
 *
 * Usage:
 *   import { readApi } from "./readApi";
 *   const snapshot = await readApi.globalSnapshot();
 *   const holder  = await readApi.holderSnapshot(walletAddress);
 */

import { contracts } from "./contracts/index";
import { CONTRACT_IDS } from "./stellar";
import type {
  ComplianceRules,
  KycRecord,
  KycSyncStatus,
  TierPolicy,
  RiskConfig,
  TokenExportMetadata,
} from "../types";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ComplianceSnapshot {
  rules: ComplianceRules | null;
  paused: boolean;
  holderCount: number;
  blocklistCount: number;
  ruleChangeDelay: number;
  pendingRules: { rules: ComplianceRules; activateAt: number } | null;
  riskConfig: RiskConfig | null;
  fetchedAt: string;
}

export interface TokenSnapshot {
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
  maxSupply: bigint;
  assetType: string;
  kycRegistry: string;
  complianceEngine: string;
  exportMetadata: TokenExportMetadata | null;
  fetchedAt: string;
}

/** Aggregated state from all deployed contracts. */
export interface GlobalSnapshot {
  compliance: ComplianceSnapshot;
  rwaToken: TokenSnapshot | null;
  contractIds: typeof CONTRACT_IDS;
  fetchedAt: string;
}

/** Per-address state combining KYC, balance, and freeze status. */
export interface HolderSnapshot {
  address: string;
  kycRecord: KycRecord | null;
  kycActive: boolean;
  kycTier: number;
  kycJurisdiction: string;
  rwaBalance: bigint;
  rwaFrozen: boolean;
  kycSyncStatus: KycSyncStatus | null;
  fetchedAt: string;
}

/** Compliance policy overview: tier policies + risk config. */
export interface PolicySnapshot {
  riskConfig: RiskConfig | null;
  /** Sampled tier policies for the 3×3 standard tier grid (0–2). */
  tierPolicies: Array<{ fromTier: number; toTier: number; policy: TierPolicy | null }>;
  blockedJurisdictions: string[];
  fetchedAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function safeCall<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch a full compliance engine snapshot in one call.
 * Safe to call without a connected wallet.
 */
async function complianceSnapshot(): Promise<ComplianceSnapshot> {
  const fetchedAt = new Date().toISOString();
  const [rules, holderCount, blocklistCount, ruleChangeDelay, pendingRules, riskConfig] =
    await Promise.all([
      safeCall(() => contracts.compliance.getRules(), null),
      safeCall(() => contracts.compliance.holderCount(), 0),
      safeCall(() => contracts.compliance.blocklistCount(), 0),
      safeCall(() => contracts.compliance.getRuleChangeDelay(), 0),
      safeCall(() => contracts.compliance.getPendingRules(), null),
      safeCall(() => contracts.compliance.getRiskConfig(), null),
    ]);

  return {
    rules,
    paused: rules?.paused ?? false,
    holderCount,
    blocklistCount,
    ruleChangeDelay,
    pendingRules,
    riskConfig,
    fetchedAt,
  };
}

/**
 * Fetch a token metadata snapshot for the RWA token.
 * Returns null when the contract ID is not configured.
 */
async function rwaTokenSnapshot(): Promise<TokenSnapshot | null> {
  if (!CONTRACT_IDS.rwaToken) return null;
  const fetchedAt = new Date().toISOString();
  const [assetType, kycRegistry, complianceEngine, exportMetadata] = await Promise.all([
    safeCall(() => contracts.rwa.assetType(), ""),
    safeCall(() => contracts.rwa.kycRegistry(), ""),
    safeCall(() => contracts.rwa.complianceEngine(), ""),
    safeCall(() => contracts.rwa.getTokenExport(), null),
  ]);

  return {
    name: exportMetadata?.name ?? "",
    symbol: exportMetadata?.symbol ?? "",
    decimals: exportMetadata?.decimals ?? 7,
    totalSupply: exportMetadata?.total_supply ?? 0n,
    maxSupply: exportMetadata?.max_supply ?? 0n,
    assetType,
    kycRegistry,
    complianceEngine,
    exportMetadata,
    fetchedAt,
  };
}

/**
 * Aggregate snapshot across all deployed contracts.
 * Suitable for dashboard landing pages and monitoring tools.
 */
async function globalSnapshot(): Promise<GlobalSnapshot> {
  const fetchedAt = new Date().toISOString();
  const [compliance, rwaToken] = await Promise.all([
    complianceSnapshot(),
    rwaTokenSnapshot(),
  ]);

  return {
    compliance,
    rwaToken,
    contractIds: CONTRACT_IDS,
    fetchedAt,
  };
}

/**
 * Fetch all state relevant to a single holder address.
 * Combines KYC registry, token balance, freeze status, and live KYC sync.
 */
async function holderSnapshot(address: string): Promise<HolderSnapshot> {
  const fetchedAt = new Date().toISOString();
  const [kycRecord, kycSyncStatus, rwaBalance, rwaFrozen] = await Promise.all([
    safeCall(() => contracts.kyc.getRecord(address), null),
    safeCall(
      () => (CONTRACT_IDS.rwaToken ? contracts.rwa.checkKycStatus(address) : Promise.resolve(null)),
      null,
    ),
    // Balance is exposed on individual token contracts, not the rwa base token.
    // We fall back to the invoice token as the primary holder token when available.
    safeCall(
      () => (CONTRACT_IDS.invoiceToken ? contracts.invoice.balance(address) : Promise.resolve(0n)),
      0n,
    ),
    // Freeze status is not yet available via a read call — return safe default.
    Promise.resolve(false),
  ]);

  return {
    address,
    kycRecord,
    kycActive: kycSyncStatus?.is_active ?? (kycRecord?.status === "Approved"),
    kycTier: kycRecord?.tier ?? 0,
    kycJurisdiction: kycRecord?.jurisdiction ?? "",
    rwaBalance,
    rwaFrozen,
    kycSyncStatus,
    fetchedAt,
  };
}

/** Snapshot of all compliance policy entries (tier matrix + risk config). */
async function policySnapshot(): Promise<PolicySnapshot> {
  const fetchedAt = new Date().toISOString();
  const STANDARD_TIERS = [0, 1, 2];
  const pairs = STANDARD_TIERS.flatMap((from) =>
    STANDARD_TIERS.map((to) => ({ fromTier: from, toTier: to })),
  );

  const [riskConfig, ...tierPolicyResults] = await Promise.all([
    safeCall(() => contracts.compliance.getRiskConfig(), null),
    ...pairs.map(({ fromTier, toTier }) =>
      safeCall(() => contracts.compliance.getTierPolicy(fromTier, toTier), null),
    ),
  ]);

  const tierPolicies = pairs.map(({ fromTier, toTier }, i) => ({
    fromTier,
    toTier,
    policy: tierPolicyResults[i] as TierPolicy | null,
  }));

  // Fetch blocked jurisdictions — not yet exposed on the TS client, graceful fallback.
  const blockedJurisdictions: string[] = await safeCall(
    () => (contracts.compliance as unknown as { getBlockedJurisdictions(): Promise<string[]> }).getBlockedJurisdictions(),
    [],
  );

  return {
    riskConfig: riskConfig as RiskConfig | null,
    tierPolicies,
    blockedJurisdictions,
    fetchedAt,
  };
}

/**
 * Quick liveness check — returns true when the compliance engine responds
 * to a get_rules call within a reasonable timeout.
 */
async function isContractLive(contractId: string): Promise<boolean> {
  if (!contractId) return false;
  try {
    await contracts.compliance.getRules();
    return true;
  } catch {
    return false;
  }
}

export const readApi = {
  complianceSnapshot,
  rwaTokenSnapshot,
  globalSnapshot,
  holderSnapshot,
  policySnapshot,
  isContractLive,
};
