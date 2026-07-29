/**
 * Typed client for the compliance-engine Soroban contract.
 *
 * Contract functions covered:
 *   Read:  get_rules, is_blocklisted, can_transfer, holder_count,
 *          get_tier_policy, tier_policy_count
 *   Write: set_rules, add_to_blocklist, remove_from_blocklist, pause, unpause,
 *          register_holder, unregister_holder, set_tier_policy, clear_tier_policy
 */

import type { rpc } from "@stellar/stellar-sdk";
import type { ComplianceRules, TierPolicy, RiskConfig } from "../../types";
import {
  readCall,
  writeCall,
  fetchSequence,
  toAddress,
  toI128,
  toU32,
  type SignTx,
} from "./base";
import { nativeToScVal, xdr } from "@stellar/stellar-sdk";

// ── Internal map builder ──────────────────────────────────────────────────────

/**
 * Build an ScMap ScVal from an array of [symbolKey, scVal] pairs.
 * Entries are sorted lexicographically — required by the XDR spec.
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
 * Encode a `ComplianceRules` struct as a Soroban ScMap.
 * Field names must match the #[contracttype] declaration in compliance-engine.
 */
function encodeRules(rules: ComplianceRules): xdr.ScVal {
  return scMap([
    ["allowlist_mode",            nativeToScVal(rules.allowlist_mode, { type: "bool" })],
    ["max_holding_period",        nativeToScVal(BigInt(rules.max_holding_period), { type: "u64" })],
    ["max_holders",               nativeToScVal(rules.max_holders, { type: "u32" })],
    ["max_transfer_amount",       nativeToScVal(rules.max_transfer_amount, { type: "i128" })],
    ["min_holding_period",        nativeToScVal(BigInt(rules.min_holding_period), { type: "u64" })],
    ["paused",                    nativeToScVal(rules.paused, { type: "bool" })],
    ["require_same_jurisdiction", nativeToScVal(rules.require_same_jurisdiction, { type: "bool" })],
  ]);
}

/**
 * Encode a `TierPolicy` struct as a Soroban ScMap.
 * Field names must match the #[contracttype] declaration in compliance-engine.
 */
function encodeTierPolicy(policy: TierPolicy): xdr.ScVal {
  return scMap([
    ["blocked",             nativeToScVal(policy.blocked, { type: "bool" })],
    ["max_transfer_amount", nativeToScVal(policy.max_transfer_amount, { type: "i128" })],
    ["min_from_tier",       nativeToScVal(policy.min_from_tier, { type: "u32" })],
    ["min_to_tier",         nativeToScVal(policy.min_to_tier, { type: "u32" })],
  ]);
}

export class ComplianceEngineClient {
  constructor(
    private readonly contractId: string,
    private readonly server: rpc.Server
  ) {}

  // ── Read methods ──────────────────────────────────────────────────────────

  /** Returns the currently active compliance rule set. */
  async getRules(): Promise<ComplianceRules> {
    return readCall<ComplianceRules>(
      this.server,
      this.contractId,
      "get_rules",
      []
    );
  }

  /** Returns true when `addr` is on the transfer blocklist. */
  async isBlocklisted(addr: string): Promise<boolean> {
    return readCall<boolean>(this.server, this.contractId, "is_blocklisted", [
      toAddress(addr),
    ]);
  }

  /**
   * Returns true when the transfer would pass all compliance checks.
   * Does NOT submit a transaction.
   */
  async canTransfer(from: string, to: string, amount: bigint): Promise<boolean> {
    return readCall<boolean>(this.server, this.contractId, "can_transfer", [
      toAddress(from),
      toAddress(to),
      toI128(amount),
    ]);
  }

  /** Returns the current count of registered holders. */
  async holderCount(): Promise<number> {
    return readCall<number>(this.server, this.contractId, "holder_count", []);
  }

  /**
   * Returns pending rules and the Unix timestamp at which they can be
   * activated, or null when no rules are currently pending.
   */
  async getPendingRules(): Promise<{ rules: ComplianceRules; activateAt: number } | null> {
    try {
      const rules = await readCall<ComplianceRules>(
        this.server,
        this.contractId,
        "get_pending_rules",
        []
      );
      const activateAt = await readCall<number>(
        this.server,
        this.contractId,
        "get_pending_activate_at",
        []
      );
      return { rules, activateAt };
    } catch {
      return null;
    }
  }

