import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSetRules = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockSetTierPolicy = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockSetRiskConfig = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("../contracts/index", () => ({
  contracts: {
    compliance: {
      setRules: mockSetRules,
      setTierPolicy: mockSetTierPolicy,
      setRiskConfig: mockSetRiskConfig,
    },
  },
}));

import {
  PRESET_KEYS,
  POLICY_TEMPLATES,
  templateToConfigExport,
  applyPolicyTemplate,
} from "../policyTemplates";
import { validateConfigForApply, parseConfigJson, configToJson } from "../complianceConfig";

const ONE_YEAR_SECONDS = 31_536_000n;
const ADMIN = "GBQG2SJ7MXUH34SI3MJ2I256I5UMGM2QSQZM77YFX5S6JOHXUQJEPC3A";
const signTx = vi.fn(async (xdr: string) => xdr);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POLICY_TEMPLATES", () => {
  it("defines exactly the three documented presets", () => {
    expect(PRESET_KEYS).toEqual(["basic", "institutional", "restricted"]);
    expect(Object.keys(POLICY_TEMPLATES).sort()).toEqual([...PRESET_KEYS].sort());
  });

  it.each(PRESET_KEYS)("%s: rules stay within contract-enforced bounds", (key) => {
    const { rules } = POLICY_TEMPLATES[key];
    expect(rules.max_transfer_amount).toBeGreaterThanOrEqual(0n);
    expect(rules.min_holding_period).toBeGreaterThanOrEqual(0n);
    expect(rules.min_holding_period).toBeLessThanOrEqual(ONE_YEAR_SECONDS);
    expect(rules.max_holding_period).toBeGreaterThanOrEqual(0n);
    expect(rules.max_holders).toBeGreaterThanOrEqual(0);
  });

  it.each(PRESET_KEYS)("%s: tier policies use non-negative amounts and tiers", (key) => {
    for (const entry of POLICY_TEMPLATES[key].tierPolicies) {
      expect(entry.policy.max_transfer_amount).toBeGreaterThanOrEqual(0n);
      expect(entry.policy.min_from_tier).toBeGreaterThanOrEqual(0);
      expect(entry.policy.min_to_tier).toBeGreaterThanOrEqual(0);
    }
  });

  it.each(PRESET_KEYS)("%s: risk config scores are within [0, 100] when set", (key) => {
    const risk = POLICY_TEMPLATES[key].riskConfig;
    if (!risk) return;
    expect(risk.max_score).toBeGreaterThanOrEqual(0);
    expect(risk.max_score).toBeLessThanOrEqual(100);
    expect(risk.default_score).toBeGreaterThanOrEqual(0);
    expect(risk.default_score).toBeLessThanOrEqual(100);
  });

  it("restricted is strictly more conservative than basic", () => {
    const basic = POLICY_TEMPLATES.basic;
    const restricted = POLICY_TEMPLATES.restricted;

    expect(basic.rules.require_same_jurisdiction).toBe(false);
    expect(restricted.rules.require_same_jurisdiction).toBe(true);

    expect(basic.rules.min_holding_period).toBe(0n);
    expect(restricted.rules.min_holding_period).toBeGreaterThan(0n);

    expect(basic.riskConfig).toBeNull();
    expect(restricted.riskConfig).not.toBeNull();

    expect(basic.tierPolicies).toHaveLength(0);
    expect(restricted.tierPolicies.length).toBeGreaterThan(0);
  });

  it("institutional's risk tolerance sits between basic (none) and restricted (strictest)", () => {
    const institutional = POLICY_TEMPLATES.institutional.riskConfig;
    const restricted = POLICY_TEMPLATES.restricted.riskConfig;
    expect(institutional).not.toBeNull();
    expect(restricted).not.toBeNull();
    // A lower max_score is stricter (blocks more jurisdictions).
    expect(restricted!.max_score).toBeLessThan(institutional!.max_score);
  });
});

describe("templateToConfigExport", () => {
  it.each(PRESET_KEYS)("%s: produces a config that round-trips through export/import", (key) => {
    const exported = templateToConfigExport(key, "testnet");
    const json = configToJson(exported);
    const result = parseConfigJson(json);
    expect(result.ok).toBe(true);
  });

  it.each(PRESET_KEYS)("%s: passes semantic validation for apply", (key) => {
    const exported = templateToConfigExport(key, "testnet");
    expect(validateConfigForApply(exported)).toEqual([]);
  });

  it("labels the export with the preset name", () => {
    const exported = templateToConfigExport("institutional", "testnet");
    expect(exported.label).toBe("Institutional preset");
    expect(exported.network).toBe("testnet");
  });
});

describe("applyPolicyTemplate", () => {
  it("applies rules, then each tier policy, then risk config, for the institutional preset", async () => {
    const result = await applyPolicyTemplate("institutional", ADMIN, signTx, "testnet");

    expect(mockSetRules).toHaveBeenCalledTimes(1);
    expect(mockSetTierPolicy).toHaveBeenCalledTimes(1);
    expect(mockSetRiskConfig).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ tierPoliciesApplied: 1, riskConfigApplied: true });

    // setRules must run before setTierPolicy/setRiskConfig.
    const rulesOrder = mockSetRules.mock.invocationCallOrder[0];
    const tierOrder = mockSetTierPolicy.mock.invocationCallOrder[0];
    const riskOrder = mockSetRiskConfig.mock.invocationCallOrder[0];
    expect(rulesOrder).toBeLessThan(tierOrder);
    expect(tierOrder).toBeLessThan(riskOrder);
  });

  it("skips setRiskConfig and setTierPolicy for the basic preset", async () => {
    const result = await applyPolicyTemplate("basic", ADMIN, signTx, "testnet");

    expect(mockSetRules).toHaveBeenCalledTimes(1);
    expect(mockSetTierPolicy).not.toHaveBeenCalled();
    expect(mockSetRiskConfig).not.toHaveBeenCalled();
    expect(result).toEqual({ tierPoliciesApplied: 0, riskConfigApplied: false });
  });
});
