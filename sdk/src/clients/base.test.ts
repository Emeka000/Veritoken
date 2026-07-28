import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TransactionBuilder, Networks, nativeToScVal, xdr, rpc } from "@stellar/stellar-sdk";
import { buildContractTx, simulateRead, submitContractTx, fetchAccountSequence, BaseContractClient, SIM_SOURCE, type SignTx } from "./base.js";
import { encodeAddress, encodeI128 } from "../codec.js";

const PASSPHRASE  = Networks.TESTNET;
const CONTRACT_ID = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const ALICE = "GBQG2SJ7MXUH34SI3MJ2I256I5UMGM2QSQZM77YFX5S6JOHXUQJEPC3A";
const BOB   = "GAQWW5UBJVPNKMM5NLAIBEL6QK24ODXABL7YAXBN6KNMH3OYNM5JXT35";

const VALID_XDR = (() => {
  const { Account, Contract, TransactionBuilder: TB } = require("@stellar/stellar-sdk");
  const acct = new Account(ALICE, "0");
  const contract = new Contract(CONTRACT_ID);
  return new TB(acct, { fee: "100", networkPassphrase: PASSPHRASE })
    .addOperation(contract.call("transfer", encodeAddress(ALICE), encodeAddress(BOB), encodeI128(1n)))
    .setTimeout(30).build().toXDR();
})();

const mockAssemble = (_tx, _sim) => ({ build: () => ({ toXDR: () => VALID_XDR }) });
const sign = vi.fn(async (x) => x);
beforeEach(() => vi.clearAllMocks());

describe("buildContractTx", () => {
  it("produces valid XDR that round-trips through fromXDR", () => {
    expect(() => TransactionBuilder.fromXDR(buildContractTx(CONTRACT_ID, "transfer", [encodeAddress(ALICE), encodeAddress(BOB), encodeI128(1_000_000n)], PASSPHRASE), PASSPHRASE)).not.toThrow();
  });
  it("uses SIM_SOURCE by default", () => {
    expect(TransactionBuilder.fromXDR(buildContractTx(CONTRACT_ID, "balance", [encodeAddress(ALICE)], PASSPHRASE), PASSPHRASE).source).toBe(SIM_SOURCE);
  });
  it("uses provided source and advances sequence by 1", () => {
    const tx = TransactionBuilder.fromXDR(buildContractTx(CONTRACT_ID, "mint", [encodeAddress(ALICE), encodeI128(500n)], PASSPHRASE, ALICE, "42"), PASSPHRASE);
    expect(tx.source).toBe(ALICE);
    expect(tx.sequence).toBe("43");
  });
  it("encodes a single invokeHostFunction operation", () => {
    const ops = TransactionBuilder.fromXDR(buildContractTx(CONTRACT_ID, "decimals", [], PASSPHRASE), PASSPHRASE).operations;
    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe("invokeHostFunction");
  });
  it("applies custom fee", () => {
    expect(TransactionBuilder.fromXDR(buildContractTx(CONTRACT_ID, "name", [], PASSPHRASE, undefined, undefined, { fee: "9999" }), PASSPHRASE).fee).toBe("9999");
  });
});

describe("simulateRead", () => {
  const ok = (rv) => ({ simulateTransaction: vi.fn().mockResolvedValue({ result: { retval: rv }, minResourceFee: "100", latestLedger: 1000 }) });
  it("decodes i128 as bigint", async () => { expect(await simulateRead(ok(nativeToScVal(7_000_000n, { type: "i128" })), CONTRACT_ID, "balance", [encodeAddress(ALICE)], PASSPHRASE)).toBe(7_000_000n); });
  it("decodes bool", async () => { expect(await simulateRead(ok(nativeToScVal(true, { type: "bool" })), CONTRACT_ID, "is_approved", [encodeAddress(ALICE)], PASSPHRASE)).toBe(true); });
  it("decodes string", async () => { expect(await simulateRead(ok(nativeToScVal("Carbon Token", { type: "string" })), CONTRACT_ID, "name", [], PASSPHRASE)).toBe("Carbon Token"); });
  it("decodes u32", async () => { expect(await simulateRead(ok(nativeToScVal(7, { type: "u32" })), CONTRACT_ID, "decimals", [], PASSPHRASE)).toBe(7); });
  it("round-trips max i128", async () => { const max = 170141183460469231731687303715884105727n; expect(await simulateRead(ok(nativeToScVal(max, { type: "i128" })), CONTRACT_ID, "total_supply", [], PASSPHRASE)).toBe(max); });
  it("throws on simulation error response", async () => {
    const srv = { simulateTransaction: vi.fn().mockResolvedValue({ error: "err", _e: true }) };
    const orig = rpc.Api.isSimulationError;
    rpc.Api.isSimulationError = (r) => Boolean(r._e);
    await expect(simulateRead(srv, CONTRACT_ID, "is_approved", [encodeAddress(ALICE)], PASSPHRASE)).rejects.toThrow("Simulation failed for is_approved");
    rpc.Api.isSimulationError = orig;
  });
  it("throws when no retval", async () => {
    const srv = { simulateTransaction: vi.fn().mockResolvedValue({ result: undefined, latestLedger: 1000 }) };
    await expect(simulateRead(srv, CONTRACT_ID, "name", [], PASSPHRASE)).rejects.toThrow("Simulation failed for name");
  });
});