  /**
   * Returns the configured rule-change delay in seconds (0 = immediate).
   */
  async getRuleChangeDelay(): Promise<number> {
    try {
      return await readCall<number>(
        this.server,
        this.contractId,
        "get_rule_change_delay",
        []
      );
    } catch {
      return 0;
    }
  }

  /** Returns the number of addresses currently on the blocklist. */
  async blocklistCount(): Promise<number> {
    return readCall<number>(this.server, this.contractId, "blocklist_count", []);
  }

  /** Returns a page of blocklisted addresses (`limit` capped at 50 on-chain). */
  async getBlocklist(start: number, limit: number): Promise<string[]> {
    return readCall<string[]>(this.server, this.contractId, "get_blocklist", [
      toU32(start),
      toU32(limit),
    ]);
  }

  // ── Write methods ─────────────────────────────────────────────────────────

  /** Replace the active compliance rules. Admin-only on-chain. */
  async setRules(
    adminAddress: string,
    rules: ComplianceRules,
    signTx: SignTx
  ): Promise<void> {
    const seq = await fetchSequence(this.server, adminAddress);
    await writeCall(
      this.server,
      this.contractId,
      "set_rules",
      [encodeRules(rules)],
      adminAddress,
      seq,
      signTx
    );
  }

  /**
   * Propose a new rule set subject to the configured time-lock delay.
   * Rules will not take effect until `activateRules` is called after
   * the delay has elapsed.  Admin-only on-chain.
   */
  async proposeRules(
    adminAddress: string,
    rules: ComplianceRules,
    signTx: SignTx
  ): Promise<void> {
    const seq = await fetchSequence(this.server, adminAddress);
    await writeCall(
      this.server,
      this.contractId,
      "propose_rules",
      [encodeRules(rules)],
      adminAddress,
      seq,
      signTx
    );
  }

  /**
   * Activate previously proposed rules once the time-lock delay has elapsed.
   * Admin-only on-chain.
   */
  async activateRules(adminAddress: string, signTx: SignTx): Promise<void> {
    const seq = await fetchSequence(this.server, adminAddress);
    await writeCall(
      this.server,
      this.contractId,
      "activate_rules",
      [],
      adminAddress,
      seq,
      signTx
    );
  }

  /** Add `addr` to the transfer blocklist. Admin-only on-chain. */
  async addToBlocklist(
    adminAddress: string,
    addr: string,
    signTx: SignTx
  ): Promise<void> {
    const seq = await fetchSequence(this.server, adminAddress);
    await writeCall(
      this.server,
      this.contractId,
      "add_to_blocklist",
      [toAddress(addr)],
      adminAddress,
      seq,
      signTx
    );
  }

  /** Remove `addr` from the transfer blocklist. Admin-only on-chain. */
  async removeFromBlocklist(
    adminAddress: string,
    addr: string,
    signTx: SignTx
  ): Promise<void> {
    const seq = await fetchSequence(this.server, adminAddress);
    await writeCall(
      this.server,
      this.contractId,
      "remove_from_blocklist",
      [toAddress(addr)],
      adminAddress,
      seq,
      signTx
    );
  }

  /** Halt all transfers. Admin-only on-chain. */
  async pause(adminAddress: string, signTx: SignTx): Promise<void> {
    const seq = await fetchSequence(this.server, adminAddress);
    await writeCall(
      this.server,
      this.contractId,
      "pause",
      [],
      adminAddress,
      seq,
      signTx
    );
  }

  /** Resume transfers. Admin-only on-chain. */
  async unpause(adminAddress: string, signTx: SignTx): Promise<void> {
    const seq = await fetchSequence(this.server, adminAddress);
    await writeCall(
      this.server,
      this.contractId,
      "unpause",
      [],
      adminAddress,
      seq,
      signTx
    );
  }

  /** Register a new holder (called after mint/transfer-in). */
  async registerHolder(
    callerAddress: string,
    addr: string,
    signTx: SignTx
  ): Promise<void> {
    const seq = await fetchSequence(this.server, callerAddress);
    await writeCall(
      this.server,
      this.contractId,
      "register_holder",
      [toAddress(addr)],
      callerAddress,
      seq,
      signTx
    );
  }

  /** Unregister a holder whose balance has dropped to zero. */
  async unregisterHolder(
    callerAddress: string,
    addr: string,
    signTx: SignTx
  ): Promise<void> {
    const seq = await fetchSequence(this.server, callerAddress);
    await writeCall(
      this.server,
      this.contractId,
      "unregister_holder",
      [toAddress(addr)],
      callerAddress,
      seq,
      signTx
    );
  }

