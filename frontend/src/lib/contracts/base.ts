/**
 * Compatibility adapters from the frontend contract API to the canonical SDK
 * client core. The frontend keeps its existing method signatures, while XDR
 * construction, simulation decoding, sequence management, signed writes, and
 * contract errors all execute through `@veritoken/sdk`.
 */

import type { rpc, xdr } from "@stellar/stellar-sdk";
import {
  TxPipeline,
  buildContractTx,
  SIM_SOURCE,
  parseContractError,
} from "@veritoken/sdk";
import type {
  ContractName,
  SignTx as SdkSignTx,
} from "@veritoken/sdk";
import { NETWORK_PASSPHRASE, getServer } from "../stellar";

export type SignTx = SdkSignTx;

// A pipeline is shared by every client using the same RPC server. WeakMap
// avoids retaining replaced test/network instances after a network switch.
let pipelines = new WeakMap<rpc.Server, TxPipeline>();

/** Return the canonical pipeline for a server, creating it lazily. */
export function getPipeline(server: rpc.Server = getServer()): TxPipeline {
  let pipeline = pipelines.get(server);
  if (!pipeline) {
    pipeline = new TxPipeline(server, NETWORK_PASSPHRASE);
    pipelines.set(server, pipeline);
  }
  return pipeline;
}

/** Drop all shared pipelines after a network/server change. */
export function resetPipeline(): void {
  pipelines = new WeakMap<rpc.Server, TxPipeline>();
}

/** Build a single-operation transaction through the SDK's shared builder. */
export function buildTx(
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  source: string,
  sequence: string,
): string {
  return buildContractTx(
    contractId,
    method,
    args,
    NETWORK_PASSPHRASE,
    source,
    sequence,
  );
}

/** Simulate and decode a read through the SDK's canonical decoder. */
export async function readCall<T>(
  server: rpc.Server,
  contractId: string,
  method: string,
  args: xdr.ScVal[],
): Promise<T> {
  const { value } = await getPipeline(server).read<T>(
    contractId,
    method,
    args,
    SIM_SOURCE,
  );
  return value;
}

/**
 * Execute a signed write through the SDK pipeline.
 *
 * `senderSequence` remains in the signature for compatibility. Existing
 * callers prefetch it through `fetchSequence`, which warms this same
 * pipeline's sequence cache; the pipeline remains the sole authority that
 * selects and advances the value used in the transaction.
 */
export async function writeCall(
  server: rpc.Server,
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  senderAddress: string,
  _senderSequence: string,
  signTx: SignTx,
): Promise<rpc.Api.GetSuccessfulTransactionResponse> {
  const { response } = await getPipeline(server).write(
    contractId,
    method,
    args,
    senderAddress,
    signTx,
  );
  return response;
}

/** Warm and return the sequence from the shared SDK sequence cache. */
export function fetchSequence(
  server: rpc.Server,
  address: string,
): Promise<string> {
  return getPipeline(server).sequenceCache.next(server, address);
}

/** Enrich a raw Soroban error using the SDK's single error table. */
export function enrichError(contract: ContractName, err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err);
  const parsed = parseContractError(contract, raw);
  if (parsed) {
    return new Error(
      `${parsed.message} (${parsed.name} #${parsed.code}): ${raw}`,
    );
  }
  return err instanceof Error ? err : new Error(raw);
}

// Stable compatibility names for existing frontend clients. These are direct
// aliases, not local implementations.
export {
  encodeAddress as toAddress,
  encodeU32 as toU32,
  encodeU64 as toU64,
  encodeI128 as toI128,
  encodeString as toString,
  encodeBool as toBool,
} from "@veritoken/sdk";
