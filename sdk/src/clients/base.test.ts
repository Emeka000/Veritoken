import { describe, it, expect, vi, beforeEach } from "vitest";
import { TransactionBuilder, Networks, nativeToScVal, xdr, rpc } from "@stellar/stellar-sdk";
import {
  buildContractTx, simulateRead, submitContractTx,
  fetchAccountSequence, BaseContractClient, SIM_SOURCE, type SignTx,
} from "./base.js";
import { encodeAddress, encodeI128 } from "../codec.js";

const PASSPHRASE  = Networks.TESTNET;
const CONTRACT_ID = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const ALICE = "GBQG2SJ7MXUH34SI3MJ2I256I5UMGM2QSQZM77YFX5S6JOHXUQJEPC3A";
const BOB   = "GAQWW5UBJVPNKMM5NLAIBEL6QK24ODXABL7YAXBN6KNMH3OYNM5JXT35";

// Build a valid "assembled" XDR string that TransactionBuilder.fromXDR can parse.
// We reuse buildContractTx with a known account + sequence to get real XDR.
const VALID_ASSEMBLED_XDR = buildContractTx(CONTRACT_ID, "transfer",
  [encodeAddress(ALICE), encodeAddress(BOB), encodeI128(1n)], PASSPHRASE, ALICE, "0");

// mockAssemble returns an object whose .build().toXDR() gives VALID_ASSEMBLED_XDR.
const mockAssemble: typeof rpc.assembleTransaction = () =>
  ({ build: () => ({ toXDR: () => VALID_ASSEMBLED_XDR }) }) as any;

// sign callback: identity – returns whatever XDR it receives unchanged
const sign: SignTx = vi.fn(async (x) => x);

// buildContractTx
describe("buildContractTx", () => {
  it("round-trips through fromXDR", () => {
    const x = buildContractTx(CONTRACT_ID, "transfer",
      [encodeAddress(ALICE), encodeAddress(BOB), encodeI128(1_000_000n)], PASSPHRASE);
    expect(() => TransactionBuilder.fromXDR(x, PASSPHRASE)).not.toThrow();
  });
  it("uses SIM_SOURCE by default", () => {
    const x = buildContractTx(CONTRACT_ID, "balance", [encodeAddress(ALICE)], PASSPHRASE);
    expect(TransactionBuilder.fromXDR(x, PASSPHRASE).source).toBe(SIM_SOURCE);
  });
  it("uses provided source and advances sequence by 1", () => {
    const x = buildContractTx(CONTRACT_ID, "mint",
      [encodeAddress(ALICE), encodeI128(500n)], PASSPHRASE, ALICE, "42");
    const tx = TransactionBuilder.fromXDR(x, PASSPHRASE);
    expect(tx.source).toBe(ALICE);
    expect(tx.sequence).toBe("43");
  });
  it("encodes a single invokeHostFunction operation", () => {
    const ops = TransactionBuilder.fromXDR(
      buildContractTx(CONTRACT_ID, "decimals", [], PASSPHRASE), PASSPHRASE).operations;
    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe("invokeHostFunction");
  });
  it("applies custom fee", () => {
    const x = buildContractTx(CONTRACT_ID, "name", [], PASSPHRASE, undefined, undefined, { fee: "9999" });
    expect(TransactionBuilder.fromXDR(x, PASSPHRASE).fee).toBe("9999");
  });
  it("produces different XDR for different methods", () => {
    expect(buildContractTx(CONTRACT_ID, "balance", [encodeAddress(ALICE)], PASSPHRASE))
      .not.toBe(buildContractTx(CONTRACT_ID, "total_supply", [], PASSPHRASE));
  });
});