  // ── Allowlist ─────────────────────────────────────────────────────────────

  /** Returns true when `addr` is on the allowlist. */
  async isAllowlisted(addr: string): Promise<boolean> {
    return readCall<boolean>(this.server, this.contractId, "is_allowlisted", [
      toAddress(addr),
    ]);
  }

  /** Add `addr` to the allowlist. Admin-only on-chain. */
  async addToAllowlist(
    adminAddress: string,
    addr: string,
    signTx: SignTx
  ): Promise<void> {
    const seq = await fetchSequence(this.server, adminAddress);
    await writeCall(
      this.server,
      this.contractId,
      "add_to_allowlist",
      [toAddress(addr)],
      adminAddress,
      seq,
      signTx
    );
  }

  /** Remove `addr` from the allowlist. Admin-only on-chain. */
  async removeFromAllowlist(
    adminAddress: string,
    addr: string,
    signTx: SignTx
  ): Promise<void> {
    const seq = await fetchSequence(this.server, adminAddress);
    await writeCall(
      this.server,
      this.contractId,
      "remove_from_allowlist",
      [toAddress(addr)],
      adminAddress,
      seq,
      signTx
    );
  }

  // ── Attestation (#370) ────────────────────────────────────────────────────

  /**
   * Record an off-chain attestation reference on-chain.
   * Stores the attestation id, type, and reference URL linked to a subject.
   * Admin-only on-chain.
   */
  async recordAttestation(
    adminAddress: string,
    record: import("../../types").AttestationRecord,
    signTx: SignTx
  ): Promise<void> {
    const seq = await fetchSequence(this.server, adminAddress);
    await writeCall(
      this.server,
      this.contractId,
      "record_attestation",
      [
        toAddress(record.subject),
        nativeToScVal(record.id, { type: "string" }),
        nativeToScVal(record.attestation_type, { type: "string" }),
        nativeToScVal(record.reference_url, { type: "string" }),
        nativeToScVal(record.issuer, { type: "string" }),
        nativeToScVal(record.issued_at, { type: "u64" }),
        nativeToScVal(record.notes ?? "", { type: "string" }),
      ],
      adminAddress,
      seq,
      signTx
    );
  }

  // ── Tier-based policy ─────────────────────────────────────────────────────

  /**
   * Returns the tier policy for the given (fromTier, toTier) pair.
   * Returns null when no policy is configured for this pair.
   *
   * Use `0xFFFFFFFF` as a wildcard tier value.
   */
  async getTierPolicy(fromTier: number, toTier: number): Promise<TierPolicy | null> {
    return readCall<TierPolicy | null>(
      this.server,
      this.contractId,
      "get_tier_policy",
      [toU32(fromTier), toU32(toTier)]
    );
  }

  /** Returns the total number of configured tier policy entries. */
  async tierPolicyCount(): Promise<number> {
    return readCall<number>(this.server, this.contractId, "tier_policy_count", []);
  }

  /**
   * Admin-only: set or update the transfer policy for a KYC tier pair.
   *
   * Use `0xFFFFFFFF` (4294967295) as a wildcard for either tier.
   * Exact (fromTier, toTier) matches take precedence over wildcards.
   *
   * @example Block retail (tier 0) → institutional (tier 2) transfers
   * ```ts
   * await contracts.compliance.setTierPolicy(admin, 0, 2,
   *   { blocked: true, max_transfer_amount: 0n, min_from_tier: 0, min_to_tier: 0 },
   *   signTx
   * );
   * ```
   *
   * @example Require accredited status (tier >= 1) for all recipients
   * ```ts
   * await contracts.compliance.setTierPolicy(admin, 0xFFFFFFFF, 0xFFFFFFFF,
   *   { blocked: false, max_transfer_amount: 0n, min_from_tier: 0, min_to_tier: 1 },
   *   signTx
   * );
   * ```
   */
  async setTierPolicy(
    adminAddress: string,
    fromTier: number,
    toTier: number,
    policy: TierPolicy,
    signTx: SignTx
  ): Promise<void> {
    const seq = await fetchSequence(this.server, adminAddress);
    await writeCall(
      this.server,
      this.contractId,
      "set_tier_policy",
      [toU32(fromTier), toU32(toTier), encodeTierPolicy(policy)],
      adminAddress,
      seq,
      signTx
    );
  }

