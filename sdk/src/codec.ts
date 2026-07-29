/**
 * Shared ScVal encoding utilities for all Veritoken contract structs.
 *
 * Every contract client that needs to pass a complex struct on-chain should
 * import an encoder from here rather than inlining nativeToScVal type hints.
 * This keeps field-order and type declarations in one place so a contract
 * schema change only needs updating here.
 *
 * ## Why not nativeToScVal(obj, { type: { field: ["u32"] } })?
 * The per-field type-hint syntax in the second argument to `nativeToScVal` is
 * not supported by @stellar/stellar-sdk v12.  The `type` option only accepts a
 * single top-level discriminant (e.g. "u32", "i128", "address").  Structs with
 * mixed field types must be built as an ScMap with explicit ScMapEntry nodes.
 */

import { nativeToScVal, xdr } from "@stellar/stellar-sdk";
import type {
  ComplianceRules,
  TierPolicy,
  RiskConfig,
  InvoiceMeta,
  PropertyMeta,
  ProjectMeta,
} from "./types.js";

// ── Scalar helpers ────────────────────────────────────────────────────────────

/** Encode a Stellar address (G… or C…) as ScVal. */
export const encodeAddress = (addr: string): xdr.ScVal =>
  nativeToScVal(addr, { type: "address" });

/** Encode a u32 integer as ScVal. */
export const encodeU32 = (n: number): xdr.ScVal =>
  nativeToScVal(n, { type: "u32" });

/** Encode a u64 integer as ScVal. Accepts bigint or number. */
export const encodeU64 = (n: bigint | number): xdr.ScVal =>
  nativeToScVal(BigInt(n), { type: "u64" });

/** Encode an i128 integer as ScVal. Accepts bigint or number. */
export const encodeI128 = (n: bigint | number): xdr.ScVal =>
  nativeToScVal(BigInt(n), { type: "i128" });

/** Encode a UTF-8 string as ScVal. */
export const encodeString = (s: string): xdr.ScVal =>
  nativeToScVal(s, { type: "string" });

/** Encode a boolean as ScVal. */
export const encodeBool = (b: boolean): xdr.ScVal =>
  nativeToScVal(b, { type: "bool" });

/** Encode a Soroban symbol (used for compliance metadata keys). */
export const encodeSymbol = (s: string): xdr.ScVal =>
  nativeToScVal(s, { type: "symbol" });

// ── Internal map builder ──────────────────────────────────────────────────────

/**
 * Build an ScMap ScVal from an array of [symbolKey, scVal] pairs.
 * Keys are encoded as symbols (matching Soroban #[contracttype] struct fields).
 * Entries are sorted lexicographically by key as required by the XDR spec.
 */
function scMap(entries: [string, xdr.ScVal][]): xdr.ScVal {
  const sorted = [...entries].sort(([a], [b]) => a.localeCompare(b));
  return xdr.ScVal.scvMap(
    sorted.map(
      ([key, val]) =>
        new xdr.ScMapEntry({
          key: nativeToScVal(key, { type: "symbol" }),
          val,
        }),
    ),
  );
}

// ── Struct encoders ───────────────────────────────────────────────────────────

/**
 * Encode a ComplianceRules struct as an ScMap.
 * Field names and types must match the #[contracttype] declaration in
 * compliance-engine/src/lib.rs.
 */
export function encodeComplianceRules(rules: ComplianceRules): xdr.ScVal {
  return scMap([
    ["allowlist_mode",            encodeBool(rules.allowlist_mode)],
    ["max_holding_period",        encodeU64(rules.max_holding_period)],
    ["max_holders",               encodeU32(rules.max_holders)],
    ["max_transfer_amount",       encodeI128(rules.max_transfer_amount)],
    ["min_holding_period",        encodeU64(rules.min_holding_period)],
    ["paused",                    encodeBool(rules.paused)],
    ["require_same_jurisdiction", encodeBool(rules.require_same_jurisdiction)],
  ]);
}

