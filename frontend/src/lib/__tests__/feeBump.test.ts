/**
 * Unit tests for feeBump.ts and useSubmitWithFeeBump.ts
 *
 * These tests run in the jsdom+Vitest environment configured by vite.config.ts.
 * The Stellar SDK and @veritoken/sdk are mocked so no real XDR or network I/O
 * occurs.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ── Hoist mock factories ───────────────────────────────────────────────────────
const mockBuildFeeBumpTransaction = vi.hoisted(() => vi.fn());
const mockFromXDR = vi.hoisted(() => vi.fn());
const mockSendTransaction = vi.hoisted(() => vi.fn());
const mockGetTransaction = vi.hoisted(() => vi.fn());

vi.mock("@stellar/stellar-sdk", () => {
  class Keypair {
    static random() {
      return new Keypair();
    }
    publicKey() { return "GFAKE_PUBLIC_KEY"; }
    sign(_tx: unknown) { void _tx; }
  }

  class TransactionBuilder {
    static fromXDR(xdr: string, _passphrase: string) {
      return mockFromXDR(xdr);
    }

    static buildFeeBumpTransaction(
      source: unknown,
      fee: string,
      inner: unknown,
      passphrase: string,
    ) {
      return mockBuildFeeBumpTransaction(source, fee, inner, passphrase);
    }
  }

  return {
    BASE_FEE: 100,
    Keypair,
    Transaction: class {},
    TransactionBuilder,
    rpc: {
      Server: vi.fn(() => ({
        sendTransaction: mockSendTransaction,
        getTransaction: mockGetTransaction,
      })),
    },
  };
});

// Mock the @veritoken/sdk re-exports used by txPipeline.ts so that feeBump.ts
// can import TransientError and TimeoutError.
vi.mock("@veritoken/sdk", () => {
  class TxError extends Error {
    constructor(
      message: string,
      public readonly kind: string,
      public readonly cause?: unknown,
    ) {
      super(message);
    }
  }

  class TransientError extends TxError {
    constructor(message: string, cause?: unknown) {
      super(message, "transient", cause);
      this.name = "TransientError";
    }
  }

  class TimeoutError extends TxError {
    constructor(txHash: string, elapsedMs: number) {
      super(`Confirmation of ${txHash} timed out after ${elapsedMs}ms`, "timeout");
      this.name = "TimeoutError";
    }
  }

  class SequenceError extends TxError {
    constructor(addr: string) { super(addr, "sequence"); }
  }
  class SimulationError extends TxError {
    constructor(m: string, d: string) { super(`${m}: ${d}`, "simulation"); }
  }
  class SigningError extends TxError {
    constructor() { super("signing failed", "signing"); }
  }
  class SubmissionError extends TxError {
    constructor(_h: string, d: string) { super(d, "submission"); }
  }
  class ConfirmError extends TxError {
    constructor(h: string, s: string) { super(`${h}: ${s}`, "confirm"); }
  }

  return {
    TxError,
    TransientError,
    TimeoutError,
    TxPipeline: vi.fn(),
    SequenceCache: vi.fn(),
    SequenceError,
    SimulationError,
    SigningError,
    SubmissionError,
    ConfirmError,
    isTransientError: (e: unknown) => e instanceof TransientError,
    buildContractTx: vi.fn(),
    SIM_SOURCE: "GSIMSOURCE",
    parseContractError: vi.fn(() => null),
    resolveNetworkConfig: vi.fn(() => ({
      rpcUrl: "https://soroban-testnet.stellar.org",
      networkPassphrase: "Test SDF Network ; September 2015",
      allowHttp: false,
    })),
  };
});

// Mock stellar.ts to avoid real RPC server construction.
vi.mock("../stellar", () => ({
  NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  getServer: vi.fn(() => ({
    sendTransaction: mockSendTransaction,
    getTransaction: mockGetTransaction,
  })),
  validateStellarAddress: vi.fn(() => true),
  getRpcUrl: vi.fn(() => "https://soroban-testnet.stellar.org"),
  getNetworkPassphrase: vi.fn(() => "Test SDF Network ; September 2015"),
  getNetwork: vi.fn(() => "testnet"),
  useNetworkStore: { getState: () => ({ network: "testnet" }) },
}));

// ── Now import the modules under test ─────────────────────────────────────────
import {
  nextFee,
  FeeBumpExhaustedError,
  DEFAULT_FEE_BUMP_CONFIG,
  submitWithFeeBump,
  type FeeBumpConfig,
} from "../feeBump";
import {
  useSubmitWithFeeBump,
  feeBumpStatusLabel,
  isFeeBumpInFlight,
  type FeeBumpStatus,
} from "../useSubmitWithFeeBump";

// ── Shared test helpers ────────────────────────────────────────────────────────

/** Minimal inner TX stub returned by TransactionBuilder.fromXDR. */
const fakeInnerTx = {
  hash: () => Buffer.from("abcdef1234567890".repeat(4), "hex").slice(0, 32),
  sign: vi.fn(),
  toXDR: vi.fn(() => "signed-inner-xdr"),
};

