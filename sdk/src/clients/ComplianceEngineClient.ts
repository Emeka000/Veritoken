import type { rpc } from "@stellar/stellar-sdk";
import { BaseContractClient, type SignTx } from "./base.js";
import type { ComplianceRules, TierPolicy, RiskConfig } from "../types.js";
import { checkHealth, type ContractHealth, type HealthCheckOptions } from "../health.js";
import {
  encodeAddress,
  encodeU32,
  encodeI128,
  encodeString,
  encodeComplianceRules,
  encodeTierPolicy,
  encodeRiskConfig,
} from "../codec.js";

export class ComplianceEngineClient extends BaseContractClient {
  constructor(
    contractId: string,
    server: rpc.Server,
    networkPassphrase: string,
  ) {
    super(contractId, server, networkPassphrase, "compliance");
  }

  // ── Health / analytics (#400) ─────────────────────────────────────────────

  /**
   * Return operational health signals for the compliance engine.
   * Extends the base signals with `paused` and `holderCount`.
   */
  async health(opts: HealthCheckOptions = {}): Promise<ContractHealth & { paused: boolean | null; holderCount: number | null }> {
    const base = await checkHealth(this.server, this.contractId, opts);
    if (!base.reachable) return { ...base, paused: null, holderCount: null };
    const [paused, holderCount] = await Promise.allSettled([
      this.getRules().then((r) => r.paused),
      this.holderCount(),
    ]);
    return {
      ...base,
      paused: paused.status === "fulfilled" ? paused.value : null,
      holderCount: holderCount.status === "fulfilled" ? holderCount.value : null,
    };
  }

  // ── Read API ──────────────────────────────────────────────────────────────

  async getRules(): Promise<ComplianceRules> {
    return this.read<ComplianceRules>("get_rules", []);
  }

  async isBlocklisted(addr: string): Promise<boolean> {
    return this.read<boolean>("is_blocklisted", [encodeAddress(addr)]);
  }

  async isAllowlisted(addr: string): Promise<boolean> {
    return this.read<boolean>("is_allowlisted", [encodeAddress(addr)]);
  }

  async canTransfer(from: string, to: string, amount: bigint): Promise<boolean> {
    return this.read<boolean>("can_transfer", [
      encodeAddress(from),
      encodeAddress(to),
      encodeI128(amount),
    ]);
  }

  async holderCount(): Promise<number> {
    return this.read<number>("holder_count", []);
  }

  async blocklistCount(): Promise<number> {
    return this.read<number>("blocklist_count", []);
  }

  async getBlocklist(start: number, limit: number): Promise<string[]> {
    return this.read<string[]>("get_blocklist", [
      encodeU32(start),
      encodeU32(limit),
    ]);
  }

  async getTierPolicy(
    fromTier: number,
    toTier: number,
  ): Promise<TierPolicy | null> {
    return this.read<TierPolicy | null>("get_tier_policy", [
      encodeU32(fromTier),
      encodeU32(toTier),
    ]);
  }

  async tierPolicyCount(): Promise<number> {
    return this.read<number>("tier_policy_count", []);
  }

  async getRiskConfig(): Promise<RiskConfig | null> {
    return this.read<RiskConfig | null>("get_risk_config", []);
  }

  async getJurisdictionRiskScore(
    jurisdiction: string,
  ): Promise<number | null> {
    return this.read<number | null>("get_jurisdiction_risk_score", [
      encodeString(jurisdiction),
    ]);
  }

  async evaluateTransferRisk(
    fromJurisdiction: string,
    toJurisdiction: string,
  ): Promise<[number, number, boolean]> {
    return this.read<[number, number, boolean]>("evaluate_transfer_risk", [
      encodeString(fromJurisdiction),
      encodeString(toJurisdiction),
    ]);
  }

  // ── Write API ─────────────────────────────────────────────────────────────

  async setRules(
    adminAddress: string,
    rules: ComplianceRules,
    signTx: SignTx,
  ): Promise<void> {
    await this.write(
      "set_rules",
      [encodeComplianceRules(rules)],
      adminAddress,
      signTx,
    );
  }

  async addToBlocklist(
    adminAddress: string,
    addr: string,
    signTx: SignTx,
  ): Promise<void> {
    await this.write(
      "add_to_blocklist",
      [encodeAddress(addr)],
      adminAddress,
      signTx,
    );
  }

  async removeFromBlocklist(
    adminAddress: string,
    addr: string,
    signTx: SignTx,
  ): Promise<void> {
    await this.write(
      "remove_from_blocklist",
      [encodeAddress(addr)],
      adminAddress,
      signTx,
    );
  }

  async addToAllowlist(
    adminAddress: string,
    addr: string,
    signTx: SignTx,
  ): Promise<void> {
    await this.write(
      "add_to_allowlist",
      [encodeAddress(addr)],
      adminAddress,
      signTx,
    );
  }

  async removeFromAllowlist(
    adminAddress: string,
    addr: string,
    signTx: SignTx,
  ): Promise<void> {
    await this.write(
      "remove_from_allowlist",
      [encodeAddress(addr)],
      adminAddress,
      signTx,
    );
  }

