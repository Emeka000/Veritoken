/**
 * Frontend re-export of TxPipeline and SequenceCache.
 *
 * The frontend cannot import from `sdk/src` directly (no workspace link),
 * so this file contains the same implementation inlined for the frontend
 * build. Both implementations are kept in sync — changes to pipeline
 * semantics must be mirrored here and in sdk/src/pipeline.ts.
 *
 * To avoid duplication in the long run, set up an npm workspace or
 * a monorepo tool that links @veritoken/sdk into the frontend.
 */

import { TransactionBuilder, Account, Contract, rpc, xdr } from "@stellar/stellar-sdk";
import { getNetworkPassphrase, getServer } from "./stellar";

// ── Error hierarchy ───────────────────────────────────────────────────────────

export class TxError extends Error {
  constructor(
    message: string,
    public readonly kind: "sequence" | "simulation" | "signing" | "submission" | "confirm" | "timeout" | "transient",
    public readonly cause?: unknown,
  ) { super(message); this.name = "TxError"; }
}

export class SequenceError extends TxError {
  constructor(address: string, cause?: unknown) {
    super(`Failed to fetch sequence for ${address}`, "sequence", cause);
    this.name = "SequenceError";
  }
}

export class SimulationError extends TxError {
  constructor(method: string, public readonly detail: string, cause?: unknown) {
    super(`Simulation failed for ${method}: ${detail}`, "simulation", cause);
    this.name = "SimulationError";
  }
}

export class SigningError extends TxError {
  constructor(cause?: unknown) {
    super("Signing callback failed or returned empty XDR", "signing", cause);
    this.name = "SigningError";
  }
}

export class SubmissionError extends TxError {
  constructor(public readonly txHash: string | undefined, detail: string, cause?: unknown) {
    super(`Transaction submission failed: ${detail}`, "submission", cause);
    this.name = "SubmissionError";
  }
}

export class ConfirmError extends TxError {
  constructor(public readonly txHash: string, public readonly finalStatus: string, cause?: unknown) {
    super(`Transaction ${txHash} did not succeed: status=${finalStatus}`, "confirm", cause);
    this.name = "ConfirmError";
  }
}

export class TimeoutError extends TxError {
  constructor(public readonly txHash: string, public readonly elapsedMs: number) {
    super(`Confirmation of ${txHash} timed out after ${elapsedMs}ms`, "timeout");
    this.name = "TimeoutError";
  }
}

export class TransientError extends TxError {
  constructor(message: string, cause?: unknown) {
    super(message, "transient", cause);
    this.name = "TransientError";
  }
}

// ── Transient error detection ─────────────────────────────────────────────────

const TRANSIENT_PATTERNS = [/timeout/i, /ECONNRESET/i, /ECONNREFUSED/i, /ETIMEDOUT/i, /network/i, /429/, /503/, /502/, /TRY_AGAIN_LATER/i];

export function isTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return TRANSIENT_PATTERNS.some((p) => p.test(msg));
}

// ── Sequence cache ────────────────────────────────────────────────────────────

export class SequenceCache {
  private readonly cache = new Map<string, bigint>();

  async next(server: rpc.Server, address: string): Promise<string> {
    if (!this.cache.has(address)) await this.refresh(server, address);
    return this.cache.get(address)!.toString();
  }

  advance(address: string): void {
    const seq = this.cache.get(address);
    if (seq !== undefined) this.cache.set(address, seq + 1n);
  }

  invalidate(address: string): void { this.cache.delete(address); }

  async refresh(server: rpc.Server, address: string): Promise<void> {
    try {
      const account = await server.getAccount(address);
      this.cache.set(address, BigInt((account as unknown as { sequence: string }).sequence));
    } catch (err) {
      throw new SequenceError(address, err);
    }
  }

  peek(address: string): string | undefined { return this.cache.get(address)?.toString(); }
}

// ── Options ───────────────────────────────────────────────────────────────────

export interface PipelineOptions {
  maxRetries?: number;
  initialBackoffMs?: number;
  confirmTimeoutMs?: number;
  pollIntervalMs?: number;
  fee?: string;
  timeoutSeconds?: number;
  assemble?: typeof rpc.assembleTransaction;
  sleep?: (ms: number) => Promise<void>;
}

export interface WriteResult {
  response: rpc.Api.GetSuccessfulTransactionResponse;
  txHash: string;
  confirmedInMs: number;
  retries: number;
}

// ── TxPipeline ────────────────────────────────────────────────────────────────

export class TxPipeline {
  private readonly opts: Required<Omit<PipelineOptions, "assemble" | "sleep">> & Pick<PipelineOptions, "assemble" | "sleep">;
  readonly sequenceCache: SequenceCache;