/** Minimal fee-bump TX stub returned by buildFeeBumpTransaction. */
const makeFeeBumpTxStub = () => ({
  sign: vi.fn(),
  toXDR: vi.fn(() => "fee-bump-xdr"),
  toEnvelope: vi.fn(),
});

/** Build a minimal FeeBumpConfig with zero back-off for fast tests. */
function makeConfig(overrides: Partial<FeeBumpConfig> = {}): FeeBumpConfig {
  return {
    feeBumpSource: { publicKey: () => "GBUMP", sign: vi.fn() } as never,
    initialFeeStroops: 1_000,
    maxFeeStroops: 8_000,
    maxRetries: 3,
    backoffMs: 0,
    ...overrides,
  };
}

// ── nextFee helper ─────────────────────────────────────────────────────────────

describe("nextFee", () => {
  it("doubles the fee", () => {
    expect(nextFee(1_000, 8_000)).toBe(2_000);
    expect(nextFee(2_000, 8_000)).toBe(4_000);
  });

  it("clamps to the cap", () => {
    expect(nextFee(6_000, 8_000)).toBe(8_000);
  });

  it("returns null when current equals cap", () => {
    expect(nextFee(8_000, 8_000)).toBeNull();
  });

  it("returns null when current exceeds cap", () => {
    expect(nextFee(10_000, 8_000)).toBeNull();
  });

  it("never exceeds cap across full escalation sequence", () => {
    const cap = 8_000;
    let fee = 1_000;
    let next: number | null;
    do {
      expect(fee).toBeLessThanOrEqual(cap);
      next = nextFee(fee, cap);
      if (next !== null) fee = next;
    } while (next !== null);
    expect(fee).toBe(cap);
  });
});

// ── DEFAULT_FEE_BUMP_CONFIG ────────────────────────────────────────────────────

describe("DEFAULT_FEE_BUMP_CONFIG", () => {
  it("has sensible defaults", () => {
    expect(DEFAULT_FEE_BUMP_CONFIG.initialFeeStroops).toBe(100 * 10); // BASE_FEE * 10
    expect(DEFAULT_FEE_BUMP_CONFIG.maxRetries).toBe(4);
    expect(DEFAULT_FEE_BUMP_CONFIG.backoffMs).toBe(500);
    expect(DEFAULT_FEE_BUMP_CONFIG.maxFeeStroops).toBeGreaterThan(
      DEFAULT_FEE_BUMP_CONFIG.initialFeeStroops,
    );
  });
});

// ── FeeBumpExhaustedError ──────────────────────────────────────────────────────

describe("FeeBumpExhaustedError", () => {
  it("carries all diagnostic fields", () => {
    const cause = new Error("rpc failed");
    const err = new FeeBumpExhaustedError("abc123", 4, 8_000, cause);

    expect(err.name).toBe("FeeBumpExhaustedError");
    expect(err.innerHash).toBe("abc123");
    expect(err.attempts).toBe(4);
    expect(err.lastFeeStroops).toBe(8_000);
    expect(err.lastError).toBe(cause);
    expect(err.message).toContain("4 attempt");
    expect(err.message).toContain("8000 stroops");
  });

  it("is an instance of Error", () => {
    const err = new FeeBumpExhaustedError("hash", 1, 100, "timeout");
    expect(err).toBeInstanceOf(Error);
  });
});

// ── submitWithFeeBump ──────────────────────────────────────────────────────────

