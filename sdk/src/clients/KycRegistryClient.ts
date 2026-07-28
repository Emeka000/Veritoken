import { nativeToScVal, rpc } from "@stellar/stellar-sdk";
import { BaseContractClient, type SignTx } from "./base.js";
import {
  encodeAddress, encodeU32, encodeU64, encodeString,
} from "../codec.js";
import type { KycRecord } from "../types.js";

export class KycRegistryClient extends BaseContractClient {
  constructor(contractId: string, server: rpc.Server, networkPassphrase: string) {
    super(contractId, server, networkPassphrase, "kyc");
  }

  // ── Read API ──────────────────────────────────────────────────────────────

  async isApproved(addr: string): Promise<boolean> {
    return this.read<boolean>("is_approved", [encodeAddress(addr)]);
  }

  async getRecord(addr: string): Promise<KycRecord> {
    return this.read<KycRecord>("get_record", [encodeAddress(addr)]);
  }

  async getTier(addr: string): Promise<number> {
    return this.read<number>("get_tier", [encodeAddress(addr)]);
  }

  async verifierCount(): Promise<number> {
    return this.read<number>("verifier_count", []);
  }

  async getVerifiers(start: number, limit: number): Promise<string[]> {
    return this.read<string[]>("get_verifiers", [encodeU32(start), encodeU32(limit)]);
  }

  // ── Write API ─────────────────────────────────────────────────────────────

  async approve(
    verifier: string, subject: string, tier: number,
    expiry: bigint, jurisdiction: string, signTx: SignTx,
  ): Promise<void> {
    await this.write("approve", [
      encodeAddress(verifier), encodeAddress(subject),
      encodeU32(tier), encodeU64(expiry), encodeString(jurisdiction),
    ], verifier, signTx);
  }

  async reject(verifier: string, subject: string, signTx: SignTx): Promise<void> {
    await this.write("reject", [encodeAddress(verifier), encodeAddress(subject)], verifier, signTx);
  }

  async revoke(verifier: string, subject: string, signTx: SignTx): Promise<void> {
    await this.write("revoke", [encodeAddress(verifier), encodeAddress(subject)], verifier, signTx);
  }

  async addVerifier(adminAddress: string, verifier: string, signTx: SignTx): Promise<void> {
    await this.write("add_verifier", [encodeAddress(adminAddress), encodeAddress(verifier)], adminAddress, signTx);
  }

  async removeVerifier(adminAddress: string, verifier: string, signTx: SignTx): Promise<void> {
    await this.write("remove_verifier", [encodeAddress(adminAddress), encodeAddress(verifier)], adminAddress, signTx);
  }

  // ── Legacy XDR builders (kept for backward compat) ────────────────────────

  /** @deprecated Use approve() instead */
  buildApproveXdr(verifier: string, subject: string, tier: number, expiry: bigint, jurisdiction: string): string {
    return this.contract.call("approve",
      encodeAddress(verifier), encodeAddress(subject),
      encodeU32(tier), encodeU64(expiry), encodeString(jurisdiction),
    ).toXDR("base64");
  }

  /** @deprecated Use addVerifier() instead */
  buildAddVerifierXdr(verifier: string): string {
    return this.contract.call("add_verifier", encodeAddress(verifier)).toXDR("base64");
  }

  /** @deprecated Use removeVerifier() instead */
  buildRemoveVerifierXdr(verifier: string): string {
    return this.contract.call("remove_verifier", encodeAddress(verifier)).toXDR("base64");
  }

  /** @deprecated Use revoke() instead */
  buildRevokeXdr(verifier: string, subject: string): string {
    return this.contract.call("revoke", encodeAddress(verifier), encodeAddress(subject)).toXDR("base64");
  }

  /** @deprecated Use reject() instead */
  buildRejectXdr(verifier: string, subject: string): string {
    return this.contract.call("reject", encodeAddress(verifier), encodeAddress(subject)).toXDR("base64");
  }
}
