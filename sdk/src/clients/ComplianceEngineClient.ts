import { Address, nativeToScVal, rpc } from "@stellar/stellar-sdk";
import { BaseContractClient, scVal } from "./base.js";
import type { ComplianceRules, TierPolicy, RiskConfig } from "../types.js";

export class ComplianceEngineClient extends BaseContractClient {
  constructor(contractId: string, server: rpc.Server, networkPassphrase: string) {
    super(contractId, server, networkPassphrase);
  }

  // ── Read API ─────────────────────────────────────────────────────────────

  async getRules(): Promise<ComplianceRules> {
    return scVal<ComplianceRules>(await this.simulate("get_rules", []));
  }

  async isBlocklisted(addr: string): Promise<boolean> {
    return scVal<boolean>(
      await this.simulate("is_blocklisted", [new Address(addr).toScVal()]),
    );
  }

  async canTransfer(from: string, to: string, amount: bigint): Promise<boolean> {
    return scVal<boolean>(
      await this.simulate("can_transfer", [
        new Address(from).toScVal(),
        new Address(to).toScVal(),
        nativeToScVal(amount, { type: "i128" }),
      ]),
    );
  }

  async holderCount(): Promise<number> {
    return scVal<number>(await this.simulate("holder_count", []));
  }

  // ── Tier policy read API ──────────────────────────────────────────────────

  /**
   * Returns the tier policy for the given (fromTier, toTier) pair.
   * Returns null when no policy has been configured for this pair.
   *
   * Use `0xFFFFFFFF` (2^32 - 1) as a wildcard tier.
   */
  async getTierPolicy(fromTier: number, toTier: number): Promise<TierPolicy | null> {
    return scVal<TierPolicy | null>(
      await this.simulate("get_tier_policy", [
        nativeToScVal(fromTier, { type: "u32" }),
        nativeToScVal(toTier, { type: "u32" }),
      ]),
    );
  }

  /** Returns the total number of configured tier policy entries. */
  async tierPolicyCount(): Promise<number> {
    return scVal<number>(await this.simulate("tier_policy_count", []));
  }

  // ── Transaction builders (return operation XDR for signing) ───────────────

  buildSetRulesXdr(rules: ComplianceRules): string {
    return this.buildCallXdr("set_rules", [nativeToScVal(rules)]);
  }

  buildAddToBlocklistXdr(addr: string): string {
    return this.buildCallXdr("add_to_blocklist", [new Address(addr).toScVal()]);
  }

  buildRemoveFromBlocklistXdr(addr: string): string {
    return this.buildCallXdr("remove_from_blocklist", [new Address(addr).toScVal()]);
  }

  buildPauseXdr(): string {
    return this.buildCallXdr("pause", []);
  }

  buildUnpauseXdr(): string {
    return this.buildCallXdr("unpause", []);
  }

  /**
   * Admin-only: set or update the transfer policy for a (fromTier, toTier) pair.
   *
   * Use `0xFFFFFFFF` as a wildcard.  Exact matches take precedence over wildcards.
   *
   * ## Example — block retail → institutional transfers
   * ```ts
   * ce.buildSetTierPolicyXdr(0, 2, { blocked: true, max_transfer_amount: 0n, min_from_tier: 0, min_to_tier: 0 })
   * ```
   *
   * ## Example — raise transfer cap for institutional senders
   * ```ts
   * ce.buildSetTierPolicyXdr(2, 0xFFFFFFFF, {
   *   blocked: false, max_transfer_amount: 10_000_000_0000000n,
   *   min_from_tier: 2, min_to_tier: 0
   * })
   * ```
   */
  buildSetTierPolicyXdr(fromTier: number, toTier: number, policy: TierPolicy): string {
    return this.buildCallXdr("set_tier_policy", [
      nativeToScVal(fromTier, { type: "u32" }),
      nativeToScVal(toTier, { type: "u32" }),
      nativeToScVal(
        {
          blocked: policy.blocked,
          max_transfer_amount: policy.max_transfer_amount,
          min_from_tier: policy.min_from_tier,
          min_to_tier: policy.min_to_tier,
        },
        {
          type: {
            blocked: ["bool"],
            max_transfer_amount: ["i128"],
            min_from_tier: ["u32"],
            min_to_tier: ["u32"],
          },
        },
      ),
    ]);
  }

