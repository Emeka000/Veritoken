/**
 * complianceConfig.ts — Issue #436
 *
 * Serialise and deserialise compliance configurations so teams can
 * back up, share, and restore policy settings between environments.
 *
 * Export format: JSON with a versioned envelope.
 * BigInt values are serialised as decimal strings to preserve precision
 * across JSON boundaries.
 */

import type { ComplianceRules, TierPolicy, RiskConfig } from "../types";
import { contracts, type SignTx } from "./contracts/index";

// ── Versioned envelope ────────────────────────────────────────────────────────

export const EXPORT_FORMAT_VERSION = "1.0";

export interface TierPolicyEntry {
  fromTier: number;
  toTier: number;
  policy: {
    blocked: boolean;
    max_transfer_amount: string; // decimal string
    min_from_tier: number;
    min_to_tier: number;
  };
}

export interface ComplianceConfigExport {
  /** Format version — bump when the schema changes. */
  version: string;
  /** ISO timestamp when the export was created. */
  exportedAt: string;
  /** Human-readable label set by the exporter. */
  label: string;
  /** Network this config was exported from. */
  network: string;
  rules: {
    max_transfer_amount: string; // decimal string
    min_holding_period: number;
    max_holding_period: number;
    max_holders: number;
    require_same_jurisdiction: boolean;
    paused: boolean;
    allowlist_mode: boolean;
  };
  tierPolicies: TierPolicyEntry[];
  riskConfig: RiskConfig | null;
}

// ── Serialise ─────────────────────────────────────────────────────────────────

export function exportConfig(
  rules: ComplianceRules,
  tierPolicies: Array<{ fromTier: number; toTier: number; policy: TierPolicy | null }>,
  riskConfig: RiskConfig | null,
  opts: { label?: string; network?: string } = {},
): ComplianceConfigExport {
  return {
    version: EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    label: opts.label ?? "Compliance config",
    network: opts.network ?? "unknown",
    rules: {
      max_transfer_amount: String(rules.max_transfer_amount),
      min_holding_period: Number(rules.min_holding_period),
      max_holding_period: Number(rules.max_holding_period),
      max_holders: rules.max_holders,
      require_same_jurisdiction: rules.require_same_jurisdiction,
      paused: rules.paused,
      allowlist_mode: rules.allowlist_mode,
    },
    tierPolicies: tierPolicies
      .filter((e) => e.policy !== null)
      .map((e) => ({
        fromTier: e.fromTier,
        toTier: e.toTier,
        policy: {
          blocked: e.policy!.blocked,
          max_transfer_amount: String(e.policy!.max_transfer_amount),
          min_from_tier: e.policy!.min_from_tier,
          min_to_tier: e.policy!.min_to_tier,
        },
      })),
    riskConfig,
  };
}

export function configToJson(config: ComplianceConfigExport): string {
  return JSON.stringify(config, null, 2);
}

