/**
 * Reusable mock RPC harness for SDK tests (#396).
 *
 * Wraps the minimal `rpc.Server` surface every contract client depends on —
 * `simulateTransaction`, `sendTransaction`, `getTransaction`, `getAccount`,
 * and `getEvents` — so client tests can exercise happy paths, contract
 * failures, malformed payloads, and confirmation timeouts without touching a
 * live network.
 *
 * This module has no dependency on any single contract client, so it is safe
 * to reuse for every current and future SDK client test suite.
 *
 * @example
 * ```ts
 * const server = mockServer({
 *   simulateByMethod: { balance: simSuccess(encodeI128(100n)) },
 * });
 * const client = new RwaTokenClient(CONTRACT_ID, server, PASSPHRASE);
 * expect(await client.balance(ALICE)).toBe(100n);
 * ```
 */

import { vi } from "vitest";
import {
  SorobanDataBuilder,
  TransactionBuilder,
  type rpc,
  type Transaction,
  type FeeBumpTransaction,
  type xdr,
} from "@stellar/stellar-sdk";

// ── Simulation response builders ────────────────────────────────────────────

/**
 * A successful simulation returning `retval`.
 *
 * Includes a real (empty) `SorobanDataBuilder` as `transactionData` and
 * `_parsed: true` so the response satisfies both `rpc.Api.isSimulationSuccess`
 * and the real (non-mocked) `rpc.assembleTransaction` — client write paths
 * that don't override `assemble` will work against this response unmodified.
 */
export function simSuccess(
  retval: xdr.ScVal,
  extra: Record<string, unknown> = {},
): rpc.Api.SimulateTransactionSuccessResponse {
  return {
    _parsed: true,
    result: { retval, auth: [] },
    minResourceFee: "100",
    latestLedger: 1000,
    transactionData: new SorobanDataBuilder(),
    cost: { cpuInsns: "0", memBytes: "0" },
    ...extra,
  } as unknown as rpc.Api.SimulateTransactionSuccessResponse;
}

/** A simulation that failed — contract error, resource limit, or bad input. */
export function simFailure(
  message = "Error(Contract, #3)",
): rpc.Api.SimulateTransactionErrorResponse {
  return {
    error: message,
    latestLedger: 1000,
  } as unknown as rpc.Api.SimulateTransactionErrorResponse;
}

/** A "successful" simulation with no `retval` — models a malformed RPC payload. */
export function simMalformed(): rpc.Api.SimulateTransactionSuccessResponse {
  return {
    result: undefined,
    minResourceFee: "100",
    latestLedger: 1000,
  } as unknown as rpc.Api.SimulateTransactionSuccessResponse;
}

/** A "successful" simulation whose `retval` is not a decodable ScVal. */
export function simCorruptRetval(): rpc.Api.SimulateTransactionSuccessResponse {
  return {
    result: { retval: { _switch: "not-a-real-scval" }, auth: [] },
    minResourceFee: "100",
    latestLedger: 1000,
  } as unknown as rpc.Api.SimulateTransactionSuccessResponse;
}

// ── sendTransaction response builders ───────────────────────────────────────

type SendResponse = Awaited<ReturnType<rpc.Server["sendTransaction"]>>;

export function sendPending(hash = "mockhash0000"): SendResponse {
  return { status: "PENDING", hash } as unknown as SendResponse;
}

export function sendError(detail = "bad transaction"): SendResponse {
  return {
    status: "ERROR",
    hash: "",
    errorResult: { detail },
  } as unknown as SendResponse;
}

// ── getTransaction response builders ────────────────────────────────────────

type GetTxResponse = Awaited<ReturnType<rpc.Server["getTransaction"]>>;

export function txSuccess(): GetTxResponse {
  return { status: "SUCCESS", resultXdr: "r", resultMetaXdr: null } as unknown as GetTxResponse;
}

export function txFailed(): GetTxResponse {
  return { status: "FAILED" } as unknown as GetTxResponse;
}

export function txNotFound(): GetTxResponse {
  return { status: "NOT_FOUND" } as unknown as GetTxResponse;
}

// ── Method-name extraction ──────────────────────────────────────────────────

/**
 * Pull the Soroban contract method name out of a built transaction's single
 * `invokeHostFunction` operation. Used by `mockServer` to dispatch
 * per-method simulation responses.
 */
