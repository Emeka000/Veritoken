import { BaseContractClient, type SignTx } from "./base.js";
import type { KycRecord } from "../types.js";
import { checkHealth, type ContractHealth, type HealthCheckOptions } from "../health.js";
import {
  encodeAddress,
  encodeU32,
  encodeU64,
  encodeString,
} from "../codec.js";
import type { rpc } from "@stellar/stellar-sdk";
import { withAuth, assertIsVerifier, assertIsAdmin } from "../auth.js";

export class KycRegistryClient extends BaseContractClient {
  constructor(
    contractId: string,
    server: rpc.Server,
    networkPassphrase: string,
  ) {
    super(contractId, server, networkPassphrase, "kyc");
  }

  // ── Health / analytics (#400) ─────────────────────────────────────────────

  /**
   * Return operational health signals for the KYC registry.
   * Extends the base signals with `verifierCount`.
   */
  async health(opts: HealthCheckOptions = {}): Promise<ContractHealth & { verifierCount: number | null }> {
    const base = await checkHealth(this.server, this.contractId, opts);
    if (!base.reachable) return { ...base, verifierCount: null };
    const result = await Promise.allSettled([this.verifierCount()]);
    return {
      ...base,
      verifierCount: result[0].status === "fulfilled" ? result[0].value : null,
    };
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
    return this.read<string[]>("get_verifiers", [
      encodeU32(start),
      encodeU32(limit),
    ]);
  }

  async verifierListPub(): Promise<string[]> {
    return this.read<string[]>("verifier_list_pub", []);
  }

  /** Registered contract admins. Used by the auth helpers' `assertIsAdmin` pre-check. */
  async getAdmins(): Promise<string[]> {
    return this.read<string[]>("get_admins", []);
  }

  // ── Write API ─────────────────────────────────────────────────────────────
  //
  // Verifier- and admin-gated writes below run a local pre-flight role check
  // (see sdk/src/auth.ts) before building the transaction: a wrong caller is
  // rejected immediately with a clear AuthError instead of a round trip to
  // simulation. On-chain `require_auth()` enforcement is unchanged either way.

  async approve(
    verifier: string,
    subject: string,
    tier: number,
    expiry: bigint,
    jurisdiction: string,
    signTx: SignTx,
  ): Promise<void> {
    await withAuth("verifier", verifier, () => assertIsVerifier(this, verifier), () =>
      this.write(
        "approve",
        [
          encodeAddress(verifier),
          encodeAddress(subject),
          encodeU32(tier),
          encodeU64(expiry),
          encodeString(jurisdiction),
        ],
        verifier,
        signTx,
      ),
    );
  }

  async reject(
    verifier: string,
    subject: string,
    signTx: SignTx,
  ): Promise<void> {
    await withAuth("verifier", verifier, () => assertIsVerifier(this, verifier), () =>
      this.write(
        "reject",
        [encodeAddress(verifier), encodeAddress(subject)],
        verifier,
        signTx,
      ),
    );
  }

  async revoke(
    verifier: string,
    subject: string,
    signTx: SignTx,
  ): Promise<void> {
    await withAuth("verifier", verifier, () => assertIsVerifier(this, verifier), () =>
      this.write(
        "revoke",
        [encodeAddress(verifier), encodeAddress(subject)],
        verifier,
        signTx,
      ),
    );
  }

  async updateTier(
    verifier: string,
    subject: string,
    newTier: number,
    signTx: SignTx,
  ): Promise<void> {
    await withAuth("verifier", verifier, () => assertIsVerifier(this, verifier), () =>
      this.write(
        "update_tier",
        [encodeAddress(verifier), encodeAddress(subject), encodeU32(newTier)],
        verifier,
        signTx,
      ),
    );
  }

  async addVerifier(
    adminAddress: string,
    verifier: string,
    signTx: SignTx,
  ): Promise<void> {
    await withAuth("admin", adminAddress, () => assertIsAdmin(this, adminAddress), () =>
      this.write(
        "add_verifier",
        [encodeAddress(adminAddress), encodeAddress(verifier)],
        adminAddress,
        signTx,
      ),
    );
  }

  async removeVerifier(
    adminAddress: string,
    verifier: string,
    signTx: SignTx,
  ): Promise<void> {
    await withAuth("admin", adminAddress, () => assertIsAdmin(this, adminAddress), () =>
      this.write(
        "remove_verifier",
        [encodeAddress(adminAddress), encodeAddress(verifier)],
        adminAddress,
        signTx,
      ),
    );
  }

  async addAdmin(
    callerAddress: string,
    newAdmin: string,
    signTx: SignTx,
  ): Promise<void> {
    await withAuth("admin", callerAddress, () => assertIsAdmin(this, callerAddress), () =>
      this.write(
        "add_admin",
        [encodeAddress(callerAddress), encodeAddress(newAdmin)],
        callerAddress,
        signTx,
      ),
    );
  }

  async removeAdmin(
    callerAddress: string,
    adminToRemove: string,
    signTx: SignTx,
  ): Promise<void> {
    await withAuth("admin", callerAddress, () => assertIsAdmin(this, callerAddress), () =>
      this.write(
        "remove_admin",
        [encodeAddress(callerAddress), encodeAddress(adminToRemove)],
        callerAddress,
        signTx,
      ),
    );
  }

  // ── Legacy XDR builders (kept for backward compat) ────────────────────────

  /** @deprecated Use `approve()` instead */
  buildApproveXdr(
    verifier: string,
    subject: string,
    tier: number,
    expiry: bigint,
    jurisdiction: string,
  ): string {
    return this.contract
      .call(
        "approve",
        encodeAddress(verifier),
        encodeAddress(subject),
        encodeU32(tier),
        encodeU64(expiry),
        encodeString(jurisdiction),
      )
      .toXDR("base64");
  }

  /** @deprecated Use `addVerifier()` instead */
  buildAddVerifierXdr(verifier: string): string {
    return this.contract
      .call("add_verifier", encodeAddress(verifier))
      .toXDR("base64");
  }

  /** @deprecated Use `removeVerifier()` instead */
  buildRemoveVerifierXdr(verifier: string): string {
    return this.contract
      .call("remove_verifier", encodeAddress(verifier))
      .toXDR("base64");
  }

  /** @deprecated Use `revoke()` instead */
  buildRevokeXdr(verifier: string, subject: string): string {
    return this.contract
      .call("revoke", encodeAddress(verifier), encodeAddress(subject))
      .toXDR("base64");
  }

  /** @deprecated Use `reject()` instead */
  buildRejectXdr(verifier: string, subject: string): string {
    return this.contract
      .call("reject", encodeAddress(verifier), encodeAddress(subject))
      .toXDR("base64");
  }
}