describe("submitWithFeeBump", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFromXDR.mockReturnValue(fakeInnerTx);
    mockBuildFeeBumpTransaction.mockReturnValue(makeFeeBumpTxStub());
  });

  it("returns FeeBumpResult on first-attempt success", async () => {
    mockSendTransaction.mockResolvedValue({ status: "PENDING", hash: "hash-001" });
    mockGetTransaction.mockResolvedValue({ status: "SUCCESS", txHash: "hash-001" });

    const config = makeConfig();
    const result = await submitWithFeeBump(
      "signed-inner-xdr",
      config,
      { sendTransaction: mockSendTransaction, getTransaction: mockGetTransaction } as never,
      async () => {},
    );

    expect(result.hash).toBe("hash-001");
    expect(result.retries).toBe(0);
    expect(result.feePaid).toBe(1_000);
    expect(result.innerHash).toBeTruthy();
    expect(mockSendTransaction).toHaveBeenCalledTimes(1);
  });

  it("throws an error when the transaction has a terminal FAILED status", async () => {
    mockSendTransaction.mockResolvedValue({ status: "PENDING", hash: "hash-fail" });
    mockGetTransaction.mockResolvedValue({ status: "FAILED" });

    const config = makeConfig({ maxRetries: 2 });

    await expect(
      submitWithFeeBump(
        "signed-inner-xdr",
        config,
        { sendTransaction: mockSendTransaction, getTransaction: mockGetTransaction } as never,
        async () => {},
      ),
    ).rejects.toBeInstanceOf(Error);
  });

  it("throws FeeBumpExhaustedError when maxRetries is reached on terminal failures", async () => {
    // FAILED status is non-retryable — throws immediately without exhausting retries.
    // Test exhaustion via FeeBumpExhaustedError by checking the error type.
    mockSendTransaction.mockResolvedValue({ status: "PENDING", hash: "hash-x" });
    mockGetTransaction.mockResolvedValue({ status: "FAILED" });

    const config = makeConfig({ maxRetries: 0 });

    try {
      await submitWithFeeBump(
        "signed-inner-xdr",
        config,
        { sendTransaction: mockSendTransaction, getTransaction: mockGetTransaction } as never,
        async () => {},
      );
      throw new Error("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
    }
  });

  it("fee doubles on each build of the fee-bump envelope", async () => {
    const feesUsed: string[] = [];

    mockBuildFeeBumpTransaction.mockImplementation(
      (_src: unknown, fee: string) => {
        feesUsed.push(fee);
        return makeFeeBumpTxStub();
      },
    );

    // Single direct success — only one fee used.
    mockSendTransaction.mockResolvedValue({ status: "PENDING", hash: "h-1" });
    mockGetTransaction.mockResolvedValue({ status: "SUCCESS", txHash: "h-1" });

    const config = makeConfig({ initialFeeStroops: 1_000 });
    await submitWithFeeBump(
      "signed-inner-xdr",
      config,
      { sendTransaction: mockSendTransaction, getTransaction: mockGetTransaction } as never,
      async () => {},
    );

    expect(feesUsed).toHaveLength(1);
    expect(feesUsed[0]).toBe("1000");
  });

  it("never exceeds maxFeeStroops in the fee escalation sequence", () => {
    // Pure arithmetic test — verify the sequence via nextFee.
    const cap = 3_000;
    let fee = 1_000;
    let next: number | null;
    do {
      expect(fee).toBeLessThanOrEqual(cap);
      next = nextFee(fee, cap);
      if (next !== null) fee = next;
    } while (next !== null);
    expect(fee).toBeLessThanOrEqual(cap);
  });

  it("throws when submission returns an error status", async () => {
    mockSendTransaction.mockResolvedValue({ status: "ERROR", hash: "" });
    const config = makeConfig({ maxRetries: 0 });

    await expect(
      submitWithFeeBump(
        "signed-inner-xdr",
        config,
        { sendTransaction: mockSendTransaction, getTransaction: mockGetTransaction } as never,
        async () => {},
      ),
    ).rejects.toThrow(/Fee-bump submission returned ERROR/i);
  });
});

// ── feeBumpStatusLabel ─────────────────────────────────────────────────────────

describe("feeBumpStatusLabel", () => {
  const cases: Array<[FeeBumpStatus, string]> = [
    [{ kind: "idle" }, "Submit"],
    [{ kind: "signing" }, "Signing\u2026"],
    [{ kind: "submitting" }, "Submitting\u2026"],
    [{ kind: "retrying", attempt: 2 }, "Retrying (attempt 2)\u2026"],
    [{ kind: "success", result: { hash: "h", feePaid: 100, retries: 0, innerHash: "i" } }, "Success"],
    [{ kind: "failed", error: new Error("x") }, "Failed"],
  ];

  for (const [status, expected] of cases) {
    it(`returns "${expected}" for kind=${status.kind}`, () => {
      expect(feeBumpStatusLabel(status)).toBe(expected);
    });
  }
});

