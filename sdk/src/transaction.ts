/**
 * Canonical Soroban contract-call transaction builder.
 *
 * Every SDK and frontend read/write path delegates here so fee, timeout,
 * operation payload, source, and network handling cannot drift.
 */
import {
  Account,
  Contract,
  Keypair,
  TransactionBuilder,
  type xdr,
} from "@stellar/stellar-sdk";

export interface BuildTxOptions {
  fee?: string;
  timeoutSeconds?: number;
}

// Stable for the lifetime of the module and used only for read simulation.
export const SIM_SOURCE = Keypair.random().publicKey();

/**
 * Build a single-operation contract-call transaction and return its XDR.
 *
 * When `source` and `sequence` are omitted, the transaction uses a disposable
 * simulation account. Both must be provided together for signed writes.
 */
export function buildContractTx(
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  networkPassphrase: string,
  source?: string,
  sequence?: string,
  opts: BuildTxOptions = {},
): string {
  if ((source === undefined) !== (sequence === undefined)) {
    throw new Error("source and sequence must be provided together");
  }

  const account =
    source !== undefined && sequence !== undefined
      ? new Account(source, sequence)
      : new Account(SIM_SOURCE, "0");

  return new TransactionBuilder(account, {
    fee: opts.fee ?? "100",
    networkPassphrase,
  })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(opts.timeoutSeconds ?? 30)
    .build()
    .toXDR();
}
