import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Hoist mock functions so they are available inside vi.mock factory (which is
// hoisted to the top of the module before variable declarations).
const mockSimulate = vi.hoisted(() => vi.fn());
const mockSend = vi.hoisted(() => vi.fn());
const mockGet = vi.hoisted(() => vi.fn());
const mockGetLatestLedger = vi.hoisted(() => vi.fn());
const mockGetEvents = vi.hoisted(() => vi.fn());
const mockAssemble = vi.hoisted(() => vi.fn());
const mockIsSimError = vi.hoisted(() => vi.fn());
const mockScValToNative = vi.hoisted(() => vi.fn((value) => value));

vi.mock("@stellar/stellar-sdk", () => ({
  Networks: {
    PUBLIC: "Public Global Stellar Network ; September 2015",
    TESTNET: "Test SDF Network ; September 2015",
  },
  TransactionBuilder: {
    fromXDR: vi.fn(() => ({ toXDR: () => "mock-xdr" })),
  },
  scValToNative: mockScValToNative,
  rpc: {
    Server: vi.fn(() => ({
      simulateTransaction: mockSimulate,
      sendTransaction: mockSend,
      getTransaction: mockGet,
      getLatestLedger: mockGetLatestLedger,
      getEvents: mockGetEvents,
    })),
    Api: {
      isSimulationError: mockIsSimError,
    },
    assembleTransaction: mockAssemble,
  },
}));

// Mock networkStore so stellar.ts can initialise without localStorage
vi.mock("../networkStore", () => ({
  useNetworkStore: {
    getState: () => ({ network: "testnet" }),
  },
}));

import {
  simulateAndSend,
  decodeContractError,
  validateStellarAddress,
  fetchContractEvents,
  normalizeContractEvent,
  getRpcUrl,
  getNetworkPassphrase,
} from "../stellar";

beforeEach(() => {
  vi.clearAllMocks();
  mockIsSimError.mockReturnValue(false);
  mockAssemble.mockReturnValue({ build: () => ({ toXDR: () => "assembled-xdr" }) });
  mockScValToNative.mockImplementation((value) => value);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("network config resolution (#451 custom RPC support)", () => {
  it("resolves the built-in testnet RPC URL and passphrase by default", () => {
    expect(getRpcUrl()).toBe("https://soroban-testnet.stellar.org");
    expect(getNetworkPassphrase()).toBe("Test SDF Network ; September 2015");
  });

  it("honors a VITE_SOROBAN_RPC_URL override", () => {
    vi.stubEnv("VITE_SOROBAN_RPC_URL", "https://custom-rpc.example.com");
    expect(getRpcUrl()).toBe("https://custom-rpc.example.com");
  });

  it("honors a VITE_STELLAR_NETWORK_PASSPHRASE override", () => {
    vi.stubEnv("VITE_STELLAR_NETWORK_PASSPHRASE", "Custom Network ; 2026");
    expect(getNetworkPassphrase()).toBe("Custom Network ; 2026");
  });
});

describe("decodeContractError", () => {
  it("decodes known kyc error codes", () => {
    expect(decodeContractError("kyc", 1)).toBe("Contract already initialized");
    expect(decodeContractError("kyc", 2)).toBe("Not an authorized verifier");
  });

  it("decodes known compliance error codes", () => {
    expect(decodeContractError("compliance", 1)).toBe("Contract already initialized");
  });

  it("returns an unknown-error fallback for unrecognised codes", () => {
    const msg = decodeContractError("kyc", 999);
    expect(msg).toMatch(/unknown/i);
    expect(msg).toContain("999");
  });
});

describe("validateStellarAddress", () => {
  it("accepts a valid 56-char G address", () => {
    expect(validateStellarAddress("GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNA")).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(validateStellarAddress("")).toBe(false);
  });

  it("rejects addresses that start with S (secret seed)", () => {
    expect(validateStellarAddress("SAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN")).toBe(false);
  });
});

describe("simulateAndSend", () => {
  const mockSignTx = vi.fn(async (xdr: string) => `signed:${xdr}`);

  it("returns the transaction result on success", async () => {
    mockIsSimError.mockReturnValue(false);
    mockSend.mockResolvedValue({ status: "PENDING", hash: "abc123" });
    mockGet.mockResolvedValue({ status: "SUCCESS", resultXdr: "result" });

    const result = await simulateAndSend("fake-xdr", mockSignTx);
    expect(result.status).toBe("SUCCESS");
    expect(mockSignTx).toHaveBeenCalledWith("assembled-xdr");
  });

  it("throws when simulation returns an error", async () => {
    mockIsSimError.mockReturnValue(true);
    mockSimulate.mockResolvedValue({ error: "ContractError (code=3)" });

    await expect(simulateAndSend("fake-xdr", mockSignTx)).rejects.toThrow(
      /Contract error/,
    );
  });

  it("throws when the transaction send status is ERROR", async () => {
    mockIsSimError.mockReturnValue(false);
    mockSend.mockResolvedValue({ status: "ERROR", errorResult: { msg: "bad" } });

    await expect(simulateAndSend("fake-xdr", mockSignTx)).rejects.toThrow(
      /Transaction failed/,
    );
  });

  it("throws when the final transaction status is not SUCCESS", async () => {
    mockIsSimError.mockReturnValue(false);
    mockSend.mockResolvedValue({ status: "PENDING", hash: "abc123" });
    mockGet.mockResolvedValue({ status: "FAILED" });

    await expect(simulateAndSend("fake-xdr", mockSignTx)).rejects.toThrow(
      /not successful/i,
    );
  });
});

describe("contract event fetching", () => {
  const baseEvent = {
    id: "0001",
    type: "contract" as const,
    ledger: 123456,
    ledgerClosedAt: "2026-07-22T17:00:00Z",
    pagingToken: "cursor-1",
    inSuccessfulContractCall: true,
    txHash: "abc",
    contractId: { contractId: () => "CCONTRACT" },
    topic: ["transfer"],
    value: { amount: 42n, to: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNA" },
  };

  it("normalizes decoded RPC events into UI-safe contract events", () => {
    const event = normalizeContractEvent(baseEvent as never);

    expect(event).toMatchObject({
      id: "0001",
      type: "transfer",
      amount: "42",
      counterparty: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNA",
      contractId: "CCONTRACT",
      ledger: 123456,
      txHash: "abc",
      timestamp: "2026-07-22T17:00:00Z",
      topics: ["transfer"],
    });
    expect(event.value).toEqual({ amount: "42", to: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNA" });
  });

  it("queries Soroban RPC events for the requested contract", async () => {
    mockGetLatestLedger.mockResolvedValue({ sequence: 125000 });
    mockGetEvents.mockResolvedValue({ latestLedger: 125000, events: [baseEvent as never] });

    const events = await fetchContractEvents("CCONTRACT", { limit: 5, topicFilters: [["transfer"]] });

    expect(mockGetEvents).toHaveBeenCalledWith({
      startLedger: 115000,
      limit: 5,
      filters: [{ type: "contract", contractIds: ["CCONTRACT"], topics: [["transfer"]] }],
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("transfer");
  });

  it("uses a cursor for paginated event queries", async () => {
    mockGetEvents.mockResolvedValue({ latestLedger: 125000, events: [baseEvent as never] });

    await fetchContractEvents("CCONTRACT", { cursor: "cursor-1", limit: 10, successfulOnly: false });

    expect(mockGetLatestLedger).not.toHaveBeenCalled();
    expect(mockGetEvents).toHaveBeenCalledWith({
      cursor: "cursor-1",
      limit: 10,
      filters: [{ type: "contract", contractIds: ["CCONTRACT"] }],
    });
  });

  it("returns an empty list when no contract id is configured", async () => {
    await expect(fetchContractEvents("", 5)).resolves.toEqual([]);
    expect(mockGetEvents).not.toHaveBeenCalled();
  });
});
