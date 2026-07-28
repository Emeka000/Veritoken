import { rpc } from "@stellar/stellar-sdk";
import { BaseContractClient, type SignTx } from "./base.js";
import { encodeAddress, encodeI128, encodeU32, encodeInvoiceMeta } from "../codec.js";
import type { InvoiceMeta } from "../types.js";

export class InvoiceTokenClient extends BaseContractClient {
  constructor(contractId: string, server: rpc.Server, networkPassphrase: string) {
    super(contractId, server, networkPassphrase, "invoice");
  }

  async getMeta(): Promise<InvoiceMeta> { return this.read<InvoiceMeta>("get_meta", []); }
  async balance(addr: string): Promise<bigint> { return this.read<bigint>("balance", [encodeAddress(addr)]); }
  async totalSupply(): Promise<bigint> { return this.read<bigint>("total_supply", []); }
  async isSettled(): Promise<boolean> { return this.read<boolean>("is_settled", []); }
  async allowance(from: string, spender: string): Promise<bigint> {
    return this.read<bigint>("allowance", [encodeAddress(from), encodeAddress(spender)]);
  }
  async name(): Promise<string> { return this.read<string>("name", []); }
  async symbol(): Promise<string> { return this.read<string>("symbol", []); }
  async decimals(): Promise<number> { return this.read<number>("decimals", []); }

  async issue(adminAddress: string, to: string, amount: bigint, signTx: SignTx): Promise<void> {
    await this.write("issue", [encodeAddress(to), encodeI128(amount)], adminAddress, signTx);
  }
  async settle(adminAddress: string, signTx: SignTx): Promise<void> {
    await this.write("settle", [], adminAddress, signTx);
  }
  async redeem(fromAddress: string, amount: bigint, signTx: SignTx): Promise<void> {
    await this.write("redeem", [encodeAddress(fromAddress), encodeI128(amount)], fromAddress, signTx);
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

  /** @deprecated Use issue() instead */
  buildIssueXdr(to: string, amount: bigint): string {
    return this.contract.call("issue", encodeAddress(to), encodeI128(amount)).toXDR("base64");
  }
  /** @deprecated Use settle() instead */
  buildSettleXdr(): string { return this.contract.call("settle").toXDR("base64"); }
  /** @deprecated Use redeem() instead */
  buildRedeemXdr(from: string, amount: bigint): string {
    return this.contract.call("redeem", encodeAddress(from), encodeI128(amount)).toXDR("base64");
  }
  /** @deprecated Use transfer() instead */
  buildTransferXdr(from: string, to: string, amount: bigint): string {
    return this.contract.call("transfer", encodeAddress(from), encodeAddress(to), encodeI128(amount)).toXDR("base64");
  }
  /** @deprecated Use transferFrom() instead */
  buildTransferFromXdr(spender: string, from: string, to: string, amount: bigint): string {
    return this.contract.call("transfer_from",
      encodeAddress(spender), encodeAddress(from), encodeAddress(to), encodeI128(amount),
    ).toXDR("base64");
  }
  /** @deprecated Use approve() instead */
  buildApproveXdr(from: string, spender: string, amount: bigint, expirationLedger: number): string {
    return this.contract.call("approve",
      encodeAddress(from), encodeAddress(spender), encodeI128(amount), encodeU32(expirationLedger),
    ).toXDR("base64");
  }
  /** @deprecated */
  buildUpdateMetaXdr(meta: InvoiceMeta): string {
    return this.contract.call("update_meta", encodeInvoiceMeta(meta)).toXDR("base64");
  }
}