  /**
   * Admin-only: remove the tier policy for the given (fromTier, toTier) pair.
   * No-ops if no policy exists for the pair.
   */
  async clearTierPolicy(
    adminAddress: string,
    fromTier: number,
    toTier: number,
    signTx: SignTx
  ): Promise<void> {
    const seq = await fetchSequence(this.server, adminAddress);
    await writeCall(
      this.server,
      this.contractId,
      "clear_tier_policy",
      [toU32(fromTier), toU32(toTier)],
      adminAddress,
      seq,
      signTx
    );
  }

  // ── Jurisdiction risk scoring ─────────────────────────────────────────────

  /**
   * Returns the current risk configuration.
   * Returns null when no config has been set (risk scoring is inactive).
   */
  async getRiskConfig(): Promise<RiskConfig | null> {
    return readCall<RiskConfig | null>(this.server, this.contractId, "get_risk_config", []);
  }

  /**
   * Returns the explicit risk score for a jurisdiction, or null if unset.
   * When null the `default_score` from RiskConfig applies.
   */
  async getJurisdictionRiskScore(jurisdiction: string): Promise<number | null> {
    return readCall<number | null>(
      this.server,
      this.contractId,
      "get_jurisdiction_risk_score",
      [nativeToScVal(jurisdiction, { type: "string" })]
    );
  }

  /**
   * Compute the effective risk scores for a proposed transfer.
   * Returns `[fromScore, toScore, blocked]`.
   * All values are `[0, 0, false]` when risk scoring is inactive.
   */
  async evaluateTransferRisk(
    fromJurisdiction: string,
    toJurisdiction: string
  ): Promise<[number, number, boolean]> {
    return readCall<[number, number, boolean]>(
      this.server,
      this.contractId,
      "evaluate_transfer_risk",
      [
        nativeToScVal(fromJurisdiction, { type: "string" }),
        nativeToScVal(toJurisdiction, { type: "string" }),
      ]
    );
  }

  /**
   * Admin-only: set or update the global risk configuration.
   * Set `max_score = 0` to disable risk scoring.
   *
   * @example Block FATF-grey-list countries (score > 49):
   * ```ts
   * await contracts.compliance.setRiskConfig(admin,
   *   { max_score: 49, default_score: 0 }, signTx);
   * ```
   */
  async setRiskConfig(
    adminAddress: string,
    config: RiskConfig,
    signTx: SignTx
  ): Promise<void> {
    const seq = await fetchSequence(this.server, adminAddress);
    const encoded = scMap([
      ["default_score", nativeToScVal(config.default_score, { type: "u32" })],
      ["max_score",     nativeToScVal(config.max_score, { type: "u32" })],
    ]);
    await writeCall(
      this.server,
      this.contractId,
      "set_risk_config",
      [encoded],
      adminAddress,
      seq,
      signTx
    );
  }

  /**
   * Retrieve attestations recorded for a given subject address.
   * Returns an empty array when none exist or the contract function is
   * not yet deployed.
   */
  async getAttestations(
    subject: string
  ): Promise<import("../../types").AttestationRecord[]> {
    try {
      return await readCall<import("../../types").AttestationRecord[]>(
        this.server,
        this.contractId,
        "get_attestations",
        [toAddress(subject)]
      );
    } catch {
      return [];
    }
  }

  /**
   * Admin-only: assign a risk score (0–100) to a jurisdiction.
   * `jurisdiction` must be a 2-letter ISO-3166-1 alpha-2 code.
   *
   * @example Block North Korea:
   * ```ts
   * await contracts.compliance.setJurisdictionRiskScore(admin, "KP", 100, signTx);
   * ```
   */
  async setJurisdictionRiskScore(
    adminAddress: string,
    jurisdiction: string,
    score: number,
    signTx: SignTx
  ): Promise<void> {
    const seq = await fetchSequence(this.server, adminAddress);
    await writeCall(
      this.server,
      this.contractId,
      "set_jurisdiction_risk_score",
      [nativeToScVal(jurisdiction, { type: "string" }), toU32(score)],
      adminAddress,
      seq,
      signTx
    );
  }

  /**
   * Admin-only: remove the explicit risk score for a jurisdiction.
   * The `default_score` from RiskConfig will apply after removal.
   */
  async clearJurisdictionRiskScore(
    adminAddress: string,
    jurisdiction: string,
    signTx: SignTx
  ): Promise<void> {
    const seq = await fetchSequence(this.server, adminAddress);
    await writeCall(
      this.server,
      this.contractId,
      "clear_jurisdiction_risk_score",
      [nativeToScVal(jurisdiction, { type: "string" })],
      adminAddress,
      seq,
      signTx
    );
  }
}