describe("submitContractTx", () => {
  function makeSrv(opts = {}) {
    const { sendStatus = "PENDING", getTxStatus = "SUCCESS" } = opts;
    return {
      simulateTransaction: vi.fn().mockResolvedValue({ result: { retval: nativeToScVal(true, { type: "bool" }) }, minResourceFee: "200", latestLedger: 1000 }),
      sendTransaction: vi.fn().mockResolvedValue({ status: sendStatus, hash: "txhash", errorResult: sendStatus === "ERROR" ? { msg: "bad" } : undefined }),
      getTransaction: vi.fn().mockResolvedValue({ status: getTxStatus, resultXdr: "r", resultMetaXdr: null }),
      getAccount: vi.fn().mockResolvedValue({ sequence: "5" }),
    };
  }
  it("returns SUCCESS on the happy path", async () => {
    const r = await submitContractTx(makeSrv(), CONTRACT_ID, "transfer", [encodeAddress(ALICE), encodeAddress(BOB), encodeI128(100n)], ALICE, "10", sign, PASSPHRASE, {}, mockAssemble);
    expect(r.status).toBe("SUCCESS");
    expect(sign).toHaveBeenCalledTimes(1);
  });
  it("throws when sendTransaction returns ERROR", async () => {
    await expect(submitContractTx(makeSrv({ sendStatus: "ERROR" }), CONTRACT_ID, "transfer", [encodeAddress(ALICE), encodeAddress(BOB), encodeI128(1n)], ALICE, "1", sign, PASSPHRASE, {}, mockAssemble)).rejects.toThrow("Transaction submission failed");
  });
  it("throws when final status is not SUCCESS", async () => {
    await expect(submitContractTx(makeSrv({ getTxStatus: "FAILED" }), CONTRACT_ID, "transfer", [encodeAddress(ALICE), encodeAddress(BOB), encodeI128(1n)], ALICE, "1", sign, PASSPHRASE, {}, mockAssemble)).rejects.toThrow("did not succeed");
  });
  it("polls until NOT_FOUND resolves", async () => {
    const srv = makeSrv();
    let n = 0;
    srv.getTransaction = vi.fn().mockImplementation(() => Promise.resolve(++n < 3 ? { status: "NOT_FOUND" } : { status: "SUCCESS", resultXdr: "ok", resultMetaXdr: null }));
    const r = await submitContractTx(srv, CONTRACT_ID, "settle", [encodeAddress(ALICE)], ALICE, "2", sign, PASSPHRASE, {}, mockAssemble);
    expect(r.status).toBe("SUCCESS");
    expect(n).toBe(3);
  }, 15_000);
});

describe("fetchAccountSequence", () => {
  it("returns the sequence string", async () => {
    const srv = { getAccount: vi.fn().mockResolvedValue({ sequence: "9876543" }) };
    expect(await fetchAccountSequence(srv, ALICE)).toBe("9876543");
  });
  it("propagates errors", async () => {
    const srv = { getAccount: vi.fn().mockRejectedValue(new Error("Failed to fetch sequence")) };
    await expect(fetchAccountSequence(srv, ALICE)).rejects.toThrow("Failed to fetch sequence");
  });
});

describe("BaseContractClient", () => {
  class C extends BaseContractClient {
    constructor(s) { super(CONTRACT_ID, s, PASSPHRASE, "rwa"); }
    r(m, a) { return this.read(m, a); }
    w(m, a, s, fn) { return this.write(m, a, s, fn, {}, mockAssemble); }
    pe(raw) { return this.parseError(raw); }
    fe(e) { return this.formatError(e); }
  }
  const mkS = (rv = nativeToScVal(42n, { type: "i128" })) => ({
    simulateTransaction: vi.fn().mockResolvedValue({ result: { retval: rv }, minResourceFee: "100", latestLedger: 1000 }),
    getAccount: vi.fn().mockResolvedValue({ sequence: "10" }),
    sendTransaction: vi.fn().mockResolvedValue({ status: "PENDING", hash: "h" }),
    getTransaction: vi.fn().mockResolvedValue({ status: "SUCCESS", resultXdr: "r", resultMetaXdr: null }),
  });
  it("read() decodes native value", async () => { expect(await new C(mkS(nativeToScVal(1234n, { type: "i128" }))).r("total_supply", [])).toBe(1234n); });
  it("read() enriches contract errors", async () => {
    const s = { simulateTransaction: vi.fn().mockRejectedValue(new Error("Error(Contract, #6)")) };
    await expect(new C(s).r("balance", [encodeAddress(ALICE)])).rejects.toThrow("Address has not passed KYC verification");
  });
  it("write() fetches seq, signs, submits, returns SUCCESS", async () => {
    const fn = vi.fn(async (x) => x);
    const s = mkS();
    const r = await new C(s).w("mint", [encodeAddress(ALICE), encodeI128(100n)], ALICE, fn);
    expect(r.status).toBe("SUCCESS");
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("parseError() resolves RWA codes", () => {
    const c = new C(mkS());
    expect(c.pe("Error(Contract, #9)").name).toBe("TransferNotAllowed");
    expect(c.pe("Error(Contract, #4)").name).toBe("InsufficientBalance");
  });
  it("parseError() returns null for non-contract strings", () => { const c = new C(mkS()); expect(c.pe("Timeout")).toBeNull(); });
  it("formatError() includes name and code", () => { expect(new C(mkS()).fe(new Error("Error(Contract, #8)"))).toContain("Blocklisted"); });
  it("formatError() falls back to raw message", () => { expect(new C(mkS()).fe(new Error("network timeout"))).toBe("network timeout"); });
});
