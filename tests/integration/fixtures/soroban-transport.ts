import * as fs from "node:fs";

import {
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  Operation,
  TransactionBuilder,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";

import type {
  DeployContractRequest,
  FixtureTransport,
  InvokeContractRequest,
  UploadWasmRequest,
} from "./fixture-runner";

// ── Fee-bump types (mirrored from frontend/src/lib/feeBump.ts) ─────────────────
// Duplicated here to keep the integration-test package independent from the
// frontend package.  Keep the shape in sync with FeeBumpConfig.

/**
 * Optional fee-bump configuration for SorobanTransport.
 * When set, every transaction submitted through this transport is wrapped in a
 * fee-bump envelope and retried with exponential fee escalation on transient
 * failures, matching the behaviour of the frontend's submitWithFeeBump.
 */
export interface FeeBumpConfig {
  /** Account that pays the fee-bump fee. */
  feeBumpSource: Keypair;
  /** Starting fee in stroops. Default BASE_FEE * 10 = 1 000. */
  initialFeeStroops: number;
  /** Hard cap on fee in stroops. */
  maxFeeStroops: number;
  /** Maximum retry attempts after the initial submission. Default 4. */
  maxRetries: number;
  /** Base back-off interval (ms). Actual wait = backoffMs * 2^retryN. */
  backoffMs: number;
}

export const DEFAULT_FEE_BUMP_CONFIG: Omit<FeeBumpConfig, "feeBumpSource"> = {
  initialFeeStroops: Number(BASE_FEE) * 10,
  maxFeeStroops: Number(BASE_FEE) * 1_000,
  maxRetries: 4,
  backoffMs: 500,
};

type TransactionResult = Awaited<
  ReturnType<rpc.Server["getTransaction"]>
>;

export interface TransactionPoller {
  getTransaction(hash: string): Promise<TransactionResult>;
}

export interface WaitForTransactionOptions {
  clock?: () => number;
  operation: string;
  pollIntervalMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
}

export class SorobanFixtureError extends Error {
  readonly operation: string;
  readonly stage: "prepare" | "send" | "poll" | "result";
  readonly transactionHash?: string;

  constructor(
    operation: string,
    stage: SorobanFixtureError["stage"],
    message: string,
    options?: { cause?: unknown; transactionHash?: string },
  ) {
    super(`${operation} [${stage}]: ${message}`, { cause: options?.cause });
    this.name = "SorobanFixtureError";
    this.operation = operation;
    this.stage = stage;
    this.transactionHash = options?.transactionHash;
  }
}

const defaultSleep = async (milliseconds: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
};

const describeResult = (value: unknown): string => {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

export async function waitForTransaction(
  rpc: TransactionPoller,
  hash: string,
  options: WaitForTransactionOptions,
): Promise<TransactionResult> {
  const clock = options.clock ?? Date.now;
  const pollIntervalMs = options.pollIntervalMs ?? 250;
  const sleep = options.sleep ?? defaultSleep;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const deadline = clock() + timeoutMs;
  let lastStatus = "NOT_FOUND";

  while (clock() <= deadline) {
    let result: TransactionResult;
    try {
      result = await rpc.getTransaction(hash);
    } catch (cause) {
      throw new SorobanFixtureError(
        options.operation,
        "poll",
        "RPC polling failed",
        { cause, transactionHash: hash },
      );
    }

    lastStatus = result.status;
    if (result.status === "SUCCESS") {
      return result;
    }
    if (result.status !== "NOT_FOUND") {
      throw new SorobanFixtureError(
        options.operation,
        "result",
        `transaction finished with ${result.status}: ${describeResult(result)}`,
        { transactionHash: hash },
      );
    }
    if (clock() >= deadline) break;
    await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - clock())));
  }

  throw new SorobanFixtureError(
    options.operation,
    "poll",
    `timed out after ${timeoutMs}ms (last status: ${lastStatus})`,
    { transactionHash: hash },
  );
}