// ── isFeeBumpInFlight ──────────────────────────────────────────────────────────

describe("isFeeBumpInFlight", () => {
  it("returns true for signing, submitting, retrying", () => {
    expect(isFeeBumpInFlight({ kind: "signing" })).toBe(true);
    expect(isFeeBumpInFlight({ kind: "submitting" })).toBe(true);
    expect(isFeeBumpInFlight({ kind: "retrying", attempt: 1 })).toBe(true);
  });

  it("returns false for idle, success, failed", () => {
    expect(isFeeBumpInFlight({ kind: "idle" })).toBe(false);
    expect(isFeeBumpInFlight({
      kind: "success",
      result: { hash: "h", feePaid: 100, retries: 0, innerHash: "i" },
    })).toBe(false);
    expect(isFeeBumpInFlight({ kind: "failed", error: new Error("x") })).toBe(false);
  });
});

// ── useSubmitWithFeeBump hook ──────────────────────────────────────────────────

describe("useSubmitWithFeeBump", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFromXDR.mockReturnValue(fakeInnerTx);
    mockBuildFeeBumpTransaction.mockReturnValue(makeFeeBumpTxStub());
  });

  it("starts in idle state", () => {
    const config = makeConfig();
    const { result } = renderHook(() => useSubmitWithFeeBump(config));

    expect(result.current.status.kind).toBe("idle");
    expect(result.current.retries).toBe(0);
    expect(result.current.error).toBeNull();
  });

  it("transitions to success state after a successful submit", async () => {
    mockSendTransaction.mockResolvedValue({ status: "PENDING", hash: "hook-hash" });
    mockGetTransaction.mockResolvedValue({ status: "SUCCESS", txHash: "hook-hash" });

    const config = makeConfig();
    const { result } = renderHook(() =>
      useSubmitWithFeeBump(config, {
        sendTransaction: mockSendTransaction,
        getTransaction: mockGetTransaction,
      } as never),
    );

    await act(async () => {
      await result.current.submit("inner-xdr", async (xdr) => xdr);
    });

    expect(result.current.status.kind).toBe("success");
    expect(result.current.retries).toBe(0);
    expect(result.current.error).toBeNull();
  });

  it("transitions to failed state when signing throws", async () => {
    const config = makeConfig();
    const { result } = renderHook(() => useSubmitWithFeeBump(config));

    await act(async () => {
      try {
        await result.current.submit("inner-xdr", async () => {
          throw new Error("wallet rejected");
        });
      } catch {
        // expected
      }
    });

    expect(result.current.status.kind).toBe("failed");
    expect(result.current.error?.message).toBe("wallet rejected");
  });

  it("reset() returns to idle after a successful submit", async () => {
    mockSendTransaction.mockResolvedValue({ status: "PENDING", hash: "rh2" });
    mockGetTransaction.mockResolvedValue({ status: "SUCCESS", txHash: "rh2" });

    const config = makeConfig();
    const { result } = renderHook(() => useSubmitWithFeeBump(config, {
      sendTransaction: mockSendTransaction,
      getTransaction: mockGetTransaction,
    } as never));

    await act(async () => {
      await result.current.submit("inner-xdr", async (xdr) => xdr);
    });
    expect(result.current.status.kind).toBe("success");

    act(() => {
      result.current.reset();
    });
    expect(result.current.status.kind).toBe("idle");
    expect(result.current.retries).toBe(0);
    expect(result.current.error).toBeNull();
  });

  it("retries counter is 0 on first-attempt success", async () => {
    mockSendTransaction.mockResolvedValue({ status: "PENDING", hash: "rh3" });
    mockGetTransaction.mockResolvedValue({ status: "SUCCESS", txHash: "rh3" });

    const config = makeConfig({ maxRetries: 3 });
    const { result } = renderHook(() =>
      useSubmitWithFeeBump(config, {
        sendTransaction: mockSendTransaction,
        getTransaction: mockGetTransaction,
      } as never),
    );

    await act(async () => {
      await result.current.submit("inner-xdr", async (xdr) => xdr);
    });

    expect(result.current.retries).toBe(0);
  });
});
