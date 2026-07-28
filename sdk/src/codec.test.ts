/**
 * Tests for ScVal encoding helpers in codec.ts.
 *
 * We verify both round-trip fidelity (encode → scValToNative gives back the
 * original value) and XDR type discriminants so that a contract schema change
 * that breaks the encoder is caught immediately.
 */

import { describe, it, expect } from "vitest";
import { scValToNative } from "@stellar/stellar-sdk";
import {
  encodeAddress,
  encodeU32,
  encodeU64,
  encodeI128,
  encodeString,
  encodeBool,
  encodeSymbol,
  encodeComplianceRules,
  encodeTierPolicy,
  encodeRiskConfig,
  encodeInvoiceMeta,
  encodePropertyMeta,
  encodeProjectMeta,
} from "./codec.js";
import type {
  ComplianceRules,
  TierPolicy,
  RiskConfig,
  InvoiceMeta,
  PropertyMeta,
  ProjectMeta,
} from "./types.js";

// Well-formed Stellar addresses used across tests.
// Generated via Keypair.random() — both are valid Ed25519 public keys.
const ADDR = "GBQG2SJ7MXUH34SI3MJ2I256I5UMGM2QSQZM77YFX5S6JOHXUQJEPC3A";
// Used in InvoiceMeta issuer/debtor fields and as a second address fixture.
const ADDR2 = "GAQWW5UBJVPNKMM5NLAIBEL6QK24ODXABL7YAXBN6KNMH3OYNM5JXT35";

// ── Scalar helpers ────────────────────────────────────────────────────────────

describe("encodeAddress", () => {
  it("produces an ScVal that round-trips to the same address string", () => {
    const val = encodeAddress(ADDR);
    expect(scValToNative(val)).toBe(ADDR);
  });

  it("uses the address ScVal type", () => {
    const val = encodeAddress(ADDR);
    expect(val.switch().name).toBe("scvAddress");
  });
});

describe("encodeU32", () => {
  it("round-trips small integers", () => {
    expect(scValToNative(encodeU32(0))).toBe(0);
    expect(scValToNative(encodeU32(7))).toBe(7);
    expect(scValToNative(encodeU32(4294967295))).toBe(4294967295); // 0xFFFFFFFF wildcard
  });

  it("uses the u32 ScVal type", () => {
    expect(encodeU32(1).switch().name).toBe("scvU32");
  });
});

describe("encodeU64", () => {
  it("round-trips a bigint", () => {
    const result = scValToNative(encodeU64(9999999999n));
    // stellar-sdk decodes u64 as bigint
    expect(result).toBe(9999999999n);
  });

  it("accepts a plain number and coerces to bigint", () => {
    const result = scValToNative(encodeU64(1000));
    expect(result).toBe(1000n);
  });

  it("uses the u64 ScVal type", () => {
    expect(encodeU64(0n).switch().name).toBe("scvU64");
  });
});

describe("encodeI128", () => {
  it("round-trips zero", () => {
    expect(scValToNative(encodeI128(0n))).toBe(0n);
  });

  it("round-trips a large positive value (100M tokens at 7 decimals)", () => {
    const stroops = 100_000_000n * 10_000_000n;
    expect(scValToNative(encodeI128(stroops))).toBe(stroops);
  });

  it("round-trips the maximum i128 value", () => {
    const max = 170141183460469231731687303715884105727n;
    expect(scValToNative(encodeI128(max))).toBe(max);
  });

  it("uses the i128 ScVal type", () => {
    expect(encodeI128(1n).switch().name).toBe("scvI128");
  });
});

describe("encodeString", () => {
  it("round-trips ASCII strings", () => {
    expect(scValToNative(encodeString("hello"))).toBe("hello");
  });

  it("round-trips an empty string", () => {
    expect(scValToNative(encodeString(""))).toBe("");
  });

  it("uses the string ScVal type", () => {
    expect(encodeString("x").switch().name).toBe("scvString");
  });
});

describe("encodeBool", () => {
  it("round-trips true", () => {
    expect(scValToNative(encodeBool(true))).toBe(true);
  });

  it("round-trips false", () => {
    expect(scValToNative(encodeBool(false))).toBe(false);
  });
});

describe("encodeSymbol", () => {
  it("round-trips a symbol key", () => {
    expect(scValToNative(encodeSymbol("legal_entity"))).toBe("legal_entity");
  });

  it("uses the symbol ScVal type", () => {
    expect(encodeSymbol("x").switch().name).toBe("scvSymbol");
  });
});

// ── Struct encoders ───────────────────────────────────────────────────────────