export interface SorobanTransportOptions {
  networkPassphrase: string;
  pollIntervalMs?: number;
  rpc: rpc.Server;
  transactionTimeoutMs?: number;
  /**
   * When provided, every transaction submitted through this transport is
   * wrapped in a fee-bump envelope.  On TransientError / TimeoutError the
   * inner XDR is re-wrapped with a doubled fee (capped at maxFeeStroops) and
   * resubmitted up to maxRetries times.  This mirrors the frontend's
   * submitWithFeeBump behaviour so integration tests can exercise fee
   * escalation paths without a browser environment.
   *
   * When omitted the transport behaves exactly as before (backward-compatible).
   */
  feeBumpConfig?: FeeBumpConfig;
}

export class SorobanTransport implements FixtureTransport {
  private readonly networkPassphrase: string;
  private readonly pollIntervalMs: number;
  private readonly rpc: rpc.Server;
  private readonly transactionTimeoutMs: number;
  private readonly wasmHashes = new Map<string, string>();
  private readonly feeBumpConfig?: FeeBumpConfig;

  constructor(options: SorobanTransportOptions) {
    this.networkPassphrase = options.networkPassphrase;
    this.pollIntervalMs = options.pollIntervalMs ?? 250;
    this.rpc = options.rpc;
    this.transactionTimeoutMs = options.transactionTimeoutMs ?? 30_000;
    this.feeBumpConfig = options.feeBumpConfig;
  }

  async uploadWasm(request: UploadWasmRequest): Promise<string> {
    const cached = this.wasmHashes.get(request.wasmPath);
    if (cached) return cached;

    const operation = `upload ${request.label}`;
    try {
      const wasmBytes = fs.readFileSync(request.wasmPath);
      const account = await this.rpc.getAccount(request.source.publicKey());
      const transaction = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(Operation.uploadContractWasm({ wasm: wasmBytes }))
        .setTimeout(60)
        .build();
      const result = await this.submit(transaction, request.source, operation);
      const wasmHash = this.returnValue(result)
        .bytes()
        .toString("hex");
      if (!wasmHash) {
        throw new SorobanFixtureError(
          operation,
          "result",
          "transaction returned no WASM hash",
          { transactionHash: result.txHash },
        );
      }
      this.wasmHashes.set(request.wasmPath, wasmHash);
      return wasmHash;
    } catch (cause) {
      this.wasmHashes.delete(request.wasmPath);
      if (cause instanceof SorobanFixtureError) throw cause;
      throw new SorobanFixtureError(operation, "prepare", String(cause), {
        cause,
      });
    }
  }

