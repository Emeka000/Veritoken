import { rpc } from "@stellar/stellar-sdk";
import { BaseContractClient, type SignTx } from "./base.js";
import { encodeAddress, encodeI128, encodeU32 } from "../codec.js";
import type { PropertyMeta } from "../types.js";

export class PropertyTokenClient extends BaseContractClient {
  constructor(contractId: string, server: rpc.Server, networkPassphrase: string) {
    super(contractId, server, networkPassphrase, "property");
  }

  async getMeta(): Promise<PropertyMeta> { return this.read<PropertyMeta>("get_meta", []); }
  async balance(addr: string): Promise<bigint> { return this.read<bigint>("balance", [encodeAddress(addr)]); }
  async totalShares(): Promise<bigint> { return this.read<bigint>("total_shares", []); }
  async pendingDividend(holder: string): Promise<bigint> {
    return this.read<bigint>("pending_dividend", [encodeAddress(holder)]);
  }
  async name(): Promise<string> { return this.read<string>("name", []); }
  async symbol(): Promise<string> { return this.read<string>("symbol", []); }
  async decimals(): Promise<number> { return this.read<number>("decimals", []); }

  async mint(adminAddress: string, to: string, shares: bigint, signTx: SignTx): Promise<void> {
    await this.write("mint", [encodeAddress(to), encodeI128(shares)], adminAddress, signTx);
  }
  async transfer(fromAddress: string, to: string, shares: bigint, signTx: SignTx): Promise<void> {
    await this.write("transfer", [encodeAddress(fromAddress), encodeAddress(to), encodeI128(shares)], fromAddress, signTx);
  }
  async depositDividend(adminAddress: string, amount: bigint, distributionType: number, signTx: SignTx): Promise<void> {
    await this.write("deposit_dividend", [encodeI128(amount), encodeU32(distributionType)], adminAddress, signTx);
  }
  async claimDividend(holderAddress: string, signTx: SignTx): Promise<void> {
    await this.write("claim_dividend", [encodeAddress(holderAddress)], holderAddress, signTx);
  }

  /** @deprecated Use mint() instead */
  buildMintXdr(to: string, shares: bigint): string {
    return this.contract.call("mint", encodeAddress(to), encodeI128(shares)).toXDR("base64");
  }
  /** @deprecated Use transfer() instead */
  buildTransferXdr(from: string, to: string, shares: bigint): string {
    return this.contract.call("transfer", encodeAddress(from), encodeAddress(to), encodeI128(shares)).toXDR("base64");
  }
  /** @deprecated Use depositDividend() instead */
  buildDepositDividendXdr(amount: bigint): string {
    return this.contract.call("deposit_dividend", encodeI128(amount)).toXDR("base64");
  }
  /** @deprecated Use claimDividend() instead */
  buildClaimDividendXdr(holder: string): string {
    return this.contract.call("claim_dividend", encodeAddress(holder)).toXDR("base64");
  }
}
