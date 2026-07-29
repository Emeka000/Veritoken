/**
 * TxPipeline — production-grade Soroban transaction lifecycle manager.
 *
 * Handles the full write flow in one place:
 *   1. Sequence fetch (with in-process cache to prevent races)
 *   2. Transaction build
 *   3. Simulation (with resource footprint)
 *   4. Assembly
 *   5. Signing
 *   6. Submission
 *   7. Confirmation polling
 *   8. Retry on transient RPC failures with exponential backoff
 *
 * Error model
 * ───────────
 * Every failure throws a typed TxError subclass so callers can distinguish:
 *   - SequenceError   — could not fetch or advance the account sequence
 *   - SimulationError — simulation rejected (includes contract error codes)
 *   - SigningError    — the sign callback threw or returned empty
 *   - SubmissionError — the network rejected the transaction
 *   - ConfirmError    — the transaction was submitted but did not land
 *   - TimeoutError    — confirmation polling exceeded the deadline
 *   - TransientError  — wraps retried-then-failed RPC transport errors
 */

import {
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import type { SignTx } from "./clients/base.js";
import { buildContractTx } from "./transaction.js";

// ── Error hierarchy ───────────────────────────────────────────────────────────

export class TxError extends Error {
  constructor(
    message: string,
    /** Machine-readable category for programmatic handling. */
    public readonly kind:
      | "sequence"
      | "simulation"
      | "signing"
      | "submission"
      | "confirm"
      | "timeout"
      | "transient",
    /** Original cause if available. */
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "TxError";
  }
}

export class SequenceError extends TxError {
  constructor(address: string, cause?: unknown) {
    super(`Failed to fetch sequence for ${address}`, "sequence", cause);
    this.name = "SequenceError";
  }
}

export class SimulationError extends TxError {
  constructor(
    method: string,
    public readonly detail: string,
    cause?: unknown,
  ) {
    super(
      detail === "no return value"
        ? `No return value from ${method}`
        : `Simulation error calling ${method}: ${detail}`,
      "simulation",
      cause,
    );
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
  constructor(
    public readonly txHash: string | undefined,
    detail: string,
    cause?: unknown,
  ) {
    super(`Transaction rejected by network: ${detail}`, "submission", cause);
    this.name = "SubmissionError";
  }
}

export class ConfirmError extends TxError {
  constructor(
    public readonly txHash: string,
    public readonly finalStatus: string,
    cause?: unknown,
  ) {
    super(
      `Transaction ${txHash} did not succeed: status=${finalStatus}`,
      "confirm",
      cause,
    );
    this.name = "ConfirmError";
  }
}

export class TimeoutError extends TxError {
  constructor(
    public readonly txHash: string,
    public readonly elapsedMs: number,
  ) {
    super(
      `Confirmation of ${txHash} timed out after ${elapsedMs}ms`,
      "timeout",
    );
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

const TRANSIENT_PATTERNS = [
  /timeout/i,
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /ETIMEDOUT/i,
  /network/i,
  /429/,                   // rate-limited
  /503/,                   // service unavailable
  /502/,                   // bad gateway
  /TRY_AGAIN_LATER/i,
];

/** Returns true when the error looks like a transient RPC transport failure. */
export function isTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return TRANSIENT_PATTERNS.some((p) => p.test(msg));
}

// ── Sequence cache ────────────────────────────────────────────────────────────

/**
 * SequenceCache keeps the last-known sequence per account in memory.
 *
 * Rules:
 * - On first use (or after invalidation) the sequence is fetched from RPC.
 * - After a successful submission the cached value is incremented so the
 *   next call in the same process doesn't race with ledger propagation.
 * - On a SequenceError or submission rejection the entry is invalidated
 *   so the next attempt fetches a fresh value from RPC.
 */
export class SequenceCache {
  private readonly cache = new Map<string, bigint>();

  /** Return the next sequence string to use, fetching from RPC if needed. */
  async next(server: rpc.Server, address: string): Promise<string> {
    if (!this.cache.has(address)) {
      await this.refresh(server, address);
    }
    const seq = this.cache.get(address)!;
    return seq.toString();
  }

  /**
   * Advance the cached sequence after a successful submission.
   * This prevents the next call in the same process from re-fetching
   * and potentially racing with ledger propagation.
   */
  advance(address: string): void {
    const seq = this.cache.get(address);
    if (seq !== undefined) {
      this.cache.set(address, seq + 1n);
    }
  }

  /** Force a fresh fetch on the next `next()` call for this address. */
  invalidate(address: string): void {
    this.cache.delete(address);
  }

  /** Force-refresh the sequence from RPC right now. */
  async refresh(server: rpc.Server, address: string): Promise<void> {
    try {
      const account = await server.getAccount(address);
      const raw = (account as unknown as { sequence: string }).sequence;
      this.cache.set(address, BigInt(raw));
    } catch (err) {
      throw new SequenceError(address, err);
    }
  }

  /** Peek at the current cached value without triggering a fetch. */
  peek(address: string): string | undefined {
    return this.cache.get(address)?.toString();
  }
}

// ── Pipeline options ──────────────────────────────────────────────────────────

export interface PipelineOptions {
  /**
   * Maximum number of retry attempts for transient RPC errors.
   * Does not apply to contract errors (those are not retryable).
   * @default 3
   */
  maxRetries?: number;

  /**
   * Initial backoff delay in milliseconds. Doubles on each retry.
   * @default 400
   */
  initialBackoffMs?: number;

  /**
   * Maximum total time to wait for confirmation polling in milliseconds.
   * @default 60_000 (60 seconds)
   */
  confirmTimeoutMs?: number;

  /**
   * Interval between confirmation poll attempts in milliseconds.
   * @default 1_500
   */
  pollIntervalMs?: number;

  /** Base fee in stroops. @default "100" */
  fee?: string;

  /** Transaction timeout in seconds passed to TransactionBuilder. @default 30 */
  timeoutSeconds?: number;

  /**
   * Injectable assembleTransaction override.
   * Used in tests to avoid needing real SorobanTransactionData XDR.
   */
  assemble?: typeof rpc.assembleTransaction;

  /**
   * Injectable sleep function.
   * Defaults to a real Promise-based setTimeout. Override in tests.
   */
  sleep?: (ms: number) => Promise<void>;
}

const PIPELINE_DEFAULTS = {
  maxRetries: 3,
  initialBackoffMs: 400,
  confirmTimeoutMs: 60_000,
  pollIntervalMs: 1_500,
  fee: "100",
  timeoutSeconds: 30,
} as const;

// ── Read result ───────────────────────────────────────────────────────────────

export interface ReadResult<T> {
  value: T;
  /** Raw simulation response for callers that need resource metadata. */
  simulation: rpc.Api.SimulateTransactionSuccessResponse;
}

// ── Write result ──────────────────────────────────────────────────────────────

export interface WriteResult {
  /** The confirmed transaction response from the RPC. */
  response: rpc.Api.GetSuccessfulTransactionResponse;
  /** Transaction hash. */
  txHash: string;
  /** Total wall-clock time from submit to confirmed in milliseconds. */
  confirmedInMs: number;
  /** How many retry attempts were needed (0 = first try succeeded). */
  retries: number;
}

// ── TxPipeline ────────────────────────────────────────────────────────────────

/**
 * TxPipeline manages the full Soroban transaction lifecycle.
 *
 * A single instance should be shared across all contract clients that talk to
 * the same RPC server so the sequence cache is shared and multi-tx flows do
 * not race.
 *
 * @example
 * ```ts
 * const pipeline = new TxPipeline(server, Networks.TESTNET);
 *
 * // Read
 * const { value } = await pipeline.read<bigint>(contractId, "balance", [encodeAddress(addr)]);
 *
 * // Write
 * const { txHash } = await pipeline.write(contractId, "transfer", args, sender, signTx);
 * ```
 */
export class TxPipeline {
  private readonly opts: Required<
    Omit<PipelineOptions, "assemble" | "sleep">
  > & Pick<PipelineOptions, "assemble" | "sleep">;

  readonly sequenceCache: SequenceCache;

  constructor(
    private readonly server: rpc.Server,
    private readonly networkPassphrase: string,
    opts: PipelineOptions = {},
    sequenceCache?: SequenceCache,
  ) {
    this.opts = {
      maxRetries:       opts.maxRetries       ?? PIPELINE_DEFAULTS.maxRetries,
      initialBackoffMs: opts.initialBackoffMs ?? PIPELINE_DEFAULTS.initialBackoffMs,
      confirmTimeoutMs: opts.confirmTimeoutMs ?? PIPELINE_DEFAULTS.confirmTimeoutMs,
      pollIntervalMs:   opts.pollIntervalMs   ?? PIPELINE_DEFAULTS.pollIntervalMs,
      fee:              opts.fee              ?? PIPELINE_DEFAULTS.fee,
      timeoutSeconds:   opts.timeoutSeconds   ?? PIPELINE_DEFAULTS.timeoutSeconds,
      assemble:         opts.assemble,
      sleep:            opts.sleep,
    };
    this.sequenceCache = sequenceCache ?? new SequenceCache();
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  private get assembleFn(): typeof rpc.assembleTransaction {
    return this.opts.assemble ?? rpc.assembleTransaction;
  }

  private sleepMs(ms: number): Promise<void> {
    if (this.opts.sleep) return this.opts.sleep(ms);
    return new Promise((r) => setTimeout(r, ms));
  }

  /**
   * Execute `fn` with retry on transient errors.
   * Contract errors (SimulationError, SubmissionError with non-transient cause)
   * are re-thrown immediately without retrying.
   */
  private async withRetry<T>(
    fn: () => Promise<T>,
    label: string,
  ): Promise<{ result: T; retries: number }> {
    let attempt = 0;
    let backoff = this.opts.initialBackoffMs;

    while (true) {
      try {
        const result = await fn();
        return { result, retries: attempt };
      } catch (err) {
        // Never retry contract-logic errors — they won't change on retry.
        if (
          err instanceof SimulationError ||
          err instanceof SubmissionError ||
          err instanceof ConfirmError ||
          err instanceof SigningError ||
          err instanceof SequenceError
        ) {
          throw err;
        }

        // Only retry recognisably transient transport errors.
        if (!isTransientError(err)) throw err;

        if (attempt >= this.opts.maxRetries) {
          throw new TransientError(
            `${label} failed after ${attempt + 1} attempts: ${err instanceof Error ? err.message : String(err)}`,
            err,
          );
        }

        await this.sleepMs(backoff);
        backoff = Math.min(backoff * 2, 8_000);
        attempt++;
      }
    }
  }

  // ── Build ───────────────────────────────────────────────────────────────────

  /** Build an XDR transaction string. Pure, no network calls. */
  buildTx(
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
      this.networkPassphrase,
      source,
      sequence,
      {
        fee: this.opts.fee,
        timeoutSeconds: this.opts.timeoutSeconds,
      },
    );
  }

  // ── Read ────────────────────────────────────────────────────────────────────

  /**
   * Simulate a read-only contract call and return the decoded native value.
   * Uses the well-known dummy source account — no sequence management needed.
   */
  async read<T>(
    contractId: string,
    method: string,
    args: xdr.ScVal[],
    /** Stable dummy address for the simulation source. */
    simSource: string,
    simSequence = "0",
  ): Promise<ReadResult<T>> {
    const xdrTx = this.buildTx(contractId, method, args, simSource, simSequence);

    const { result: sim } = await this.withRetry(
      () => this.server.simulateTransaction(
        TransactionBuilder.fromXDR(xdrTx, this.networkPassphrase),
      ),
      `simulate ${method}`,
    );

    if (rpc.Api.isSimulationError(sim)) {
      throw new SimulationError(method, (sim as rpc.Api.SimulateTransactionErrorResponse).error);
    }

    const successSim = sim as rpc.Api.SimulateTransactionSuccessResponse;
    if (!successSim.result?.retval) {
      throw new SimulationError(method, "no return value");
    }

    return {
      value: scValToNative(successSim.result.retval) as T,
      simulation: successSim,
    };
  }

  // ── Write ───────────────────────────────────────────────────────────────────

  /**
   * Full write pipeline: sequence → build → simulate → assemble → sign → submit → poll.
   *
   * Sequence management is automatic. On transient failures the sequence is
   * refreshed before retrying so stale sequence numbers are never reused.
   */
  async write(
    contractId: string,
    method: string,
    args: xdr.ScVal[],
    senderAddress: string,
    signTx: SignTx,
  ): Promise<WriteResult> {
    const { result, retries } = await this.withRetry(
      () => this._writeOnce(contractId, method, args, senderAddress, signTx),
      `write ${method}`,
    );
    return { ...result, retries };
  }

  /** Single attempt of the write flow. Called by withRetry. */
  private async _writeOnce(
    contractId: string,
    method: string,
    args: xdr.ScVal[],
    senderAddress: string,
    signTx: SignTx,
  ): Promise<Omit<WriteResult, "retries">> {
    // 1. Sequence — fetch fresh on first use, use cache thereafter.
    const sequence = await this.sequenceCache
      .next(this.server, senderAddress)
      .catch((err) => {
        throw err instanceof SequenceError ? err : new SequenceError(senderAddress, err);
      });

    // 2. Build
    const xdrTx = this.buildTx(contractId, method, args, senderAddress, sequence);

    // 3. Simulate
    let sim: rpc.Api.SimulateTransactionResponse;
    try {
      sim = await this.server.simulateTransaction(
        TransactionBuilder.fromXDR(xdrTx, this.networkPassphrase),
      );
    } catch (err) {
      // Transport error — invalidate sequence so next retry fetches fresh.
      this.sequenceCache.invalidate(senderAddress);
      throw err; // let withRetry decide whether to retry
    }

    if (rpc.Api.isSimulationError(sim)) {
      // Contract error — do NOT retry, do NOT invalidate sequence.
      throw new SimulationError(method, (sim as rpc.Api.SimulateTransactionErrorResponse).error);
    }

    // 4. Assemble
    const prepared = this.assembleFn(
      TransactionBuilder.fromXDR(xdrTx, this.networkPassphrase),
      sim as rpc.Api.SimulateTransactionSuccessResponse,
    )
      .build()
      .toXDR();

    // 5. Sign
    let signed: string;
    try {
      signed = await signTx(prepared);
      if (!signed) throw new Error("empty XDR returned from sign callback");
    } catch (err) {
      throw err instanceof SigningError ? err : new SigningError(err);
    }

    // 6. Submit
    let sendResult: Awaited<ReturnType<rpc.Server["sendTransaction"]>>;
    try {
      sendResult = await this.server.sendTransaction(
        TransactionBuilder.fromXDR(signed, this.networkPassphrase),
      );
    } catch (err) {
      this.sequenceCache.invalidate(senderAddress);
      throw err;
    }

    if (sendResult.status === "ERROR") {
      // Hard rejection from the network — do NOT invalidate sequence,
      // the sequence was consumed. Surface as SubmissionError.
      throw new SubmissionError(
        undefined,
        JSON.stringify(sendResult.errorResult),
      );
    }

    // Sequence was accepted — advance the cache so the next call doesn't re-fetch.
    this.sequenceCache.advance(senderAddress);

    // 7. Poll for confirmation
    const txHash = sendResult.hash;
    const deadline = Date.now() + this.opts.confirmTimeoutMs;
    const submitTime = Date.now();

    let getResult = await this.server.getTransaction(txHash);
    while (getResult.status === "NOT_FOUND") {
      if (Date.now() >= deadline) {
        throw new TimeoutError(txHash, Date.now() - submitTime);
      }
      await this.sleepMs(this.opts.pollIntervalMs);
      getResult = await this.server.getTransaction(txHash);
    }

    if (getResult.status !== "SUCCESS") {
      throw new ConfirmError(txHash, getResult.status);
    }

    return {
      response: getResult as rpc.Api.GetSuccessfulTransactionResponse,
      txHash,
      confirmedInMs: Date.now() - submitTime,
    };
  }
}