export function downloadConfigJson(config: ComplianceConfigExport): void {
  const json = configToJson(config);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const ts = new Date(config.exportedAt).toISOString().replace(/[:.]/g, "-").slice(0, 19);
  a.href = url;
  a.download = `compliance-config-${config.network}-${ts}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Deserialise ───────────────────────────────────────────────────────────────

export type ImportResult =
  | { ok: true; config: ComplianceConfigExport }
  | { ok: false; error: string };

export function parseConfigJson(json: string): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, error: "File is not valid JSON." };
  }

  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "Expected a JSON object at the top level." };
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj.version !== "string") {
    return { ok: false, error: 'Missing or invalid "version" field.' };
  }
  if (obj.version !== EXPORT_FORMAT_VERSION) {
    return {
      ok: false,
      error: `Unsupported format version "${obj.version}". Expected "${EXPORT_FORMAT_VERSION}".`,
    };
  }
  if (typeof obj.rules !== "object" || obj.rules === null) {
    return { ok: false, error: 'Missing or invalid "rules" field.' };
  }
  if (!Array.isArray(obj.tierPolicies)) {
    return { ok: false, error: 'Missing or invalid "tierPolicies" field.' };
  }

  const rules = obj.rules as Record<string, unknown>;
  const requiredRuleKeys: Array<keyof ComplianceConfigExport["rules"]> = [
    "max_transfer_amount",
    "min_holding_period",
    "max_holding_period",
    "max_holders",
    "require_same_jurisdiction",
    "paused",
    "allowlist_mode",
  ];
  for (const key of requiredRuleKeys) {
    if (!(key in rules)) {
      return { ok: false, error: `Missing rules field: "${key}".` };
    }
  }

  return { ok: true, config: raw as ComplianceConfigExport };
}

/** Convert a parsed export back to typed domain objects ready for the UI. */
export function configToRules(config: ComplianceConfigExport): ComplianceRules {
  const r = config.rules;
  return {
    max_transfer_amount: BigInt(r.max_transfer_amount),
    min_holding_period: BigInt(r.min_holding_period),
    max_holding_period: BigInt(r.max_holding_period),
    max_holders: r.max_holders,
    require_same_jurisdiction: r.require_same_jurisdiction,
    paused: r.paused,
    allowlist_mode: r.allowlist_mode,
  };
}

/** Convert a parsed export's tier-policy entries back to typed domain objects. */
export function configToTierPolicies(
  config: ComplianceConfigExport,
): Array<{ fromTier: number; toTier: number; policy: TierPolicy }> {
  return config.tierPolicies.map((e) => ({
    fromTier: e.fromTier,
    toTier: e.toTier,
    policy: {
      blocked: e.policy.blocked,
      max_transfer_amount: BigInt(e.policy.max_transfer_amount),
      min_from_tier: e.policy.min_from_tier,
      min_to_tier: e.policy.min_to_tier,
    },
  }));
}

// ── Validation before apply (#454) ──────────────────────────────────────────────

/**
 * Semantic validation of a parsed config before it's applied on-chain.
 * Mirrors the stateless guards in `compliance-engine`'s `validate_rules`
 * (min holding period ≤ 365 days, non-negative amounts) plus the range
 * checks implicit in `RiskConfig`/`TierPolicy` (scores 0–100, non-negative
 * tiers). Returns a list of human-readable errors — empty means safe to
 * apply. Does not (and cannot, without an RPC round-trip) replicate stateful
 * on-chain checks like "max_holders below the current holder count".
 */
export function validateConfigForApply(config: ComplianceConfigExport): string[] {
  const errors: string[] = [];
  const r = config.rules;

  let maxTransfer: bigint;
  let minHolding: bigint;
  let maxHolding: bigint;
  try {
    maxTransfer = BigInt(r.max_transfer_amount);
    minHolding = BigInt(r.min_holding_period);
    maxHolding = BigInt(r.max_holding_period);
  } catch {
    return ["Rules contain a non-numeric amount or duration."];
  }

  if (maxTransfer < 0n) errors.push("Max transfer amount cannot be negative.");
  if (minHolding < 0n) errors.push("Min holding period cannot be negative.");
  if (minHolding > 31_536_000n) errors.push("Min holding period cannot exceed 365 days (31,536,000 seconds).");
  if (maxHolding < 0n) errors.push("Max holding period cannot be negative.");
  if (r.max_holders < 0) errors.push("Max holders cannot be negative.");

  for (const entry of config.tierPolicies) {
    const label = `Tier policy ${entry.fromTier}→${entry.toTier}`;
    let amt: bigint;
    try {
      amt = BigInt(entry.policy.max_transfer_amount);
    } catch {
      errors.push(`${label}: max transfer amount is not numeric.`);
      continue;
    }
    if (amt < 0n) errors.push(`${label}: max transfer amount cannot be negative.`);
    if (entry.policy.min_from_tier < 0) errors.push(`${label}: min_from_tier cannot be negative.`);
    if (entry.policy.min_to_tier < 0) errors.push(`${label}: min_to_tier cannot be negative.`);
  }

  if (config.riskConfig) {
    const { max_score, default_score } = config.riskConfig;
    if (max_score < 0 || max_score > 100) errors.push("Risk config max_score must be between 0 and 100.");
    if (default_score < 0 || default_score > 100) errors.push("Risk config default_score must be between 0 and 100.");
  }

  return errors;
}

// ── Apply on-chain (#453, #454) ──────────────────────────────────────────────────

export interface ApplyComplianceConfigResult {
  tierPoliciesApplied: number;
  riskConfigApplied: boolean;
}

/**
 * Apply a config's rules, tier policies, and risk config on-chain, in that
 * order. Shared by the Compliance Config I/O "Apply" flow (#454) and the
 * policy-template picker (#453) so both paths write through the exact same
 * sequence of admin calls. Callers should run `validateConfigForApply`
 * first and block on any errors — this function does not re-validate.
 */
export async function applyComplianceConfig(
  config: ComplianceConfigExport,
  adminAddress: string,
  signTx: SignTx,
): Promise<ApplyComplianceConfigResult> {
  await contracts.compliance.setRules(adminAddress, configToRules(config), signTx);

  for (const entry of configToTierPolicies(config)) {
    await contracts.compliance.setTierPolicy(adminAddress, entry.fromTier, entry.toTier, entry.policy, signTx);
  }

  if (config.riskConfig) {
    await contracts.compliance.setRiskConfig(adminAddress, config.riskConfig, signTx);
  }

  return {
    tierPoliciesApplied: config.tierPolicies.length,
    riskConfigApplied: config.riskConfig !== null,
  };
}
