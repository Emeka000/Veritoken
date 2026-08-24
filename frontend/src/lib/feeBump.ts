/**
 * Fee-Bump Transaction Pipeline with Automatic Fee Escalation
 *
 * On TransientError or TimeoutError the original signed inner XDR is wrapped
 * in a fee-bump envelope (TransactionBuilder.buildFeeBumpTransaction), the fee
 * is doubled, and the envelope is resubmitted up to maxRetries times or until
 * the fee would exceed maxFeeStroops, whichever comes first.
 */

import {
  BASE_FEE,
  type Keypair,
  Transaction,
  TransactionBuilder,
  rpc,
} from "@stellar/stellar-sdk";

import { TimeoutError, TransientError } from "./txPipeline";
import { NETWORK_PASSPHRASE, getServer } from "./stellar";

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * Configuration for the fee-bump retry pipeline.
 *
 * @property feeBumpSource     - Keypair of the account that pays the fee bump.
 * @property initialFeeStroops - Starting fee per operation in stroops.
 *                               Default: BASE_FEE * 10 (1 000 stroops).
 * @property maxFeeStroops     - Hard cap. Throws FeeBumpExhaustedError when
 *                               the next doubled fee would exceed this value.
 * @property maxRetries        - Maximum retry attempts after the first send.
 *                               Default: 4.
 * @property backoffMs         - Base back-off in milliseconds.
 *                               Actual wait before retry N = backoffMs * 2^N.
 *                               Default: 500 ms.
 */
export interface FeeBumpConfig {
  feeBumpSource: Keypair;
  initialFeeStroops: number;
  maxFeeStroops: number;
  maxRetries: number;
  backoffMs: number;
}

/** Default FeeBumpConfig values. Spread-override individual fields as needed. */
export const DEFAULT_FEE_BUMP_CONFIG: Omit<FeeBumpConfig, "feeBumpSource"> = {
  initialFeeStroops: Number(BASE_FEE) * 10,   // 1 000 stroops
  maxFeeStroops: Number(BASE_FEE) * 1_000,    // 100 000 stroops
  maxRetries: 4,
  backoffMs: 500,
};

/**
 * Returned by a successful submitWithFeeBump call.
 *
 * @property hash       - Hash of the outermost transaction that landed on chain.
 * @property feePaid    - Fee (in stroops) of the transaction that succeeded.
 * @property retries    - Retry attempts made (0 = first try succeeded).
 * @property innerHash  - Hash of the original inner Soroban transaction.
 */
export interface FeeBumpResult {
  hash: string;
  feePaid: number;
  retries: number;
  innerHash: string;
}

/**
 * Thrown when all retries are exhausted or the fee cap is reached without a
 * successful submission.
 */
export class FeeBumpExhaustedError extends Error {
  /** Hash of the inner Soroban transaction that was being fee-bumped. */
  readonly innerHash: string;
  /** Total attempts made (initial + retries). */
  readonly attempts: number;
  /** The last fee tried in stroops. */
  readonly lastFeeStroops: number;
  /** The underlying error from the last attempt. */
  readonly lastError: unknown;

  constructor(
    innerHash: string,
    attempts: number,
    lastFeeStroops: number,
    lastError: unknown,
  ) {
    const reason =
      lastError instanceof Error ? lastError.message : String(lastError);
    super(
      `Fee-bump exhausted after ${attempts} attempt(s) ` +
        `(last fee: ${lastFeeStroops} stroops): ${reason}`,
    );
    this.name = "FeeBumpExhaustedError";
    this.innerHash = innerHash;
    this.attempts = attempts;
    this.lastFeeStroops = lastFeeStroops;
    this.lastError = lastError;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Returns true for errors that are safe to retry with a higher fee. */
function isRetryable(err: unknown): boolean {
  return err instanceof TransientError || err instanceof TimeoutError;
}

/**
 * Returns the next doubled fee clamped to `cap`, or `null` when `current`
 * already equals or exceeds `cap` (no further escalation possible).
 */
export function nextFee(current: number, cap: number): number | null {
  if (current >= cap) return null;
  return Math.min(current * 2, cap);
}

// ── Core pipeline function ────────────────────────────────────────────────────

/**
 * Submit a signed inner Soroban transaction XDR, retrying with fee-bump
 * envelopes on transient failures.
 *
 * Every attempt — including the first — is wrapped in a fee-bump envelope
 * so the feeBumpSource account always controls the effective fee.
 *
 * @param innerXdr - Signed Soroban inner transaction XDR (base64).
 * @param config   - Fee-bump configuration.
 * @param server   - RPC server (defaults to the active server).
 * @param sleep    - Sleep override for tests.
 *
 * @returns FeeBumpResult on success.
 * @throws  FeeBumpExhaustedError when retries are exhausted or cap is hit.
 * @throws  The original error immediately on non-retryable failures.
 */
export async function submitWithFeeBump(
  innerXdr: string,
  config: FeeBumpConfig,
  server: rpc.Server = getServer(),
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<FeeBumpResult> {
  const innerTx = TransactionBuilder.fromXDR(
    innerXdr,
    NETWORK_PASSPHRASE,
  ) as Transaction;
  const innerHash = innerTx.hash().toString("hex");

  let currentFee = config.initialFeeStroops;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    // On retries, escalate the fee before building the next envelope.
    if (attempt > 0) {
      const escalated = nextFee(currentFee, config.maxFeeStroops);
      if (escalated === null) {
        throw new FeeBumpExhaustedError(
          innerHash,
          attempt,
          currentFee,
          lastError,
        );
      }
      currentFee = escalated;
    }

    const feeBumpTx = TransactionBuilder.buildFeeBumpTransaction(
      config.feeBumpSource,
      String(currentFee),
      innerTx,
      NETWORK_PASSPHRASE,
    );
    feeBumpTx.sign(config.feeBumpSource);

    try {
      const sendResult = await server.sendTransaction(
        TransactionBuilder.fromXDR(feeBumpTx.toXDR(), NETWORK_PASSPHRASE),
      );

      if (
        sendResult.status !== "PENDING" &&
        sendResult.status !== "DUPLICATE"
      ) {
        throw new Error(`Fee-bump submission returned ${sendResult.status}`);
      }

      const hash = sendResult.hash;
      if (!hash) {
        throw new Error("Fee-bump submission returned no transaction hash");
      }

      // Poll until SUCCESS or terminal failure.
      const start = Date.now();
      const timeoutMs = 60_000;
      let pollResult = await server.getTransaction(hash);

      while (pollResult.status === "NOT_FOUND") {
        const elapsed = Date.now() - start;
        if (elapsed >= timeoutMs) {
          throw new TimeoutError(hash, elapsed);
        }
        await sleep(1_000);
        pollResult = await server.getTransaction(hash);
      }

      if (pollResult.status !== "SUCCESS") {
        throw new Error(
          `Fee-bump transaction finished with status ${pollResult.status}`,
        );
      }

      return { hash, feePaid: currentFee, retries: attempt, innerHash };
    } catch (err) {
      lastError = err;

      // Non-retryable errors (including FeeBumpExhaustedError) propagate immediately.
      if (!isRetryable(err)) throw err;

      // No more retries allowed.
      if (attempt >= config.maxRetries) break;

      // Exponential back-off before the next attempt.
      await sleep(config.backoffMs * Math.pow(2, attempt));
    }
  }

  throw new FeeBumpExhaustedError(
    innerHash,
    config.maxRetries + 1,
    currentFee,
    lastError,
  );
}