/**
 * Encode a TierPolicy struct as an ScMap.
 * Field names and types must match the #[contracttype] declaration in
 * compliance-engine/src/lib.rs.
 */
export function encodeTierPolicy(policy: TierPolicy): xdr.ScVal {
  return scMap([
    ["blocked",             encodeBool(policy.blocked)],
    ["max_transfer_amount", encodeI128(policy.max_transfer_amount)],
    ["min_from_tier",       encodeU32(policy.min_from_tier)],
    ["min_to_tier",         encodeU32(policy.min_to_tier)],
  ]);
}

/**
 * Encode a RiskConfig struct as an ScMap.
 * Field names and types must match the #[contracttype] declaration in
 * compliance-engine/src/lib.rs.
 */
export function encodeRiskConfig(config: RiskConfig): xdr.ScVal {
  return scMap([
    ["default_score", encodeU32(config.default_score)],
    ["max_score",     encodeU32(config.max_score)],
  ]);
}

/**
 * Encode an InvoiceMeta struct as an ScMap.
 * Field names and types must match the #[contracttype] declaration in
 * invoice-token/src/lib.rs.
 */
export function encodeInvoiceMeta(meta: InvoiceMeta): xdr.ScVal {
  return scMap([
    ["currency",        encodeString(meta.currency)],
    ["debtor",          encodeString(meta.debtor)],
    ["discount_rate_bps", encodeU32(meta.discount_rate_bps)],
    ["due_date",        encodeU64(meta.due_date)],
    ["face_value_usd",  encodeI128(meta.face_value_usd)],
    ["fee_recipient",   meta.fee_recipient ? encodeAddress(meta.fee_recipient) : nativeToScVal(null)],
    ["invoice_id",      encodeString(meta.invoice_id)],
    ["ipfs_doc_hash",   encodeString(meta.ipfs_doc_hash)],
    ["issuer",          encodeString(meta.issuer)],
    ["notification_webhook", encodeString(meta.notification_webhook)],
    ["transfer_fee_bps", encodeU32(meta.transfer_fee_bps)],
  ]);
}

/**
 * Encode a PropertyMeta struct as an ScMap.
 * Field names and types must match the #[contracttype] declaration in
 * property-token/src/lib.rs.
 */
export function encodePropertyMeta(meta: PropertyMeta): xdr.ScVal {
  return scMap([
    ["address",             encodeString(meta.address)],
    ["ipfs_title_hash",     encodeString(meta.ipfs_title_hash)],
    ["jurisdiction",        encodeString(meta.jurisdiction)],
    ["kyc_tier_required",   encodeU32(meta.kyc_tier_required)],
    ["legal_name",          encodeString(meta.legal_name)],
    ["property_id",         encodeString(meta.property_id)],
    ["property_type",       encodeString(meta.property_type)],
    ["total_shares",        encodeI128(meta.total_shares)],
    ["total_valuation_usd", encodeI128(meta.total_valuation_usd)],
  ]);
}

/**
 * Encode a ProjectMeta (carbon credit) struct as an ScMap.
 * Field names and types must match the #[contracttype] declaration in
 * carbon-credit-token/src/lib.rs.
 */
export function encodeProjectMeta(meta: ProjectMeta): xdr.ScVal {
  return scMap([
    ["country",        encodeString(meta.country)],
    ["ipfs_cert_hash", encodeString(meta.ipfs_cert_hash)],
    ["project_id",     encodeString(meta.project_id)],
    ["project_name",   encodeString(meta.project_name)],
    ["project_type",   encodeString(meta.project_type)],
    ["registry_project_id", encodeString(meta.registry_project_id)],
    ["registry_url",   encodeString(meta.registry_url)],
    ["standard",       encodeString(meta.standard)],
    ["verifier",       encodeString(meta.verifier)],
    ["vintage_year",   encodeU32(meta.vintage_year)],
  ]);
}
