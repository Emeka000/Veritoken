/**
 * MockSorobanRpc — lightweight in-process RPC double for fee-bump tests.
 *
 * Simulates a Soroban RPC node that returns PENDING (timeout) for the first
 * N submissions and then SUCCESS.  All XDR parsing is bypassed so tests run
 * without a real network or wallet.
 *
 * Usage:
 *   const mock = new MockSorobanRpc({ pendingCount: 2 });
 *   // First two calls to sendTransaction → hash with status PENDING that
 *   // never resolves in getTransaction (simulating a timeout).
 *   // Third call → SUCCESS.
 */

export interface MockTransactionResult {
  status: "SUCCESS" | "NOT_FOUND" | "FAILED";
  txHash?: string;
  returnValue?: unknown;
}

export interface MockSendResult {
  status: "PENDING" | "DUPLICATE" | "ERROR" | "TRY_AGAIN_LATER";
  hash: string;
  errorResult?: unknown;
}

export interface MockSorobanRpcOptions {
  /**
   * How many times sendTransaction returns a PENDING hash that then
   * never resolves (simulating a network timeout on poll).
   * After pendingCount submissions the next call returns a SUCCESS hash
   * that resolves immediately in getTransaction.
   */
  pendingCount: number;

  /**
   * Optional counter start value (default 0).  Useful when constructing
   * multiple mocks in sequence without hash collisions.
   */
  hashSeed?: number;
}

// ── Mock RPC class ─────────────────────────────────────────────────────────────

export class MockSorobanRpc {
  /** Total number of sendTransaction calls received. */
  sendCount = 0;
  /** Total number of getTransaction calls received. */
  pollCount = 0;
  /** Hashes that have been "sent" and are considered permanently pending. */
  readonly pendingHashes = new Set<string>();
  /** Hash of the transaction that was finally accepted. */
  successHash: string | null = null;

  private pendingCount: number;
  private hashCounter: number;

  constructor(options: MockSorobanRpcOptions) {
    this.pendingCount = options.pendingCount;
    this.hashCounter = options.hashSeed ?? 0;
  }

  // ── sendTransaction ─────────────────────────────────────────────────────────

  /**
   * Accepts any transaction object (XDR not inspected).
   * Returns PENDING for the first pendingCount calls, SUCCESS hash thereafter.
   */
  sendTransaction(_tx: unknown): MockSendResult {
    this.sendCount += 1;
    const hash = this.nextHash();

    if (this.sendCount <= this.pendingCount) {
      // Mark as permanently pending so getTransaction always returns NOT_FOUND.
      this.pendingHashes.add(hash);
      return { status: "PENDING", hash };
    }

    // This is the "success" submission.
    this.successHash = hash;
    return { status: "PENDING", hash };
  }

  // ── getTransaction ──────────────────────────────────────────────────────────

  /**
   * Returns NOT_FOUND for hashes in pendingHashes (simulating a stalled
   * transaction that causes a poll timeout), and SUCCESS for the accepted hash.
   */
  getTransaction(hash: string): MockTransactionResult {
    this.pollCount += 1;

    if (this.pendingHashes.has(hash)) {
      return { status: "NOT_FOUND" };
    }

    if (hash === this.successHash) {
      return {
        status: "SUCCESS",
        txHash: hash,
        returnValue: null,
      };
    }

    // Unknown hash — treat as not yet indexed.
    return { status: "NOT_FOUND" };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private nextHash(): string {
    this.hashCounter += 1;
    return `mock-tx-hash-${this.hashCounter.toString().padStart(4, "0")}`;
  }

  /**
   * Reset all counters and state.  Useful for running multiple scenarios in a
   * single test file without recreating the mock.
   */
  reset(newPendingCount?: number): void {
    this.sendCount = 0;
    this.pollCount = 0;
    this.pendingHashes.clear();
    this.successHash = null;
    if (newPendingCount !== undefined) {
      this.pendingCount = newPendingCount;
    }
  }
}
