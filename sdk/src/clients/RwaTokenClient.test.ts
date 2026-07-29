import { describe, it, expect, vi, afterEach } from "vitest";
import { Networks, nativeToScVal } from "@stellar/stellar-sdk";
import { RwaTokenClient } from "./RwaTokenClient.js";
import { mockServer, simSuccess, simFailure, simMalformed, txNotFound, txSuccess } from "../testing/mockRpc.js";

const PASSPHRASE = Networks.TESTNET;
const CONTRACT_ID = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const ALICE = "GBQG2SJ7MXUH34SI3MJ2I256I5UMGM2QSQZM77YFX5S6JOHXUQJEPC3A";
const BOB = "GAQWW5UBJVPNKMM5NLAIBEL6QK24ODXABL7YAXBN6KNMH3OYNM5JXT35";

function client(server: ReturnType<typeof mockServer>) {
  return new RwaTokenClient(CONTRACT_ID, server, PASSPHRASE);
}

afterEach(() => { vi.useRealTimers(); });

describe("RwaTokenClient — happy paths", () => {
  it("balance() decodes an i128 retval", async () => {
    const c = client(mockServer({ simulateByMethod: { balance: simSuccess(nativeToScVal(1_000n, { type: "i128" })) } }));
    expect(await c.balance(ALICE)).toBe(1_000n);
  });

  it("checkKycStatus() decodes a struct retval", async () => {
    const retval = nativeToScVal(
      { status: "Approved", is_active: true, expiry: 0n, tier: 1, jurisdiction: "US", checked_at: 100n },
      { type: "instance" },
    );
    const c = client(mockServer({ simulateByMethod: { check_kyc_status: simSuccess(retval) } }));
    const status = await c.checkKycStatus(ALICE);
    expect(status.is_active).toBe(true);
  });

  it("mint() builds, signs, submits, and confirms", async () => {
    const srv = mockServer({ simulateByMethod: { mint: simSuccess(nativeToScVal(true, { type: "bool" })) } });
    const c = client(srv);
    await expect(c.mint(BOB, ALICE, 100n, async (x) => x)).resolves.toBeUndefined();
    expect(srv.sendTransaction).toHaveBeenCalledOnce();
  });
});

describe("RwaTokenClient — failure modes", () => {
  it("read() surfaces the raw simulation error message", async () => {
    const c = client(mockServer({ simulateByMethod: { balance: simFailure("RPC connection refused") } }));
    await expect(c.balance(ALICE)).rejects.toThrow("Simulation error calling balance");
  });

  it("write() enriches a KycNotApproved contract error", async () => {
    const c = client(mockServer({ simulateByMethod: { transfer: simFailure("Error(Contract, #6)") } }));
    await expect(c.transfer(ALICE, BOB, 1n, async (x) => x)).rejects.toThrow("has not passed KYC verification");
  });

  it("read() throws a clear error on a malformed (missing-retval) payload", async () => {
    const c = client(mockServer({ simulateByMethod: { total_supply: simMalformed() } }));
    await expect(c.totalSupply()).rejects.toThrow("No return value from total_supply");
  });

  it("write() throws when the network rejects the submitted transaction", async () => {
    const srv = mockServer({
      simulateByMethod: { burn: simSuccess(nativeToScVal(true, { type: "bool" })) },
      send: { status: "ERROR", hash: "", errorResult: { msg: "bad" } } as any,
    });
    const c = client(srv);
    await expect(c.burn(ALICE, 1n, async (x) => x)).rejects.toThrow("Transaction rejected by network");
  });

  it("write() polls through several delayed-confirmation cycles before succeeding", async () => {
    vi.useFakeTimers();
    const srv = mockServer({
      simulateByMethod: { mint: simSuccess(nativeToScVal(true, { type: "bool" })) },
      getTransaction: [txNotFound(), txNotFound(), txNotFound(), txSuccess()],
    });
    const c = client(srv);

    const pending = c.mint(BOB, ALICE, 1n, async (x) => x);
    // Each poll waits 1500ms; advance past all three NOT_FOUND cycles at once.
    await vi.advanceTimersByTimeAsync(1500 * 3 + 100);

    await expect(pending).resolves.toBeUndefined();
    expect(srv.getTransaction).toHaveBeenCalledTimes(4);
  });
});
