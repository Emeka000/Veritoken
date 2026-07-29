import { describe, it, expect } from "vitest";
import { Networks, nativeToScVal } from "@stellar/stellar-sdk";
import { InvoiceTokenClient } from "./InvoiceTokenClient.js";
import { mockServer, simSuccess, simFailure, simMalformed } from "../testing/mockRpc.js";

const PASSPHRASE = Networks.TESTNET;
const CONTRACT_ID = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const ALICE = "GBQG2SJ7MXUH34SI3MJ2I256I5UMGM2QSQZM77YFX5S6JOHXUQJEPC3A";
const BOB = "GAQWW5UBJVPNKMM5NLAIBEL6QK24ODXABL7YAXBN6KNMH3OYNM5JXT35";

function client(server: ReturnType<typeof mockServer>) {
  return new InvoiceTokenClient(CONTRACT_ID, server, PASSPHRASE);
}

describe("InvoiceTokenClient — happy paths", () => {
  it("balance() decodes an i128 retval", async () => {
    const c = client(mockServer({ simulateByMethod: { balance: simSuccess(nativeToScVal(500n, { type: "i128" })) } }));
    expect(await c.balance(ALICE)).toBe(500n);
  });

  it("isSettled() decodes a bool retval", async () => {
    const c = client(mockServer({ simulateByMethod: { is_settled: simSuccess(nativeToScVal(true, { type: "bool" })) } }));
    expect(await c.isSettled()).toBe(true);
  });

  it("transfer() builds, signs, submits, and confirms", async () => {
    const srv = mockServer({ simulateByMethod: { transfer: simSuccess(nativeToScVal(true, { type: "bool" })) } });
    const c = client(srv);
    await expect(c.transfer(ALICE, BOB, 100n, async (x) => x)).resolves.toBeUndefined();
    expect(srv.sendTransaction).toHaveBeenCalledOnce();
  });
});

describe("InvoiceTokenClient — failure modes", () => {
  it("read() surfaces the raw simulation error message", async () => {
    const c = client(mockServer({ simulateByMethod: { balance: simFailure("RPC connection refused") } }));
    await expect(c.balance(ALICE)).rejects.toThrow("Simulation error calling balance");
  });

  it("write() enriches an InsufficientBalance contract error", async () => {
    const c = client(mockServer({ simulateByMethod: { redeem: simFailure("Error(Contract, #9)") } }));
    await expect(c.redeem(ALICE, 1_000_000n, async (x) => x)).rejects.toThrow("Insufficient token balance");
  });

  it("read() throws a clear error on a malformed (missing-retval) payload", async () => {
    const c = client(mockServer({ simulateByMethod: { total_supply: simMalformed() } }));
    await expect(c.totalSupply()).rejects.toThrow("No return value from total_supply");
  });

  it("write() throws when confirmation lands as FAILED", async () => {
    const srv = mockServer({
      simulateByMethod: { settle: simSuccess(nativeToScVal(true, { type: "bool" })) },
      getTransaction: { status: "FAILED" } as any,
    });
    const c = client(srv);
    await expect(c.settle(ALICE, async (x) => x)).rejects.toThrow("did not succeed");
  });
});