  /** Admin-only: remove the tier policy for the given (fromTier, toTier) pair. */
  buildClearTierPolicyXdr(fromTier: number, toTier: number): string {
    return this.buildCallXdr("clear_tier_policy", [
      nativeToScVal(fromTier, { type: "u32" }),
      nativeToScVal(toTier, { type: "u32" }),
    ]);
  }

  // ── Jurisdiction risk scoring ─────────────────────────────────────────────

  /**
   * Returns the current risk configuration, or null if never set
   * (meaning risk scoring is inactive).
   */
  async getRiskConfig(): Promise<RiskConfig | null> {
    return scVal<RiskConfig | null>(await this.simulate("get_risk_config", []));
  }

  /**
   * Returns the explicit risk score for a jurisdiction, or null if unset.
   * When null the `default_score` from RiskConfig applies.
   */
  async getJurisdictionRiskScore(jurisdiction: string): Promise<number | null> {
    return scVal<number | null>(
      await this.simulate("get_jurisdiction_risk_score", [
        nativeToScVal(jurisdiction, { type: "string" }),
      ]),
    );
  }

  /**
   * Compute the effective risk scores for a transfer's two parties.
   *
   * Returns `[fromScore, toScore, blocked]`.
   * `blocked` is true when either score exceeds `max_score`.
   * All values are 0 / false when risk scoring is inactive (`max_score == 0`).
   *
   * @example Preview whether a US→KP transfer would be blocked
   * ```ts
   * const [fromScore, toScore, blocked] = await ce.evaluateTransferRisk("US", "KP");
   * ```
   */
  async evaluateTransferRisk(
    fromJurisdiction: string,
    toJurisdiction: string,
  ): Promise<[number, number, boolean]> {
    return scVal<[number, number, boolean]>(
      await this.simulate("evaluate_transfer_risk", [
        nativeToScVal(fromJurisdiction, { type: "string" }),
        nativeToScVal(toJurisdiction, { type: "string" }),
      ]),
    );
  }

  /**
   * Admin-only: set the global risk configuration.
   *
   * Set `max_score = 0` to disable risk scoring entirely.
   *
   * @example Enable scoring with strict default (unknown = high-risk)
   * ```ts
   * ce.buildSetRiskConfigXdr({ max_score: 49, default_score: 75 })
   * ```
   */
  buildSetRiskConfigXdr(config: RiskConfig): string {
    return this.buildCallXdr("set_risk_config", [
      nativeToScVal(
        { max_score: config.max_score, default_score: config.default_score },
        { type: { max_score: ["u32"], default_score: ["u32"] } },
      ),
    ]);
  }

  /**
   * Admin-only: assign a risk score (0–100) to a jurisdiction.
   * `jurisdiction` must be a 2-letter ISO-3166-1 alpha-2 code.
   */
  buildSetJurisdictionRiskScoreXdr(jurisdiction: string, score: number): string {
    return this.buildCallXdr("set_jurisdiction_risk_score", [
      nativeToScVal(jurisdiction, { type: "string" }),
      nativeToScVal(score, { type: "u32" }),
    ]);
  }

  /** Admin-only: remove the explicit risk score for a jurisdiction. */
  buildClearJurisdictionRiskScoreXdr(jurisdiction: string): string {
    return this.buildCallXdr("clear_jurisdiction_risk_score", [
      nativeToScVal(jurisdiction, { type: "string" }),
    ]);
  }
}
