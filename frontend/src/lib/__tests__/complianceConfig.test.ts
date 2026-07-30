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
  exportConfig,
  configToJson,
  parseConfigJson,
  configToRules,
  configToTierPolicies,
  validateConfigForApply,
  applyComplianceConfig,
  type ComplianceConfigExport,
} from "../complianceConfig";
import type { ComplianceRules } from "../../types";

const ADMIN = "GBQG2SJ7MXUH34SI3MJ2I256I5UMGM2QSQZM77YFX5S6JOHXUQJEPC3A";
const signTx = vi.fn(async (xdr: string) => xdr);

const BASE_RULES: ComplianceRules = {
  max_transfer_amount: 5_000_000n,
  min_holding_period: 3_600n,
  max_holding_period: 0n,
  max_holders: 100,
  require_same_jurisdiction: false,
  paused: false,
  allowlist_mode: false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("exportConfig / configToRules round-trip", () => {
  it("preserves bigint fields (min_holding_period, max_holding_period) across export and re-import", () => {
    const rules: ComplianceRules = { ...BASE_RULES, min_holding_period: 86_400n, max_holding_period: 172_800n };
    const exported = exportConfig(rules, [], null, { label: "test", network: "testnet" });

    // Regression check: these must serialise as JSON-safe numbers, not bigints.
    expect(typeof exported.rules.min_holding_period).toBe("number");
    expect(typeof exported.rules.max_holding_period).toBe("number");
    expect(exported.rules.min_holding_period).toBe(86_400);
    expect(exported.rules.max_holding_period).toBe(172_800);

    const restored = configToRules(exported);
    expect(restored.min_holding_period).toBe(86_400n);
    expect(restored.max_holding_period).toBe(172_800n);
    expect(typeof restored.min_holding_period).toBe("bigint");
  });

  it("survives a full JSON stringify/parse cycle", () => {
    const exported = exportConfig(BASE_RULES, [], null, { label: "test", network: "testnet" });
    const json = configToJson(exported);
    const result = parseConfigJson(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const restored = configToRules(result.config);
      expect(restored).toEqual(BASE_RULES);
    }
  });

  it("configToTierPolicies restores bigint amounts", () => {
    const exported = exportConfig(
      BASE_RULES,
      [{ fromTier: 0, toTier: 2, policy: { blocked: true, max_transfer_amount: 1000n, min_from_tier: 0, min_to_tier: 0 } }],
      null,
      { label: "test", network: "testnet" },
    );
    const restored = configToTierPolicies(exported);
    expect(restored).toEqual([
      { fromTier: 0, toTier: 2, policy: { blocked: true, max_transfer_amount: 1000n, min_from_tier: 0, min_to_tier: 0 } },
    ]);
  });
});

describe("validateConfigForApply", () => {
  function makeConfig(overrides: Partial<ComplianceConfigExport["rules"]> = {}): ComplianceConfigExport {
    return exportConfig({ ...BASE_RULES, ...overrides } as ComplianceRules, [], null, {
      label: "test",
      network: "testnet",
    });
  }

  it("returns no errors for a valid config", () => {
    expect(validateConfigForApply(makeConfig())).toEqual([]);
  });

  it("rejects a negative max_transfer_amount", () => {
    const config = makeConfig();
    config.rules.max_transfer_amount = "-1";
    expect(validateConfigForApply(config)).toContain("Max transfer amount cannot be negative.");
  });

  it("rejects a min_holding_period beyond 365 days", () => {
    const config = makeConfig();
    config.rules.min_holding_period = 31_536_001;
    expect(validateConfigForApply(config).some((e) => /365 days/.test(e))).toBe(true);
  });

  it("rejects a negative min_holding_period", () => {
    const config = makeConfig();
    config.rules.min_holding_period = -1;
    expect(validateConfigForApply(config)).toContain("Min holding period cannot be negative.");
  });

  it("rejects a negative max_holders", () => {
    const config = makeConfig();
    config.rules.max_holders = -5;
    expect(validateConfigForApply(config)).toContain("Max holders cannot be negative.");
  });

  it("rejects a risk config score outside [0, 100]", () => {
    const config = exportConfig(BASE_RULES, [], { max_score: 150, default_score: 0 }, { label: "t", network: "testnet" });
    expect(validateConfigForApply(config).some((e) => /max_score/.test(e))).toBe(true);
  });

  it("rejects a negative tier-policy transfer amount", () => {
    const config = exportConfig(
      BASE_RULES,
      [{ fromTier: 0, toTier: 1, policy: { blocked: false, max_transfer_amount: 100n, min_from_tier: 0, min_to_tier: 0 } }],
      null,
      { label: "t", network: "testnet" },
    );
    config.tierPolicies[0].policy.max_transfer_amount = "-50";
    expect(validateConfigForApply(config).some((e) => /Tier policy 0→1/.test(e))).toBe(true);
  });
});

describe("applyComplianceConfig", () => {
  it("calls setRules, then setTierPolicy per entry, then setRiskConfig, in order", async () => {
    const config = exportConfig(
      BASE_RULES,
      [
        { fromTier: 0, toTier: 1, policy: { blocked: false, max_transfer_amount: 0n, min_from_tier: 0, min_to_tier: 0 } },
        { fromTier: 1, toTier: 2, policy: { blocked: true, max_transfer_amount: 0n, min_from_tier: 0, min_to_tier: 0 } },
      ],
      { max_score: 50, default_score: 0 },
      { label: "t", network: "testnet" },
    );

    const result = await applyComplianceConfig(config, ADMIN, signTx);

    expect(mockSetRules).toHaveBeenCalledTimes(1);
    expect(mockSetTierPolicy).toHaveBeenCalledTimes(2);
    expect(mockSetRiskConfig).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ tierPoliciesApplied: 2, riskConfigApplied: true });

    const rulesOrder = mockSetRules.mock.invocationCallOrder[0];
    const firstTierOrder = mockSetTierPolicy.mock.invocationCallOrder[0];
    const riskOrder = mockSetRiskConfig.mock.invocationCallOrder[0];
    expect(rulesOrder).toBeLessThan(firstTierOrder);
    expect(firstTierOrder).toBeLessThan(riskOrder);
  });

  it("skips setRiskConfig when the config has none", async () => {
    const config = exportConfig(BASE_RULES, [], null, { label: "t", network: "testnet" });
    const result = await applyComplianceConfig(config, ADMIN, signTx);
    expect(mockSetRiskConfig).not.toHaveBeenCalled();
    expect(result.riskConfigApplied).toBe(false);
  });
});