// simulateRead
describe("simulateRead", () => {
  const ok = (rv: xdr.ScVal): rpc.Server =>
    ({ simulateTransaction: vi.fn().mockResolvedValue({ result: { retval: rv }, minResourceFee: "100", latestLedger: 1000 }) }) as unknown as rpc.Server;

  it("decodes i128 as bigint", async () => {
    expect(await simulateRead<bigint>(ok(nativeToScVal(7_000_000n, { type: "i128" })), CONTRACT_ID, "balance", [encodeAddress(ALICE)], PASSPHRASE)).toBe(7_000_000n);
  });
  it("decodes bool", async () => {
    expect(await simulateRead<boolean>(ok(nativeToScVal(true, { type: "bool" })), CONTRACT_ID, "is_approved", [encodeAddress(ALICE)], PASSPHRASE)).toBe(true);
  });
  it("decodes string", async () => {
    expect(await simulateRead<string>(ok(nativeToScVal("Carbon Token", { type: "string" })), CONTRACT_ID, "name", [], PASSPHRASE)).toBe("Carbon Token");
  });
  it("decodes u32", async () => {
    expect(await simulateRead<number>(ok(nativeToScVal(7, { type: "u32" })), CONTRACT_ID, "decimals", [], PASSPHRASE)).toBe(7);
  });
  it("round-trips max i128", async () => {
    const max = 170141183460469231731687303715884105727n;
    expect(await simulateRead<bigint>(ok(nativeToScVal(max, { type: "i128" })), CONTRACT_ID, "total_supply", [], PASSPHRASE)).toBe(max);
  });
  it("throws on simulation error response", async () => {
    const srv = { simulateTransaction: vi.fn().mockResolvedValue({ error: "Error(Contract, #6)", _e: true }) } as unknown as rpc.Server;
    const orig = rpc.Api.isSimulationError;
    (rpc.Api as any).isSimulationError = (r: any) => Boolean(r._e);
    await expect(simulateRead(srv, CONTRACT_ID, "is_approved", [encodeAddress(ALICE)], PASSPHRASE))
      .rejects.toThrow("Simulation error calling is_approved");
    (rpc.Api as any).isSimulationError = orig;
  });
  it("throws when no retval returned", async () => {
    const srv = { simulateTransaction: vi.fn().mockResolvedValue({ result: undefined, latestLedger: 1000 }) } as unknown as rpc.Server;
    await expect(simulateRead(srv, CONTRACT_ID, "name", [], PASSPHRASE)).rejects.toThrow("No return value from name");
  });
});

