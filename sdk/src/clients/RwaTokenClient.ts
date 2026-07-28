import { rpc } from "@stellar/stellar-sdk";
import { BaseContractClient, type SignTx } from "./base.js";
import { encodeAddress, encodeI128, encodeU32, encodeString, encodeSymbol } from "../codec.js";
import type { TokenExportMetadata, KycSyncStatus } from "../types.js";

export class RwaTokenClient extends BaseContractClient {
  constructor(contractId: string, server: rpc.Server, networkPassphrase: string) {
    super(contractId, server, networkPassphrase, "rwa");
  }

  async balance(addr: string): Promise<bigint> { return this.read<bigint>("balance", [encodeAddress(addr)]); }
  async totalSupply(): Promise<bigint> { return this.read<bigint>("total_supply", []); }
  async allowance(from: string, spender: string): Promise<bigint> {
    return this.read<bigint>("allowance", [encodeAddress(from), encodeAddress(spender)]);
  }
  async name(): Promise<string> { return this.read<string>("name", []); }
  async symbol(): Promise<string> { return this.read<string>("symbol", []); }
  async decimals(): Promise<number> { return this.read<number>("decimals", []); }
  async assetType(): Promise<string> { return this.read<string>("asset_type", []); }
  async kycRegistry(): Promise<string> { return this.read<string>("kyc_registry", []); }
  async complianceEngine(): Promise<string> { return this.read<string>("compliance_engine", []); }
  async getComplianceMetadata(key: string): Promise<string> {
    return this.read<string>("get_compliance_metadata", [encodeSymbol(key)]);
  }
  async getTokenExport(): Promise<TokenExportMetadata> {
    return this.read<TokenExportMetadata>("get_token_export", []);
  }
  async getExternalUri(): Promise<string> { return this.read<string>("get_external_uri", []); }
  async checkKycStatus(addr: string): Promise<KycSyncStatus> {
    return this.read<KycSyncStatus>("check_kyc_status", [encodeAddress(addr)]);
  }

  async mint(adminAddress: string, to: string, amount: bigint, signTx: SignTx): Promise<void> {
    await this.write("mint", [encodeAddress(to), encodeI128(amount)], adminAddress, signTx);
  }
  async transfer(fromAddress: string, to: string, amount: bigint, signTx: SignTx): Promise<void> {
    await this.write("transfer", [encodeAddress(fromAddress), encodeAddress(to), encodeI128(amount)], fromAddress, signTx);
  }
  async transferFrom(spenderAddress: string, from: string, to: string, amount: bigint, signTx: SignTx): Promise<void> {
    await this.write("transfer_from",
      [encodeAddress(spenderAddress), encodeAddress(from), encodeAddress(to), encodeI128(amount)],
      spenderAddress, signTx);
  }
  async approve(fromAddress: string, spender: string, amount: bigint, expirationLedger: number, signTx: SignTx): Promise<void> {
    await this.write("approve",
      [encodeAddress(fromAddress), encodeAddress(spender), encodeI128(amount), encodeU32(expirationLedger)],
      fromAddress, signTx);
  }
  async burn(fromAddress: string, amount: bigint, signTx: SignTx): Promise<void> {
    await this.write("burn", [encodeAddress(fromAddress), encodeI128(amount)], fromAddress, signTx);
  }
  async setExternalUri(adminAddress: string, uri: string, signTx: SignTx): Promise<void> {
    await this.write("set_external_uri", [encodeString(uri)], adminAddress, signTx);
  }
  async syncKycStatus(callerAddress: string, addr: string, signTx: SignTx): Promise<void> {
    await this.write("sync_kyc_status", [encodeAddress(addr)], callerAddress, signTx);
  }

  /** @deprecated Use syncKycStatus() instead */
  buildSyncKycStatusXdr(addr: string): string {
    return this.contract.call("sync_kyc_status", encodeAddress(addr)).toXDR("base64");
  }
  /** @deprecated Use mint() instead */
  buildMintXdr(to: string, amount: bigint): string {
    return this.contract.call("mint", encodeAddress(to), encodeI128(amount)).toXDR("base64");
  }
  /** @deprecated Use transfer() instead */
  buildTransferXdr(from: string, to: string, amount: bigint): string {
    return this.contract.call("transfer", encodeAddress(from), encodeAddress(to), encodeI128(amount)).toXDR("base64");
  }
  /** @deprecated Use approve() instead */
  buildApproveXdr(from: string, spender: string, amount: bigint, expirationLedger: number): string {
    return this.contract.call("approve",
      encodeAddress(from), encodeAddress(spender), encodeI128(amount), encodeU32(expirationLedger),
    ).toXDR("base64");
  }
  /** @deprecated Use burn() instead */
  buildBurnXdr(from: string, amount: bigint): string {
    return this.contract.call("burn", encodeAddress(from), encodeI128(amount)).toXDR("base64");
  }
  /** @deprecated Use setExternalUri() instead */
  buildSetExternalUriXdr(uri: string): string {
    return this.contract.call("set_external_uri", encodeString(uri)).toXDR("base64");
  }
}