  constructor(
    private readonly server: rpc.Server,
    private readonly networkPassphrase: string,
    opts: PipelineOptions = {},
    sequenceCache?: SequenceCache,
  ) {
    this.opts = {
      maxRetries:       opts.maxRetries       ?? 3,
      initialBackoffMs: opts.initialBackoffMs ?? 400,
      confirmTimeoutMs: opts.confirmTimeoutMs ?? 60_000,
      pollIntervalMs:   opts.pollIntervalMs   ?? 1_500,
      fee:              opts.fee              ?? "100",
      timeoutSeconds:   opts.timeoutSeconds   ?? 30,
      assemble: opts.assemble,
      sleep: opts.sleep,
    };
    this.sequenceCache = sequenceCache ?? new SequenceCache();
  }

  private get assembleFn() { return this.opts.assemble ?? rpc.assembleTransaction; }
  private sleepMs(ms: number) {
    return this.opts.sleep ? this.opts.sleep(ms) : new Promise<void>((r) => setTimeout(r, ms));
  }

  buildTx(contractId: string, method: string, args: xdr.ScVal[], source: string, sequence: string): string {
    const account = new Account(source, sequence);
    const contract = new Contract(contractId);
    return new TransactionBuilder(account, { fee: this.opts.fee, networkPassphrase: this.networkPassphrase })
      .addOperation(contract.call(method, ...args))
      .setTimeout(this.opts.timeoutSeconds)
      .build()
      .toXDR();
  }

  private async withRetry<T>(fn: () => Promise<T>, label: string): Promise<{ result: T; retries: number }> {
    let attempt = 0;
    let backoff = this.opts.initialBackoffMs;
    while (true) {
      try {
        return { result: await fn(), retries: attempt };
      } catch (err) {
        if (err instanceof SimulationError || err instanceof SubmissionError ||
            err instanceof ConfirmError || err instanceof SigningError || err instanceof SequenceError) throw err;
        if (!isTransientError(err)) throw err;
        if (attempt >= this.opts.maxRetries) {
          throw new TransientError(`${label} failed after ${attempt + 1} attempts: ${err instanceof Error ? err.message : String(err)}`, err);
        }
        await this.sleepMs(backoff);
        backoff = Math.min(backoff * 2, 8_000);
        attempt++;
      }
    }
  }

  async write(contractId: string, method: string, args: xdr.ScVal[], senderAddress: string, signTx: (x: string) => Promise<string>): Promise<WriteResult> {
    const { result, retries } = await this.withRetry(
      () => this._writeOnce(contractId, method, args, senderAddress, signTx),
      `write ${method}`,
    );
    return { ...result, retries };
  }

  private async _writeOnce(contractId: string, method: string, args: xdr.ScVal[], senderAddress: string, signTx: (x: string) => Promise<string>): Promise<Omit<WriteResult, "retries">> {
    const sequence = await this.sequenceCache.next(this.server, senderAddress)
      .catch((err) => { throw err instanceof SequenceError ? err : new SequenceError(senderAddress, err); });

    const xdrTx = this.buildTx(contractId, method, args, senderAddress, sequence);

    let sim: rpc.Api.SimulateTransactionResponse;
    try {
      sim = await this.server.simulateTransaction(TransactionBuilder.fromXDR(xdrTx, this.networkPassphrase));
    } catch (err) {
      this.sequenceCache.invalidate(senderAddress);
      throw err;
    }

    if (rpc.Api.isSimulationError(sim)) {
      throw new SimulationError(method, (sim as rpc.Api.SimulateTransactionErrorResponse).error);
    }

    const prepared = this.assembleFn(
      TransactionBuilder.fromXDR(xdrTx, this.networkPassphrase),
      sim as rpc.Api.SimulateTransactionSuccessResponse,
    ).build().toXDR();

    let signed: string;
    try {
      signed = await signTx(prepared);
      if (!signed) throw new Error("empty XDR");
    } catch (err) {
      throw err instanceof SigningError ? err : new SigningError(err);
    }

    let sendResult: Awaited<ReturnType<rpc.Server["sendTransaction"]>>;
    try {
      sendResult = await this.server.sendTransaction(TransactionBuilder.fromXDR(signed, this.networkPassphrase));
    } catch (err) {
      this.sequenceCache.invalidate(senderAddress);
      throw err;
    }

    if (sendResult.status === "ERROR") {
      throw new SubmissionError(undefined, JSON.stringify(sendResult.errorResult));
    }

    this.sequenceCache.advance(senderAddress);

    const txHash = sendResult.hash;
    const deadline = Date.now() + this.opts.confirmTimeoutMs;
    const submitTime = Date.now();

    let getResult = await this.server.getTransaction(txHash);
    while (getResult.status === "NOT_FOUND") {
      if (Date.now() >= deadline) throw new TimeoutError(txHash, Date.now() - submitTime);
      await this.sleepMs(this.opts.pollIntervalMs);
      getResult = await this.server.getTransaction(txHash);
    }

    if (getResult.status !== "SUCCESS") throw new ConfirmError(txHash, getResult.status);

    return {
      response: getResult as rpc.Api.GetSuccessfulTransactionResponse,
      txHash,
      confirmedInMs: Date.now() - submitTime,
    };
  }
}