  async deployContract(request: DeployContractRequest): Promise<string> {
    const operation = `deploy ${request.label}`;
    try {
      const account = await this.rpc.getAccount(request.source.publicKey());
      const transaction = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          Operation.createCustomContract({
            address: new Address(request.source.publicKey()),
            ...(request.constructorArgs
              ? { constructorArgs: request.constructorArgs }
              : {}),
            salt: request.salt,
            wasmHash: Buffer.from(request.wasmHash, "hex"),
          }),
        )
        .setTimeout(60)
        .build();
      const result = await this.submit(transaction, request.source, operation);
      const contractId = Address.fromScVal(this.returnValue(result)).toString();
      if (!contractId) {
        throw new SorobanFixtureError(
          operation,
          "result",
          "transaction returned no contract ID",
          { transactionHash: result.txHash },
        );
      }
      return contractId;
    } catch (cause) {
      if (cause instanceof SorobanFixtureError) throw cause;
      throw new SorobanFixtureError(operation, "prepare", String(cause), {
        cause,
      });
    }
  }

  async invokeContract(request: InvokeContractRequest): Promise<xdr.ScVal> {
    const operation = `invoke ${request.label}`;
    try {
      const account = await this.rpc.getAccount(request.source.publicKey());
      const transaction = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          new Contract(request.contractId).call(request.method, ...request.args),
        )
        .setTimeout(60)
        .build();
      const result = await this.submit(transaction, request.source, operation);
      return this.returnValue(result);
    } catch (cause) {
      if (cause instanceof SorobanFixtureError) throw cause;
      throw new SorobanFixtureError(operation, "prepare", String(cause), {
        cause,
      });
    }
  }

  private returnValue(
    result: Extract<TransactionResult, { status: "SUCCESS" }>,
  ): xdr.ScVal {
    const returnValue = result.returnValue;
    if (!returnValue) {
      throw new SorobanFixtureError(
        "decode transaction result",
        "result",
        "successful transaction had no Soroban return value",
        { transactionHash: result.txHash },
      );
    }
    return returnValue;
  }

  private async submit(
    transaction: Parameters<rpc.Server["prepareTransaction"]>[0],
    source: UploadWasmRequest["source"],
    operation: string,
  ): Promise<Extract<TransactionResult, { status: "SUCCESS" }>> {
    // ── Prepare & sign the inner transaction ──────────────────────────────────
    let prepared: Awaited<ReturnType<rpc.Server["prepareTransaction"]>>;
    try {
      prepared = await this.rpc.prepareTransaction(transaction);
      prepared.sign(source);
    } catch (cause) {
      throw new SorobanFixtureError(operation, "prepare", "preparation failed", {
        cause,
      });
    }

    // ── If no fee-bump config is set, use the original single-attempt path ────
    if (!this.feeBumpConfig) {
      return this.sendAndPoll(prepared, operation);
    }

    // ── Fee-bump retry path ───────────────────────────────────────────────────
    const cfg = this.feeBumpConfig;
    let currentFee = cfg.initialFeeStroops;
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
      // On retries, escalate before building the next envelope.
      if (attempt > 0) {
        const next = Math.min(currentFee * 2, cfg.maxFeeStroops);
        if (currentFee >= cfg.maxFeeStroops) {
          throw new SorobanFixtureError(
            operation,
            "send",
            `fee-bump exhausted: fee ${currentFee} reached cap ${cfg.maxFeeStroops}`,
            { cause: lastError ?? undefined },
          );
        }
        currentFee = next;
      }

      const feeBumpTx = TransactionBuilder.buildFeeBumpTransaction(
        cfg.feeBumpSource,
        String(currentFee),
        prepared,
        this.networkPassphrase,
      );
      feeBumpTx.sign(cfg.feeBumpSource);

      try {
        return await this.sendAndPoll(feeBumpTx, operation);
      } catch (err) {
        lastError = err;

        // Only poll-timeout errors are retryable.
        const isTimeout =
          err instanceof SorobanFixtureError && err.stage === "poll";
        if (!isTimeout || attempt >= cfg.maxRetries) throw err;

        // Exponential back-off before next attempt.
        const waitMs = cfg.backoffMs * Math.pow(2, attempt);
        await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
      }
    }

    // This line is only reached when maxRetries is 0 and the loop exits
    // without throwing — surface the last error as a fixture error.
    throw new SorobanFixtureError(
      operation,
      "send",
      "fee-bump retry loop exited without a result",
      { cause: lastError ?? undefined },
    );
  }

  /** Send a prepared/signed transaction and poll until SUCCESS. */
  private async sendAndPoll(
    tx: Parameters<rpc.Server["sendTransaction"]>[0],
    operation: string,
  ): Promise<Extract<TransactionResult, { status: "SUCCESS" }>> {
    let submission: Awaited<ReturnType<rpc.Server["sendTransaction"]>>;
    try {
      submission = await this.rpc.sendTransaction(tx);
    } catch (cause) {
      throw new SorobanFixtureError(operation, "send", "submission failed", {
        cause,
      });
    }
    if (
      submission.status !== "PENDING" &&
      submission.status !== "DUPLICATE"
    ) {
      throw new SorobanFixtureError(
        operation,
        "send",
        `submission returned ${submission.status}: ${describeResult(submission)}`,
        { transactionHash: submission.hash },
      );
    }
    if (!submission.hash) {
      throw new SorobanFixtureError(
        operation,
        "send",
        `submission returned no hash: ${describeResult(submission)}`,
      );
    }

    const result = await waitForTransaction(this.rpc, submission.hash, {
      operation,
      pollIntervalMs: this.pollIntervalMs,
      timeoutMs: this.transactionTimeoutMs,
    });
    if (result.status !== "SUCCESS") {
      throw new SorobanFixtureError(
        operation,
        "result",
        `unexpected transaction status ${result.status}`,
        { transactionHash: submission.hash },
      );
    }
    return result;
  }
}
