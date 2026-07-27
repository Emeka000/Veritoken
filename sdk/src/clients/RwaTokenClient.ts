import { Address, nativeToScVal, rpc } from "@stellar/stellar-sdk";
import { BaseContractClient, scVal } from "./base.js";
import type { TokenExportMetadata, KycSyncStatus } from "../types.js";

export class RwaTokenClient extends BaseContractClient {
  constructor(contractId: string, server: rpc.Server, networkPassphrase: string) {
    super(contractId, server, networkPassphrase);
  }

  // ── Read API ─────────────────────────────────────────────────────────────

  async balance(addr: string): Promise<bigint> {
    return scVal<bigint>(
      await this.simulate("balance", [new Address(addr).toScVal()]),
    );
  }

  async totalSupply(): Promise<bigint> {
    return scVal<bigint>(await this.simulate("total_supply", []));
  }

  async allowance(from: string, spender: string): Promise<bigint> {
    return scVal<bigint>(
      await this.simulate("allowance", [
        new Address(from).toScVal(),
        new Address(spender).toScVal(),
      ]),
    );
  }

  async name(): Promise<string> {
    return scVal<string>(await this.simulate("name", []));
  }

  async symbol(): Promise<string> {
    return scVal<string>(await this.simulate("symbol", []));
  }

  async decimals(): Promise<number> {
    return scVal<number>(await this.simulate("decimals", []));
  }

  async assetType(): Promise<string> {
    return scVal<string>(await this.simulate("asset_type", []));
  }

  async kycRegistry(): Promise<string> {
    return scVal<string>(await this.simulate("kyc_registry", []));
  }

  async complianceEngine(): Promise<string> {
    return scVal<string>(await this.simulate("compliance_engine", []));
  }

  async getComplianceMetadata(key: string): Promise<string> {
    return scVal<string>(
      await this.simulate("get_compliance_metadata", [
        nativeToScVal(key, { type: "symbol" }),
      ]),
    );
  }

  /**
   * Returns the canonical metadata export snapshot for external integrations.
   *
   * This single call aggregates all token, compliance, and supply fields that
   * explorers and indexers need.  No auth is required — it is a pure read.
   *
   * ## Explorer integration example
   * ```ts
   * const meta = await rwaClient.getTokenExport();
   * console.log(meta.name, meta.isin, meta.external_uri);
   * ```
   */
  async getTokenExport(): Promise<TokenExportMetadata> {
    return scVal<TokenExportMetadata>(await this.simulate("get_token_export", []));
  }

  /**
   * Returns the optional external URI stored on-chain.
   * Returns an empty string when unset.
   */
  async getExternalUri(): Promise<string> {
    return scVal<string>(await this.simulate("get_external_uri", []));
  }

  // ── KYC synchronization ───────────────────────────────────────────────────

  /**
   * Read-only: returns the live KYC status for `addr` as a single snapshot.
   *
   * Fetches the current record from the linked KYC registry and evaluates
   * whether the address is truly active right now — accounting for both
   * status (Approved/Revoked/Rejected) and expiry.
   *
   * Use this to refresh wallet KYC state in the UI before showing transfer
   * controls, or after receiving a `kyc_stale` event.
   *
   * @example
   * ```ts
   * const status = await rwa.checkKycStatus(walletAddress);
   * if (!status.is_active) showExpiredKycBanner();
   * ```
   */
  async checkKycStatus(addr: string): Promise<KycSyncStatus> {
    return scVal<KycSyncStatus>(
      await this.simulate("check_kyc_status", [new Address(addr).toScVal()]),
    );
  }

  /**
   * Permissionless: verify `addr`'s live KYC state on-chain and emit a
   * `kyc_stale` event.  Returns true when the KYC is still active.
   *
   * Anyone may call this — no auth required.  Use it from automation scripts
   * or keeper bots to broadcast KYC state changes to all event subscribers.
   *
   * Frontends should subscribe to `kyc_stale` events on the token contract
   * and call `checkKycStatus` to refresh their local cache when they appear.
   */
  buildSyncKycStatusXdr(addr: string): string {
    return this.buildCallXdr("sync_kyc_status", [new Address(addr).toScVal()]);
  }

  // ── Transaction builders (return operation XDR for signing) ───────────────

  buildMintXdr(to: string, amount: bigint): string {
    return this.buildCallXdr("mint", [
      new Address(to).toScVal(),
      nativeToScVal(amount, { type: "i128" }),
    ]);
  }

  buildTransferXdr(from: string, to: string, amount: bigint): string {
    return this.buildCallXdr("transfer", [
      new Address(from).toScVal(),
      new Address(to).toScVal(),
      nativeToScVal(amount, { type: "i128" }),
    ]);
  }

  buildTransferFromXdr(
    spender: string,
    from: string,
    to: string,
    amount: bigint,
  ): string {
    return this.buildCallXdr("transfer_from", [
      new Address(spender).toScVal(),
      new Address(from).toScVal(),
      new Address(to).toScVal(),
      nativeToScVal(amount, { type: "i128" }),
    ]);
  }

  buildApproveXdr(
    from: string,
    spender: string,
    amount: bigint,
    expirationLedger: number,
  ): string {
    return this.buildCallXdr("approve", [
      new Address(from).toScVal(),
      new Address(spender).toScVal(),
      nativeToScVal(amount, { type: "i128" }),
      nativeToScVal(expirationLedger, { type: "u32" }),
    ]);
  }

  buildBurnXdr(from: string, amount: bigint): string {
    return this.buildCallXdr("burn", [
      new Address(from).toScVal(),
      nativeToScVal(amount, { type: "i128" }),
    ]);
  }

  buildBurnFromXdr(spender: string, from: string, amount: bigint): string {
    return this.buildCallXdr("burn_from", [
      new Address(spender).toScVal(),
      new Address(from).toScVal(),
      nativeToScVal(amount, { type: "i128" }),
    ]);
  }

  buildSetAdminXdr(newAdmin: string): string {
    return this.buildCallXdr("set_admin", [new Address(newAdmin).toScVal()]);
  }

  buildSetComplianceMetadataXdr(key: string, value: string): string {
    return this.buildCallXdr("set_compliance_metadata", [
      nativeToScVal(key, { type: "symbol" }),
      nativeToScVal(value, { type: "string" }),
    ]);
  }

  /**
   * Admin-only: set or clear the external metadata URI.
   * Pass an empty string to remove the URI.
   */
  buildSetExternalUriXdr(uri: string): string {
    return this.buildCallXdr("set_external_uri", [
      nativeToScVal(uri, { type: "string" }),
    ]);
  }
}
