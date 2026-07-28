/**
 * Core contract client abstraction.
 *
 * All transaction lifecycle work (sequence caching, retry, simulation,
 * assembly, signing, submission, polling) is delegated to TxPipeline.
 * This file exposes the standalone helper functions and BaseContractClient
 * that the SDK clients and frontend contracts/base.ts both depend on.
 */

import {
  Contract,
  Keypair,
  rpc,
  xdr,
  scValToNative,
} from "@stellar/stellar-sdk";
import {
  parseContractError,
  formatContractError,
  type ContractName,
  type ContractError,
} from "../errors.js";
import {
  TxPipeline,
  SequenceCache,
  type PipelineOptions,
} from "../pipeline.js";

// ── Simulation dummy account ──────────────────────────────────────────────────

const _SIM_KEY = Keypair.random();
export const SIM_SOURCE = _SIM_KEY.publicKey();

// ── Re-exported types ─────────────────────────────────────────────────────────

export type SignTx = (xdrStr: string) => Promise<string>;
export interface BuildTxOptions { fee?: string; timeoutSeconds?: number; }

// ── Standalone helpers ────────────────────────────────────────────────────────

/**
 * Build a single-operation contract-call XDR transaction.
 * When source/sequence are omitted the simulation dummy account is used.
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
  const pipeline = new TxPipeline(
    null as unknown as rpc.Server,
    networkPassphrase,
    { fee: opts.fee, timeoutSeconds: opts.timeoutSeconds },
  );
  const src = source && sequence ? source : SIM_SOURCE;
  const seq = source && sequence ? sequence : "0";
  return pipeline.buildTx(contractId, method, args, src, seq);
}

/** Simulate a read-only contract call and return the decoded native JS value. */
export async function simulateRead<T>(
  server: rpc.Server,
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  networkPassphrase: string,
): Promise<T> {
  const { value } = await new TxPipeline(server, networkPassphrase)
    .read<T>(contractId, method, args, SIM_SOURCE);
  return value;
}

/**
 * Build, simulate, sign, submit, and poll — with injectable assemble.
 * The caller supplies a pre-fetched sequence; the pipeline will not re-fetch.
 */
export async function submitContractTx(
  server: rpc.Server,
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  senderAddress: string,
  sequence: string,
  signTx: SignTx,
  networkPassphrase: string,
  opts: BuildTxOptions = {},
  assemble: typeof rpc.assembleTransaction = rpc.assembleTransaction,
): Promise<rpc.Api.GetSuccessfulTransactionResponse> {
  // Pre-seed the cache so the pipeline uses the caller-supplied sequence.
  const cache = new SequenceCache();
  await cache.refresh(
    { getAccount: async () => ({ sequence }) } as unknown as rpc.Server,
    senderAddress,
  );
  const { response } = await new TxPipeline(
    server, networkPassphrase, { fee: opts.fee, timeoutSeconds: opts.timeoutSeconds, assemble },
    cache,
  ).write(contractId, method, args, senderAddress, signTx);
  return response;
}

/** Fetch the current sequence number for a Stellar account. */
export async function fetchAccountSequence(
  server: rpc.Server,
  address: string,
): Promise<string> {
  const cache = new SequenceCache();
  await cache.refresh(server, address);
  return cache.peek(address)!;
}

// ── Abstract base class ───────────────────────────────────────────────────────

/**
 * BaseContractClient owns a TxPipeline so all writes share one sequence cache,
 * preventing sequence races when multiple operations are issued in sequence.
 */
export abstract class BaseContractClient {
  protected readonly contract: Contract;
  /** Exposed so tests and subclasses can inject a shared cache. */
  readonly pipeline: TxPipeline;

  constructor(
    protected readonly contractId: string,
    protected readonly server: rpc.Server,
    protected readonly networkPassphrase: string,
    protected readonly contractName: ContractName,
    pipelineOpts?: PipelineOptions,
  ) {
    this.contract = new Contract(contractId);
    this.pipeline = new TxPipeline(server, networkPassphrase, pipelineOpts);
  }

  /** Simulate a read-only call and return decoded value `T`. */
  protected async read<T>(method: string, args: xdr.ScVal[]): Promise<T> {
    try {
      const { value } = await this.pipeline.read<T>(
        this.contractId, method, args, SIM_SOURCE,
      );
      return value;
    } catch (err) {
      throw this.enrichError(err);
    }
  }

  /**
   * Full write pipeline via TxPipeline.
   * `assemble` is injectable for tests — if provided, a one-shot pipeline
   * sharing the same sequence cache is created so the sequence stays consistent.
   */
  protected async write(
    method: string,
    args: xdr.ScVal[],
    senderAddress: string,
    signTx: SignTx,
    _opts?: BuildTxOptions,
    assemble?: typeof rpc.assembleTransaction,
  ): Promise<rpc.Api.GetSuccessfulTransactionResponse> {
    const pipeline = assemble
      ? new TxPipeline(
          this.server,
          this.networkPassphrase,
          { assemble },
          this.pipeline.sequenceCache,
        )
      : this.pipeline;
    try {
      const { response } = await pipeline.write(
        this.contractId, method, args, senderAddress, signTx,
      );
      return response;
    } catch (err) {
      throw this.enrichError(err);
    }
  }

  protected enrichError(err: unknown): Error {
    const raw = err instanceof Error ? err.message : String(err);
    const parsed = parseContractError(this.contractName, raw);
    if (parsed) {
      return new Error(`${parsed.message} (${parsed.name} #${parsed.code}): ${raw}`);
    }
    return err instanceof Error ? err : new Error(raw);
  }

  parseError(rawError: string): ContractError | null {
    return parseContractError(this.contractName, rawError);
  }

  formatError(err: unknown): string {
    return formatContractError(
      this.contractName,
      err instanceof Error ? err.message : String(err),
    );
  }
}

export { scValToNative as decodeScVal } from "@stellar/stellar-sdk";