  async pause(adminAddress: string, signTx: SignTx): Promise<void> {
    await this.write("pause", [], adminAddress, signTx);
  }

  async unpause(adminAddress: string, signTx: SignTx): Promise<void> {
    await this.write("unpause", [], adminAddress, signTx);
  }

  async registerHolder(
    callerAddress: string,
    addr: string,
    signTx: SignTx,
  ): Promise<void> {
    await this.write(
      "register_holder",
      [encodeAddress(addr)],
      callerAddress,
      signTx,
    );
  }

  async unregisterHolder(
    callerAddress: string,
    addr: string,
    signTx: SignTx,
  ): Promise<void> {
    await this.write(
      "unregister_holder",
      [encodeAddress(addr)],
      callerAddress,
      signTx,
    );
  }

  async setTierPolicy(
    adminAddress: string,
    fromTier: number,
    toTier: number,
    policy: TierPolicy,
    signTx: SignTx,
  ): Promise<void> {
    await this.write(
      "set_tier_policy",
      [encodeU32(fromTier), encodeU32(toTier), encodeTierPolicy(policy)],
      adminAddress,
      signTx,
    );
  }

  async clearTierPolicy(
    adminAddress: string,
    fromTier: number,
    toTier: number,
    signTx: SignTx,
  ): Promise<void> {
    await this.write(
      "clear_tier_policy",
      [encodeU32(fromTier), encodeU32(toTier)],
      adminAddress,
      signTx,
    );
  }

  async setRiskConfig(
    adminAddress: string,
    config: RiskConfig,
    signTx: SignTx,
  ): Promise<void> {
    await this.write(
      "set_risk_config",
      [encodeRiskConfig(config)],
      adminAddress,
      signTx,
    );
  }

  async setJurisdictionRiskScore(
    adminAddress: string,
    jurisdiction: string,
    score: number,
    signTx: SignTx,
  ): Promise<void> {
    await this.write(
      "set_jurisdiction_risk_score",
      [encodeString(jurisdiction), encodeU32(score)],
      adminAddress,
      signTx,
    );
  }

  async clearJurisdictionRiskScore(
    adminAddress: string,
    jurisdiction: string,
    signTx: SignTx,
  ): Promise<void> {
    await this.write(
      "clear_jurisdiction_risk_score",
      [encodeString(jurisdiction)],
      adminAddress,
      signTx,
    );
  }

  // ── Legacy XDR builders ───────────────────────────────────────────────────

  /** @deprecated Use `setRules()` instead */
  buildSetRulesXdr(rules: ComplianceRules): string {
    return this.contract
      .call("set_rules", encodeComplianceRules(rules))
      .toXDR("base64");
  }

  /** @deprecated Use `addToBlocklist()` instead */
  buildAddToBlocklistXdr(addr: string): string {
    return this.contract
      .call("add_to_blocklist", encodeAddress(addr))
      .toXDR("base64");
  }

  /** @deprecated Use `removeFromBlocklist()` instead */
  buildRemoveFromBlocklistXdr(addr: string): string {
    return this.contract
      .call("remove_from_blocklist", encodeAddress(addr))
      .toXDR("base64");
  }

  /** @deprecated Use `pause()` instead */
  buildPauseXdr(): string {
    return this.contract.call("pause").toXDR("base64");
  }

  /** @deprecated Use `unpause()` instead */
  buildUnpauseXdr(): string {
    return this.contract.call("unpause").toXDR("base64");
  }

  /** @deprecated Use `setTierPolicy()` instead */
  buildSetTierPolicyXdr(
    fromTier: number,
    toTier: number,
    policy: TierPolicy,
  ): string {
    return this.contract
      .call(
        "set_tier_policy",
        encodeU32(fromTier),
        encodeU32(toTier),
        encodeTierPolicy(policy),
      )
      .toXDR("base64");
  }

  /** @deprecated Use `clearTierPolicy()` instead */
  buildClearTierPolicyXdr(fromTier: number, toTier: number): string {
    return this.contract
      .call("clear_tier_policy", encodeU32(fromTier), encodeU32(toTier))
      .toXDR("base64");
  }

  /** @deprecated Use `setRiskConfig()` instead */
  buildSetRiskConfigXdr(config: RiskConfig): string {
    return this.contract
      .call("set_risk_config", encodeRiskConfig(config))
      .toXDR("base64");
  }

  /** @deprecated Use `setJurisdictionRiskScore()` instead */
  buildSetJurisdictionRiskScoreXdr(
    jurisdiction: string,
    score: number,
  ): string {
    return this.contract
      .call(
        "set_jurisdiction_risk_score",
        encodeString(jurisdiction),
        encodeU32(score),
      )
      .toXDR("base64");
  }

  /** @deprecated Use `clearJurisdictionRiskScore()` instead */
  buildClearJurisdictionRiskScoreXdr(jurisdiction: string): string {
    return this.contract
      .call("clear_jurisdiction_risk_score", encodeString(jurisdiction))
      .toXDR("base64");
  }
}
