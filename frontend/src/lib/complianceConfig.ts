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
    min_holding_period: string; // decimal string
    max_holding_period: string; // decimal string
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
      min_holding_period: String(rules.min_holding_period),
      max_holding_period: String(rules.max_holding_period),
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
