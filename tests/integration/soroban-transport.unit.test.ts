import { describe, expect, it } from "vitest";

import {
  SorobanFixtureError,
  waitForTransaction,
  type TransactionPoller,
} from "./fixtures/soroban-transport";

describe("waitForTransaction", () => {
  it("times out with the operation and transaction hash in a structured error", async () => {
    let now = 0;
    const rpc = {
      getTransaction: async () => ({ status: "NOT_FOUND" }),
    } as unknown as TransactionPoller;

    const result = waitForTransaction(rpc, "tx-timeout", {
      clock: () => now,
      operation: "deploy compliance",
      pollIntervalMs: 2,
      sleep: async (milliseconds) => {
        now += milliseconds;
      },
      timeoutMs: 5,
    });

    await expect(result).rejects.toMatchObject({
      name: "SorobanFixtureError",
      operation: "deploy compliance",
      stage: "poll",
      transactionHash: "tx-timeout",
    });
    await expect(result).rejects.toThrow("timed out after 5ms");
  });

  it("reports terminal deployment failures instead of polling forever", async () => {
    const rpc = {
      getTransaction: async () => ({
        resultXdr: "failure-xdr",
        status: "FAILED",
      }),
    } as unknown as TransactionPoller;

    await expect(
      waitForTransaction(rpc, "tx-failed", {
        operation: "deploy invoice",
      }),
    ).rejects.toMatchObject({
      operation: "deploy invoice",
      stage: "result",
      transactionHash: "tx-failed",
    });
  });

  it("wraps RPC polling errors without losing their cause", async () => {
    const rpcCause = new Error("connection reset");
    const rpc = {
      getTransaction: async () => {
        throw rpcCause;
      },
    } as unknown as TransactionPoller;

    try {
      await waitForTransaction(rpc, "tx-rpc-error", {
        operation: "upload kyc",
      });
      throw new Error("expected polling to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(SorobanFixtureError);
      expect(error).toMatchObject({
        cause: rpcCause,
        operation: "upload kyc",
        stage: "poll",
        transactionHash: "tx-rpc-error",
      });
    }
  });
});