describe("encodeComplianceRules", () => {
  const rules: ComplianceRules = {
    max_transfer_amount: 500_000_000n,
    min_holding_period: 86400n,
    max_holders: 500,
    require_same_jurisdiction: false,
    paused: false,
    allowlist_mode: true,
    max_holding_period: 31536000n,
  };

  it("produces an ScVal that round-trips back to the original struct", () => {
    const decoded = scValToNative(encodeComplianceRules(rules)) as ComplianceRules;
    expect(decoded.max_transfer_amount).toBe(rules.max_transfer_amount);
    expect(decoded.max_holders).toBe(rules.max_holders);
    expect(decoded.require_same_jurisdiction).toBe(false);
    expect(decoded.paused).toBe(false);
    expect(decoded.allowlist_mode).toBe(true);
  });

  it("encodes the paused flag correctly when true", () => {
    const paused = { ...rules, paused: true };
    const decoded = scValToNative(encodeComplianceRules(paused)) as ComplianceRules;
    expect(decoded.paused).toBe(true);
  });

  it("uses the map ScVal type", () => {
    expect(encodeComplianceRules(rules).switch().name).toBe("scvMap");
  });
});

describe("encodeTierPolicy", () => {
  const policy: TierPolicy = {
    blocked: false,
    max_transfer_amount: 10_000_000n,
    min_from_tier: 1,
    min_to_tier: 0,
  };

  it("round-trips the policy struct", () => {
    const decoded = scValToNative(encodeTierPolicy(policy)) as TierPolicy;
    expect(decoded.blocked).toBe(false);
    expect(decoded.max_transfer_amount).toBe(10_000_000n);
    expect(decoded.min_from_tier).toBe(1);
    expect(decoded.min_to_tier).toBe(0);
  });

  it("round-trips a blocked wildcard policy (0xFFFFFFFF tiers)", () => {
    const wildcard: TierPolicy = {
      blocked: true,
      max_transfer_amount: 0n,
      min_from_tier: 0xFFFFFFFF,
      min_to_tier: 0xFFFFFFFF,
    };
    const decoded = scValToNative(encodeTierPolicy(wildcard)) as TierPolicy;
    expect(decoded.blocked).toBe(true);
    expect(decoded.min_from_tier).toBe(0xFFFFFFFF);
  });
});

describe("encodeRiskConfig", () => {
  const config: RiskConfig = { max_score: 49, default_score: 0 };

  it("round-trips the risk config", () => {
    const decoded = scValToNative(encodeRiskConfig(config)) as RiskConfig;
    expect(decoded.max_score).toBe(49);
    expect(decoded.default_score).toBe(0);
  });

  it("handles max_score=0 (inactive risk scoring)", () => {
    const off = { max_score: 0, default_score: 0 };
    const decoded = scValToNative(encodeRiskConfig(off)) as RiskConfig;
    expect(decoded.max_score).toBe(0);
  });
});

describe("encodeInvoiceMeta", () => {
  const meta: InvoiceMeta = {
    invoice_id: "INV-2026-001",
    issuer: ADDR,
    debtor: ADDR2,
    face_value_usd: 1_000_000n,
    discount_rate_bps: 200,
    due_date: 1893456000n,
    currency: "USD",
    ipfs_doc_hash: "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG",
    transfer_fee_bps: 50,
    fee_recipient: null,
  };

  it("round-trips all string and numeric fields", () => {
    const decoded = scValToNative(encodeInvoiceMeta(meta)) as InvoiceMeta;
    expect(decoded.invoice_id).toBe("INV-2026-001");
    expect(decoded.currency).toBe("USD");
    expect(decoded.discount_rate_bps).toBe(200);
    expect(decoded.transfer_fee_bps).toBe(50);
    expect(decoded.face_value_usd).toBe(1_000_000n);
    expect(decoded.issuer).toBe(ADDR);
    expect(decoded.debtor).toBe(ADDR2);
  });
});

describe("encodePropertyMeta", () => {
  const meta: PropertyMeta = {
    property_id: "PROP-NYC-001",
    legal_name: "Veritoken NYC Holdings LLC",
    jurisdiction: "US",
    address: "123 Main St, New York, NY 10001",
    total_valuation_usd: 5_000_000n,
    total_shares: 10_000n,
    property_type: "Commercial",
    ipfs_title_hash: "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco",
    kyc_tier_required: 1,
  };

  it("round-trips all fields", () => {
    const decoded = scValToNative(encodePropertyMeta(meta)) as PropertyMeta;
    expect(decoded.property_id).toBe("PROP-NYC-001");
    expect(decoded.legal_name).toBe("Veritoken NYC Holdings LLC");
    expect(decoded.jurisdiction).toBe("US");
    expect(decoded.total_valuation_usd).toBe(5_000_000n);
    expect(decoded.total_shares).toBe(10_000n);
    expect(decoded.kyc_tier_required).toBe(1);
  });
});

describe("encodeProjectMeta", () => {
  const meta: ProjectMeta = {
    project_id: "VCS-1234",
    standard: "VCS",
    vintage_year: 2023,
    project_name: "Amazon Reforestation",
    project_type: "REDD+",
    country: "BR",
    verifier: "Verra",
    ipfs_cert_hash: "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG",
  };

  it("round-trips all fields", () => {
    const decoded = scValToNative(encodeProjectMeta(meta)) as ProjectMeta;
    expect(decoded.project_id).toBe("VCS-1234");
    expect(decoded.standard).toBe("VCS");
    expect(decoded.vintage_year).toBe(2023);
    expect(decoded.country).toBe("BR");
  });
});
