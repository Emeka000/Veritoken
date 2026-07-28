import { nativeToScVal, xdr } from "@stellar/stellar-sdk";
import type { ComplianceRules, TierPolicy, RiskConfig, InvoiceMeta, PropertyMeta, ProjectMeta } from "./types.js";

export const encodeAddress = (addr: string): xdr.ScVal => nativeToScVal(addr, { type: "address" });
export const encodeU32 = (n: number): xdr.ScVal => nativeToScVal(n, { type: "u32" });
export const encodeU64 = (n: bigint | number): xdr.ScVal => nativeToScVal(BigInt(n), { type: "u64" });
export const encodeI128 = (n: bigint | number): xdr.ScVal => nativeToScVal(BigInt(n), { type: "i128" });
export const encodeString = (s: string): xdr.ScVal => nativeToScVal(s, { type: "string" });
export const encodeBool = (b: boolean): xdr.ScVal => nativeToScVal(b, { type: "bool" });
export const encodeSymbol = (s: string): xdr.ScVal => nativeToScVal(s, { type: "symbol" });

function scMap(entries: [string, xdr.ScVal][]): xdr.ScVal {
  const sorted = [...entries].sort(([a], [b]) => a.localeCompare(b));
  return xdr.ScVal.scvMap(sorted.map(([key, val]) => new xdr.ScMapEntry({ key: nativeToScVal(key, { type: "symbol" }), val })));
}

export function encodeComplianceRules(r: ComplianceRules): xdr.ScVal {
  return scMap([
    ["allowlist_mode",            encodeBool(r.allowlist_mode)],
    ["max_holding_period",        encodeU64(r.max_holding_period)],
    ["max_holders",               encodeU32(r.max_holders)],
    ["max_transfer_amount",       encodeI128(r.max_transfer_amount)],
    ["min_holding_period",        encodeU64(r.min_holding_period)],
    ["paused",                    encodeBool(r.paused)],
    ["require_same_jurisdiction", encodeBool(r.require_same_jurisdiction)],
  ]);
}

export function encodeTierPolicy(p: TierPolicy): xdr.ScVal {
  return scMap([
    ["blocked",             encodeBool(p.blocked)],
    ["max_transfer_amount", encodeI128(p.max_transfer_amount)],
    ["min_from_tier",       encodeU32(p.min_from_tier)],
    ["min_to_tier",         encodeU32(p.min_to_tier)],
  ]);
}

export function encodeRiskConfig(c: RiskConfig): xdr.ScVal {
  return scMap([["default_score", encodeU32(c.default_score)], ["max_score", encodeU32(c.max_score)]]);
}

export function encodeInvoiceMeta(m: InvoiceMeta): xdr.ScVal {
  return scMap([
    ["currency",          encodeString(m.currency)],
    ["debtor",            encodeString(m.debtor)],
    ["discount_rate_bps", encodeU32(m.discount_rate_bps)],
    ["due_date",          encodeU64(m.due_date)],
    ["face_value_usd",    encodeI128(m.face_value_usd)],
    ["fee_recipient",     m.fee_recipient ? encodeString(m.fee_recipient) : nativeToScVal(null)],
    ["invoice_id",        encodeString(m.invoice_id)],
    ["ipfs_doc_hash",     encodeString(m.ipfs_doc_hash)],
    ["issuer",            encodeString(m.issuer)],
    ["transfer_fee_bps",  encodeU32(m.transfer_fee_bps)],
  ]);
}

export function encodePropertyMeta(m: PropertyMeta): xdr.ScVal {
  return scMap([
    ["address",             encodeString(m.address)],
    ["ipfs_title_hash",     encodeString(m.ipfs_title_hash)],
    ["jurisdiction",        encodeString(m.jurisdiction)],
    ["kyc_tier_required",   encodeU32(m.kyc_tier_required)],
    ["legal_name",          encodeString(m.legal_name)],
    ["property_id",         encodeString(m.property_id)],
    ["property_type",       encodeString(m.property_type)],
    ["total_shares",        encodeI128(m.total_shares)],
    ["total_valuation_usd", encodeI128(m.total_valuation_usd)],
  ]);
}

export function encodeProjectMeta(m: ProjectMeta): xdr.ScVal {
  return scMap([
    ["country",        encodeString(m.country)],
    ["ipfs_cert_hash", encodeString(m.ipfs_cert_hash)],
    ["project_id",     encodeString(m.project_id)],
    ["project_name",   encodeString(m.project_name)],
    ["project_type",   encodeString(m.project_type)],
    ["standard",       encodeString(m.standard)],
    ["verifier",       encodeString(m.verifier)],
    ["vintage_year",   encodeU32(m.vintage_year)],
  ]);
}
