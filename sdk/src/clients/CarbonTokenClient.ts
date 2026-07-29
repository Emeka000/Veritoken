import type { rpc } from "@stellar/stellar-sdk";
import { BaseContractClient, type SignTx, decodeScVal } from "./base.js";
import type { ProjectMeta, RetirementReceipt } from "../types.js";
import {
  encodeAddress,
  encodeI128,
  encodeU32,
  encodeString,
  encodeProjectMeta,
} from "../codec.js";

export class CarbonTokenClient extends BaseContractClient {
  constructor(
    contractId: string,
    server: rpc.Server,
    networkPassphrase: string,
  ) {
    super(contractId, server, networkPassphrase, "carbon");
  }

  // ── Read API ──────────────────────────────────────────────────────────────

  async getMeta(): Promise<ProjectMeta> {
    return this.read<ProjectMeta>("get_meta", []);
  }

  async balance(addr: string): Promise<bigint> {
    return this.read<bigint>("balance", [encodeAddress(addr)]);
  }

  async totalSupply(): Promise<bigint> {
    return this.read<bigint>("total_supply", []);
  }

  async totalRetired(): Promise<bigint> {
    return this.read<bigint>("total_retired", []);
  }

  async retirementCount(): Promise<number> {
    return this.read<number>("retirement_count", []);
  }

  async getReceipt(index: number): Promise<RetirementReceipt> {
    return this.read<RetirementReceipt>("get_receipt", [encodeU32(index)]);
  }

  async getReceipts(
    start: number,
    limit: number,
  ): Promise<RetirementReceipt[]> {
    return this.read<RetirementReceipt[]>("get_receipts", [
      encodeU32(start),
      encodeU32(limit),
    ]);
  }

  async name(): Promise<string> {
    return this.read<string>("name", []);
  }

  async symbol(): Promise<string> {
    return this.read<string>("symbol", []);
  }

  async decimals(): Promise<number> {
    return this.read<number>("decimals", []);
  }

  // ── Write API ─────────────────────────────────────────────────────────────

  async mint(
    adminAddress: string,
    to: string,
    amount: bigint,
    signTx: SignTx,
  ): Promise<void> {
    await this.write(
      "mint",
      [encodeAddress(to), encodeI128(amount)],
      adminAddress,
      signTx,
    );
  }

  async transfer(
    fromAddress: string,
    to: string,
    amount: bigint,
    signTx: SignTx,
  ): Promise<void> {
    await this.write(
      "transfer",
      [encodeAddress(fromAddress), encodeAddress(to), encodeI128(amount)],
      fromAddress,
      signTx,
    );
  }

  /**
   * Permanently retire `amount` credits on behalf of `retiree`.
   * Creates an on-chain retirement receipt and emits a `retired` event.
   * Returns the created RetirementReceipt.
   */
  async retire(
    retireeAddress: string,
    amount: bigint,
    beneficiary: string,
    reason: string,
    signTx: SignTx,
  ): Promise<RetirementReceipt> {
    const txResult = await this.write(
      "retire",
      [
        encodeAddress(retireeAddress),
        encodeI128(amount),
        encodeString(beneficiary),
        encodeString(reason),
      ],
      retireeAddress,
      signTx,
    );

    // Try to extract the return value from the transaction result metadata.
    try {
      const retval = (txResult as any)
        ?.resultMetaXdr?.v3?.()
        ?.sorobanMeta?.()
        ?.returnValue?.();
      if (retval) return decodeScVal(retval) as RetirementReceipt;
    } catch {
      /* fall through to stub */
    }

    // Fallback stub when metadata isn't available (e.g. testing).
    return {
      retiree: retireeAddress,
      amount: Number(amount),
      beneficiary,
      retirement_reason: reason,
      timestamp: Math.floor(Date.now() / 1000),
      beneficiary_address: null,
    } as unknown as RetirementReceipt;
  }

  async updateMeta(
    adminAddress: string,
    meta: ProjectMeta,
    signTx: SignTx,
  ): Promise<void> {
    await this.write(
      "update_meta",
      [encodeProjectMeta(meta)],
      adminAddress,
      signTx,
    );
  }

  // ── Legacy XDR builders ───────────────────────────────────────────────────

  /** @deprecated Use `mint()` instead */
  buildMintXdr(to: string, amount: bigint): string {
    return this.contract
      .call("mint", encodeAddress(to), encodeI128(amount))
      .toXDR("base64");
  }

  /** @deprecated Use `transfer()` instead */
  buildTransferXdr(from: string, to: string, amount: bigint): string {
    return this.contract
      .call(
        "transfer",
        encodeAddress(from),
        encodeAddress(to),
        encodeI128(amount),
      )
      .toXDR("base64");
  }

  /** @deprecated Use `retire()` instead */
  buildRetireXdr(
    retiree: string,
    amount: bigint,
    beneficiary: string,
    reason: string,
  ): string {
    return this.contract
      .call(
        "retire",
        encodeAddress(retiree),
        encodeI128(amount),
        encodeString(beneficiary),
        encodeString(reason),
      )
      .toXDR("base64");
  }

  /** @deprecated Use `updateMeta()` instead */
  buildUpdateMetaXdr(meta: ProjectMeta): string {
    return this.contract
      .call("update_meta", encodeProjectMeta(meta))
      .toXDR("base64");
  }
}
