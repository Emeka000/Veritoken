import * as fs from "node:fs";

import {
  Address,
  BASE_FEE,
  Contract,
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
}

export class SorobanTransport implements FixtureTransport {
  private readonly networkPassphrase: string;
  private readonly pollIntervalMs: number;
  private readonly rpc: rpc.Server;
  private readonly transactionTimeoutMs: number;
  private readonly wasmHashes = new Map<string, string>();

  constructor(options: SorobanTransportOptions) {
    this.networkPassphrase = options.networkPassphrase;
    this.pollIntervalMs = options.pollIntervalMs ?? 250;
    this.rpc = options.rpc;
    this.transactionTimeoutMs = options.transactionTimeoutMs ?? 30_000;
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
    let prepared: Awaited<
      ReturnType<rpc.Server["prepareTransaction"]>
    >;
    try {
      prepared = await this.rpc.prepareTransaction(transaction);
      prepared.sign(source);
    } catch (cause) {
      throw new SorobanFixtureError(operation, "prepare", "preparation failed", {
        cause,
      });
    }

    let submission: Awaited<ReturnType<rpc.Server["sendTransaction"]>>;
    try {
      submission = await this.rpc.sendTransaction(prepared);
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
