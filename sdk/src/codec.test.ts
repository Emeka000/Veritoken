import { describe, it, expect } from "vitest";
import { scValToNative } from "@stellar/stellar-sdk";
import { encodeAddress, encodeU32, encodeU64, encodeI128, encodeString, encodeBool, encodeSymbol, encodeComplianceRules, encodeTierPolicy, encodeRiskConfig, encodeInvoiceMeta, encodePropertyMeta, encodeProjectMeta } from "./codec.js";

const ADDR  = "GBQG2SJ7MXUH34SI3MJ2I256I5UMGM2QSQZM77YFX5S6JOHXUQJEPC3A";
const ADDR2 = "GAQWW5UBJVPNKMM5NLAIBEL6QK24ODXABL7YAXBN6KNMH3OYNM5JXT35";

describe("scalar encoders", () => {
  it("encodeAddress round-trips to string", () => { expect(scValToNative(encodeAddress(ADDR))).toBe(ADDR); });
  it("encodeAddress uses scvAddress type", () => { expect(encodeAddress(ADDR).switch().name).toBe("scvAddress"); });
  it("encodeU32 round-trips 0, 7, 0xFFFFFFFF", () => { expect(scValToNative(encodeU32(0))).toBe(0); expect(scValToNative(encodeU32(7))).toBe(7); expect(scValToNative(encodeU32(4294967295))).toBe(4294967295); });
  it("encodeU64 round-trips bigint", () => { expect(scValToNative(encodeU64(9999999999n))).toBe(9999999999n); });
  it("encodeI128 round-trips zero and large values", () => { expect(scValToNative(encodeI128(0n))).toBe(0n); const big = 100_000_000n * 10_000_000n; expect(scValToNative(encodeI128(big))).toBe(big); const max = 170141183460469231731687303715884105727n; expect(scValToNative(encodeI128(max))).toBe(max); });
  it("encodeString round-trips ASCII and empty", () => { expect(scValToNative(encodeString("hello"))).toBe("hello"); expect(scValToNative(encodeString(""))).toBe(""); });
  it("encodeBool round-trips true and false", () => { expect(scValToNative(encodeBool(true))).toBe(true); expect(scValToNative(encodeBool(false))).toBe(false); });
  it("encodeSymbol round-trips", () => { expect(scValToNative(encodeSymbol("legal_entity"))).toBe("legal_entity"); expect(encodeSymbol("x").switch().name).toBe("scvSymbol"); });
});

describe("encodeComplianceRules", () => {
  const rules = { max_transfer_amount: 500_000_000n, min_holding_period: 86400n, max_holders: 500, require_same_jurisdiction: false, paused: false, allowlist_mode: true, max_holding_period: 31536000n };
  it("round-trips the struct", () => { const d = scValToNative(encodeComplianceRules(rules)); expect(d.max_transfer_amount).toBe(500_000_000n); expect(d.max_holders).toBe(500); expect(d.allowlist_mode).toBe(true); });
  it("encodes paused=true", () => { expect(scValToNative(encodeComplianceRules({ ...rules, paused: true })).paused).toBe(true); });
  it("uses scvMap type", () => { expect(encodeComplianceRules(rules).switch().name).toBe("scvMap"); });
});

describe("encodeTierPolicy", () => {
  it("round-trips normal policy", () => { const p = { blocked: false, max_transfer_amount: 10_000_000n, min_from_tier: 1, min_to_tier: 0 }; const d = scValToNative(encodeTierPolicy(p)); expect(d.blocked).toBe(false); expect(d.max_transfer_amount).toBe(10_000_000n); expect(d.min_from_tier).toBe(1); });
  it("round-trips blocked wildcard policy", () => { const p = { blocked: true, max_transfer_amount: 0n, min_from_tier: 0xFFFFFFFF, min_to_tier: 0xFFFFFFFF }; const d = scValToNative(encodeTierPolicy(p)); expect(d.blocked).toBe(true); expect(d.min_from_tier).toBe(0xFFFFFFFF); });
});

describe("encodeRiskConfig", () => {
  it("round-trips max_score and default_score", () => { const d = scValToNative(encodeRiskConfig({ max_score: 49, default_score: 0 })); expect(d.max_score).toBe(49); expect(d.default_score).toBe(0); });
  it("handles max_score=0 (inactive)", () => { expect(scValToNative(encodeRiskConfig({ max_score: 0, default_score: 0 })).max_score).toBe(0); });
});

describe("encodeInvoiceMeta", () => {
  const meta = { invoice_id: "INV-001", issuer: ADDR, debtor: ADDR2, face_value_usd: 1_000_000n, discount_rate_bps: 200, due_date: 1893456000n, currency: "USD", ipfs_doc_hash: "QmYwAPJz", transfer_fee_bps: 50, fee_recipient: null };
  it("round-trips string and numeric fields", () => { const d = scValToNative(encodeInvoiceMeta(meta)); expect(d.invoice_id).toBe("INV-001"); expect(d.currency).toBe("USD"); expect(d.discount_rate_bps).toBe(200); expect(d.face_value_usd).toBe(1_000_000n); expect(d.issuer).toBe(ADDR); expect(d.debtor).toBe(ADDR2); });
});

describe("encodePropertyMeta", () => {
  const meta = { property_id: "PROP-001", legal_name: "Test LLC", jurisdiction: "US", address: "123 Main", total_valuation_usd: 5_000_000n, total_shares: 10_000n, property_type: "Commercial", ipfs_title_hash: "QmXoy", kyc_tier_required: 1 };
  it("round-trips all fields", () => { const d = scValToNative(encodePropertyMeta(meta)); expect(d.property_id).toBe("PROP-001"); expect(d.jurisdiction).toBe("US"); expect(d.total_valuation_usd).toBe(5_000_000n); expect(d.kyc_tier_required).toBe(1); });
});

describe("encodeProjectMeta", () => {
  const meta = { project_id: "VCS-1234", standard: "VCS", vintage_year: 2023, project_name: "Amazon Reforestation", project_type: "REDD+", country: "BR", verifier: "Verra", ipfs_cert_hash: "QmYw" };
  it("round-trips all fields", () => { const d = scValToNative(encodeProjectMeta(meta)); expect(d.project_id).toBe("VCS-1234"); expect(d.vintage_year).toBe(2023); expect(d.country).toBe("BR"); });
});
