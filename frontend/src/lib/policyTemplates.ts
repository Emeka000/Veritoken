/**
 * policyTemplates.ts — Issue #453
 *
 * Reusable compliance policy presets ("basic", "institutional", "restricted")
 * so new teams don't have to hand-tune every rule, tier policy, and risk
 * score from a blank slate. Each preset is expressed as the same domain
 * objects the Admin page already writes on-chain (`ComplianceRules`,
 * `TierPolicy`, `RiskConfig`), so applying one goes through the exact same
 * `setRules` / `setTierPolicy` / `setRiskConfig` calls a manual edit would.
 */

import type { ComplianceRules, TierPolicy, RiskConfig } from "../types";
import type { SignTx } from "./contracts/index";
import {
  exportConfig,
  applyComplianceConfig,
  type ComplianceConfigExport,
  type ApplyComplianceConfigResult,
} from "./complianceConfig";

export const PRESET_KEYS = ["basic", "institutional", "restricted"] as const;
export type PresetKey = (typeof PRESET_KEYS)[number];

export interface PolicyTemplate {
  key: PresetKey;
  label: string;
  description: string;
  rules: ComplianceRules;
  tierPolicies: Array<{ fromTier: number; toTier: number; policy: TierPolicy }>;
  riskConfig: RiskConfig | null;
}

/** Wildcard tier — matches any KYC tier on that side of a transfer (see compliance-engine's `TierPolicyKey`). */
const WILDCARD_TIER = 0xffffffff;

export const POLICY_TEMPLATES: Record<PresetKey, PolicyTemplate> = {
  basic: {
    key: "basic",
    label: "Basic",
    description:
      "Permissive defaults for pilots and small teams: no transfer limits, no holding period, no tier gating, no jurisdiction risk scoring. KYC approval is still enforced by the KYC registry — this preset only relaxes the compliance engine's additional layer.",
    rules: {
      max_transfer_amount: 0n,
      min_holding_period: 0n,
      max_holding_period: 0n,
      max_holders: 0,
      require_same_jurisdiction: false,
      paused: false,
      allowlist_mode: false,
    },
    tierPolicies: [],
    riskConfig: null,
  },
  institutional: {
    key: "institutional",
    label: "Institutional",
    description:
      "Requires every recipient to hold at least the Institutional KYC tier (tier 2), applies a 1-day cooling-off holding period, and blocks jurisdictions with a risk score above 74 (sanctioned or highly-scrutinised).",
    rules: {
      max_transfer_amount: 0n,
      min_holding_period: 86_400n, // 1 day
      max_holding_period: 0n,
      max_holders: 0,
      require_same_jurisdiction: false,
      paused: false,
      allowlist_mode: false,
    },
    tierPolicies: [
      {
        fromTier: WILDCARD_TIER,
        toTier: WILDCARD_TIER,
        policy: { blocked: false, max_transfer_amount: 0n, min_from_tier: 0, min_to_tier: 2 },
      },
    ],
    riskConfig: { max_score: 74, default_score: 0 },
  },
  restricted: {
    key: "restricted",
    label: "Restricted",
    description:
      "The tightest preset: transfers must stay within the same jurisdiction, a 30-day holding period applies, retail (tier 0) → institutional (tier 2) transfers are blocked outright, and jurisdictions with a risk score above 49 (FATF grey-list and above) are blocked.",
    rules: {
      max_transfer_amount: 1_000_000_0000000n, // 1,000,000 tokens at 7 decimals
      min_holding_period: 2_592_000n, // 30 days
      max_holding_period: 0n,
      max_holders: 0,
      require_same_jurisdiction: true,
      paused: false,
      allowlist_mode: false,
    },
    tierPolicies: [
      {
        fromTier: 0,
        toTier: 2,
        policy: { blocked: true, max_transfer_amount: 0n, min_from_tier: 0, min_to_tier: 0 },
      },
    ],
    riskConfig: { max_score: 49, default_score: 0 },
  },
};

/** Adapt a preset into the same export envelope used by Compliance Config I/O, for a consistent preview UI. */
export function templateToConfigExport(key: PresetKey, network: string): ComplianceConfigExport {
  const template = POLICY_TEMPLATES[key];
  return exportConfig(template.rules, template.tierPolicies, template.riskConfig, {
    label: `${template.label} preset`,
    network,
  });
}

/**
 * Apply a preset on-chain: `setRules`, then `setTierPolicy` per entry, then
 * `setRiskConfig` if the preset configures one — the same sequence used to
 * restore a backed-up config (see `applyComplianceConfig` in
 * complianceConfig.ts, which this delegates to).
 */
export async function applyPolicyTemplate(
  key: PresetKey,
  adminAddress: string,
  signTx: SignTx,
  network: string,
): Promise<ApplyComplianceConfigResult> {
  const config = templateToConfigExport(key, network);
  return applyComplianceConfig(config, adminAddress, signTx);
}