export function extractMethodName(
  tx: Transaction | FeeBumpTransaction,
): string | undefined {
  const inner = "innerTransaction" in tx ? tx.innerTransaction : tx;
  const op = inner.operations[0];
  if (!op || op.type !== "invokeHostFunction") return undefined;
  try {
    return op.func.invokeContract().functionName().toString();
  } catch {
    return undefined;
  }
}

// ── Sequencing helper ────────────────────────────────────────────────────────

/** Returns a function that yields each value in order, repeating the last one. */
function sequencer<T>(values: T[]): () => T {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

type ResponderInput<T> = T | T[] | (() => T);

function toResponder<T>(input: ResponderInput<T> | undefined, fallback: () => T): () => T {
  if (input === undefined) return fallback;
  if (typeof input === "function") return input as () => T;
  if (Array.isArray(input)) return sequencer(input);
  return () => input;
}

// ── mockServer ───────────────────────────────────────────────────────────────

export interface MockServerConfig {
  /** Single simulate response (or sequence, or generator) used for every call. */
  simulate?: ResponderInput<rpc.Api.SimulateTransactionResponse>;
  /**
   * Per-method simulate responses, keyed by contract method name.
   * Takes priority over `simulate` when the method is present.
   * Each value may be a single response, an array (consumed in order, then
   * repeats the last entry — handy for "fails once then succeeds" tests), or
   * a generator function.
   */
  simulateByMethod?: Record<string, ResponderInput<rpc.Api.SimulateTransactionResponse>>;
  send?: ResponderInput<SendResponse>;
  getTransaction?: ResponderInput<GetTxResponse>;
  getEvents?: ResponderInput<rpc.Api.GetEventsResponse>;
  /** Latest ledger sequence returned by getLatestLedger. @default 1000 */
  latestLedger?: number;
  /** Starting sequence number string returned by getAccount. @default "1" */
  sequence?: string;
}

/**
 * Build a mock `rpc.Server` covering every RPC call BaseContractClient and
 * TxPipeline make: simulateTransaction, sendTransaction, getTransaction,
 * getAccount, getEvents, getLatestLedger. All calls are `vi.fn()` so tests
 * can assert on call count/args as well as inspect responses.
 */
export function mockServer(config: MockServerConfig = {}): rpc.Server {
  const simulateFallback = toResponder(
    config.simulate,
    () => simSuccess({} as xdr.ScVal),
  );
  const send = toResponder(config.send, () => sendPending());
  const getTx = toResponder(config.getTransaction, () => txSuccess());
  const latestLedger = config.latestLedger ?? 1000;
  const getEvents = toResponder(
    config.getEvents,
    () => ({ latestLedger, events: [] }) as unknown as rpc.Api.GetEventsResponse,
  );
  const sequence = config.sequence ?? "1";

  const byMethod = new Map(
    Object.entries(config.simulateByMethod ?? {}).map(
      ([method, input]) => [method, toResponder(input, simulateFallback)] as const,
    ),
  );

  return {
    simulateTransaction: vi.fn(
      async (tx: Transaction | FeeBumpTransaction) => {
        const method = extractMethodName(tx);
        const responder = (method && byMethod.get(method)) || simulateFallback;
        return responder();
      },
    ),
    sendTransaction: vi.fn(async () => send()),
    getTransaction: vi.fn(async () => getTx()),
    getAccount: vi.fn(async () => ({ sequence })),
    getEvents: vi.fn(async () => getEvents()),
    getLatestLedger: vi.fn(async () => ({ id: "mock", sequence: latestLedger, protocolVersion: 21 })),
  } as unknown as rpc.Server;
}

// ── Misc test helpers ────────────────────────────────────────────────────────

/** `assembleTransaction` override that skips real SorobanTransactionData wiring. */
export const mockAssemble: typeof rpc.assembleTransaction = (raw) =>
  ({ build: () => ({ toXDR: () => raw.toXDR() }) }) as unknown as ReturnType<
    typeof rpc.assembleTransaction
  >;

/** No-op sleep for PipelineOptions — keeps retry/poll/timeout tests instant. */
export const noSleep = (_ms: number): Promise<void> => Promise.resolve();

/** Re-exported so test files don't need a second import for XDR round-tripping. */
export { TransactionBuilder };