// submitContractTx
describe("submitContractTx", () => {
  function mkSrv(opts: { simError?: boolean; sendStatus?: string; getTxStatus?: string } = {}): rpc.Server {
    const { simError = false, sendStatus = "PENDING", getTxStatus = "SUCCESS" } = opts;
    return {
      simulateTransaction: vi.fn().mockResolvedValue(
        simError ? { error: "e", _e: true }
          : { result: { retval: nativeToScVal(true, { type: "bool" }) }, minResourceFee: "200", latestLedger: 1000 }),
      sendTransaction: vi.fn().mockResolvedValue({ status: sendStatus, hash: "h123", errorResult: sendStatus === "ERROR" ? { msg: "bad" } : undefined }),
      getTransaction: vi.fn().mockResolvedValue({ status: getTxStatus, resultXdr: "r", resultMetaXdr: null }),
    } as unknown as rpc.Server;
  }

  beforeEach(() => vi.clearAllMocks());

  it("returns SUCCESS and calls signTx once", async () => {
    const r = await submitContractTx(mkSrv(), CONTRACT_ID, "transfer",
      [encodeAddress(ALICE), encodeAddress(BOB), encodeI128(100n)], ALICE, "10", sign, PASSPHRASE, {}, mockAssemble);
    expect(r.status).toBe("SUCCESS");
    expect(sign).toHaveBeenCalledTimes(1);
  });
  it("passes non-empty XDR string to signTx", async () => {
    await submitContractTx(mkSrv(), CONTRACT_ID, "mint",
      [encodeAddress(ALICE), encodeI128(50n)], ALICE, "5", sign, PASSPHRASE, {}, mockAssemble);
    const arg = (sign as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(typeof arg).toBe("string");
    expect(arg.length).toBeGreaterThan(0);
  });
  it("throws on simulation failure", async () => {
    const orig = rpc.Api.isSimulationError;
    (rpc.Api as any).isSimulationError = (r: any) => Boolean(r._e);
    await expect(submitContractTx(mkSrv({ simError: true }), CONTRACT_ID, "mint", [], ALICE, "1", sign, PASSPHRASE, {}, mockAssemble))
      .rejects.toThrow("Simulation failed");
    (rpc.Api as any).isSimulationError = orig;
  });
  it("throws when sendTransaction returns ERROR", async () => {
    await expect(submitContractTx(mkSrv({ sendStatus: "ERROR" }), CONTRACT_ID, "transfer",
      [encodeAddress(ALICE), encodeAddress(BOB), encodeI128(1n)], ALICE, "1", sign, PASSPHRASE, {}, mockAssemble))
      .rejects.toThrow("Transaction rejected by network");
  });
  it("throws when final status is not SUCCESS", async () => {
    await expect(submitContractTx(mkSrv({ getTxStatus: "FAILED" }), CONTRACT_ID, "transfer",
      [encodeAddress(ALICE), encodeAddress(BOB), encodeI128(1n)], ALICE, "1", sign, PASSPHRASE, {}, mockAssemble))
      .rejects.toThrow("did not succeed");
  });
  it("polls until NOT_FOUND resolves", async () => {
    const srv = mkSrv();
    let n = 0;
    (srv.getTransaction as ReturnType<typeof vi.fn>).mockImplementation(() =>
      Promise.resolve(++n < 3 ? { status: "NOT_FOUND" } : { status: "SUCCESS", resultXdr: "ok", resultMetaXdr: null }));
    const r = await submitContractTx(srv, CONTRACT_ID, "settle",
      [encodeAddress(ALICE)], ALICE, "2", sign, PASSPHRASE, {}, mockAssemble);
    expect(r.status).toBe("SUCCESS");
    expect(n).toBe(3);
  }, 15_000);
});

// fetchAccountSequence
describe("fetchAccountSequence", () => {
  it("returns the sequence string", async () => {
    const srv = { getAccount: vi.fn().mockResolvedValue({ sequence: "9876543" }) } as unknown as rpc.Server;
    expect(await fetchAccountSequence(srv, ALICE)).toBe("9876543");
    expect(srv.getAccount).toHaveBeenCalledWith(ALICE);
  });
  it("propagates getAccount errors", async () => {
    const srv = { getAccount: vi.fn().mockRejectedValue(new Error("not found")) } as unknown as rpc.Server;
    await expect(fetchAccountSequence(srv, ALICE)).rejects.toThrow("not found");
  });
});

// BaseContractClient
describe("BaseContractClient", () => {
  class C extends BaseContractClient {
    constructor(s: rpc.Server) { super(CONTRACT_ID, s, PASSPHRASE, "rwa"); }
    r<T>(m: string, a: xdr.ScVal[]) { return this.read<T>(m, a); }
    w(m: string, a: xdr.ScVal[], s: string, fn: SignTx) { return this.write(m, a, s, fn, {}, mockAssemble); }
    pe(raw: string) { return this.parseError(raw); }
    fe(e: unknown) { return this.formatError(e); }
  }
  const mkS = (rv = nativeToScVal(42n, { type: "i128" })): rpc.Server =>
    ({
      simulateTransaction: vi.fn().mockResolvedValue({ result: { retval: rv }, minResourceFee: "100", latestLedger: 1000 }),
      getAccount: vi.fn().mockResolvedValue({ sequence: "10" }),
      sendTransaction: vi.fn().mockResolvedValue({ status: "PENDING", hash: "h" }),
      getTransaction: vi.fn().mockResolvedValue({ status: "SUCCESS", resultXdr: "r", resultMetaXdr: null }),
    }) as unknown as rpc.Server;

  it("read() decodes native value", async () => {
    expect(await new C(mkS(nativeToScVal(1234n, { type: "i128" }))).r<bigint>("total_supply", [])).toBe(1234n);
  });
  it("read() re-throws simulation errors with original message", async () => {
    // A simulation infrastructure error (not a contract error code) is passed through unchanged.
    const s = { simulateTransaction: vi.fn().mockResolvedValue({ error: "RPC connection refused", _e: true }) } as unknown as rpc.Server;
    const orig = rpc.Api.isSimulationError;
    (rpc.Api as any).isSimulationError = (r: any) => Boolean(r._e);
    await expect(new C(s).r("balance", [encodeAddress(ALICE)])).rejects.toThrow("Simulation error calling balance");
    (rpc.Api as any).isSimulationError = orig;
  });
  it("read() enriches errors that contain a contract error code", async () => {
    // Simulate the case where enrichError gets an Error whose message IS a contract code string.
    // We test this by throwing directly inside a mocked server that returns a contract code.
    const s = {
      simulateTransaction: vi.fn().mockRejectedValue(new Error("Error(Contract, #6)")),
    } as unknown as rpc.Server;
    await expect(new C(s).r("balance", [encodeAddress(ALICE)])).rejects.toThrow("Address has not passed KYC verification");
  });
  it("write() fetches seq, signs, submits, returns SUCCESS", async () => {
    const fn: SignTx = vi.fn(async (x) => x);
    const s = mkS();
    const r = await new C(s).w("mint", [encodeAddress(ALICE), encodeI128(100n)], ALICE, fn);
    expect(r.status).toBe("SUCCESS");
    expect(s.getAccount).toHaveBeenCalledWith(ALICE);
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("parseError() resolves RWA codes", () => {
    const c = new C(mkS());
    expect(c.pe("Error(Contract, #9)")?.name).toBe("TransferNotAllowed");
    expect(c.pe("Error(Contract, #4)")?.name).toBe("InsufficientBalance");
    expect(c.pe("Error(Contract, #6)")?.name).toBe("KycNotApproved");
  });
  it("parseError() returns null for non-contract strings", () => {
    const c = new C(mkS());
    expect(c.pe("Timeout")).toBeNull();
    expect(c.pe("Error(Auth, #1)")).toBeNull();
  });
  it("formatError() includes name and code", () => {
    expect(new C(mkS()).fe(new Error("Error(Contract, #8)"))).toContain("Blocklisted");
  });
  it("formatError() falls back to raw message", () => {
    expect(new C(mkS()).fe(new Error("network timeout"))).toBe("network timeout");
  });
});

// BaseContractClient.getEvents()
describe("BaseContractClient.getEvents()", () => {
  class C extends BaseContractClient {
    constructor(s: rpc.Server) { super(CONTRACT_ID, s, PASSPHRASE, "rwa"); }
  }

  function rawTransferEvent(): rpc.Api.EventResponse {
    return {
      id: "1-0", type: "contract", ledger: 500, ledgerClosedAt: "2026-01-01T00:00:00Z",
      pagingToken: "1-0", inSuccessfulContractCall: true, txHash: "hash1",
      contractId: CONTRACT_ID as any,
      topic: [
        nativeToScVal("transfer", { type: "symbol" }),
        nativeToScVal(ALICE, { type: "address" }),
        nativeToScVal(BOB, { type: "address" }),
      ],
      value: nativeToScVal([nativeToScVal(10n, { type: "i128" }), nativeToScVal(1n, { type: "u64" })] as any),
    } as unknown as rpc.Api.EventResponse;
  }

  it("scans back from the latest ledger by default and returns parsed events", async () => {
    const getEvents = vi.fn().mockResolvedValue({ latestLedger: 20_000, events: [rawTransferEvent()] });
    const s = {
      getLatestLedger: vi.fn().mockResolvedValue({ sequence: 20_000 }),
      getEvents,
    } as unknown as rpc.Server;

    const events = await new C(s).getEvents();
    expect(getEvents).toHaveBeenCalledWith(
      expect.objectContaining({ startLedger: 10_000, filters: [expect.objectContaining({ contractIds: [CONTRACT_ID] })] }),
    );
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe("transfer");
  });

  it("uses an explicit startLedger over the default lookback", async () => {
    const getEvents = vi.fn().mockResolvedValue({ latestLedger: 20_000, events: [] });
    const getLatestLedger = vi.fn();
    const s = { getLatestLedger, getEvents } as unknown as rpc.Server;

    await new C(s).getEvents({ startLedger: 42 });
    expect(getLatestLedger).not.toHaveBeenCalled();
    expect(getEvents).toHaveBeenCalledWith(expect.objectContaining({ startLedger: 42 }));
  });

  it("uses a cursor over startLedger when both context is available", async () => {
    const getEvents = vi.fn().mockResolvedValue({ latestLedger: 20_000, events: [] });
    const s = { getLatestLedger: vi.fn(), getEvents } as unknown as rpc.Server;

    await new C(s).getEvents({ cursor: "5-0" });
    const call = getEvents.mock.calls[0][0];
    expect(call.cursor).toBe("5-0");
    expect(call.startLedger).toBeUndefined();
  });
});
