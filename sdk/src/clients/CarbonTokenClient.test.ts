import { describe, it, expect } from "vitest";
import { Networks, nativeToScVal } from "@stellar/stellar-sdk";
import { CarbonTokenClient } from "./CarbonTokenClient.js";
import { mockServer, simSuccess, simFailure, simMalformed } from "../testing/mockRpc.js";

const PASSPHRASE = Networks.TESTNET;
const CONTRACT_ID = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const ALICE = "GBQG2SJ7MXUH34SI3MJ2I256I5UMGM2QSQZM77YFX5S6JOHXUQJEPC3A";
const BOB = "GAQWW5UBJVPNKMM5NLAIBEL6QK24ODXABL7YAXBN6KNMH3OYNM5JXT35";

function client(server: ReturnType<typeof mockServer>) {
  return new CarbonTokenClient(CONTRACT_ID, server, PASSPHRASE);
}

describe("CarbonTokenClient — happy paths", () => {
  it("totalRetired() decodes an i128 retval", async () => {
    const c = client(mockServer({ simulateByMethod: { total_retired: simSuccess(nativeToScVal(250n, { type: "i128" })) } }));
    expect(await c.totalRetired()).toBe(250n);
  });

  it("retirementCount() decodes a u32 retval", async () => {
    const c = client(mockServer({ simulateByMethod: { retirement_count: simSuccess(nativeToScVal(3, { type: "u32" })) } }));
    expect(await c.retirementCount()).toBe(3);
  });

  it("transfer() builds, signs, submits, and confirms", async () => {
    const srv = mockServer({ simulateByMethod: { transfer: simSuccess(nativeToScVal(true, { type: "bool" })) } });
    const c = client(srv);
    await expect(c.transfer(ALICE, BOB, 10n, async (x) => x)).resolves.toBeUndefined();
    expect(srv.sendTransaction).toHaveBeenCalledOnce();
  });
});

describe("CarbonTokenClient — failure modes", () => {
  it("read() surfaces the raw simulation error message", async () => {
    const c = client(mockServer({ simulateByMethod: { total_retired: simFailure("RPC connection refused") } }));
    await expect(c.totalRetired()).rejects.toThrow("Simulation error calling total_retired");
  });

  it("write() enriches a Blocklisted contract error", async () => {
    const c = client(mockServer({ simulateByMethod: { mint: simFailure("Error(Contract, #7)") } }));
    await expect(c.mint(ALICE, BOB, 5n, async (x) => x)).rejects.toThrow("compliance blocklist");
  });

  it("read() throws a clear error on a malformed (missing-retval) payload", async () => {
    const c = client(mockServer({ simulateByMethod: { balance: simMalformed() } }));
    await expect(c.balance(ALICE)).rejects.toThrow("No return value from balance");
  });

  it("write() throws when confirmation lands as FAILED", async () => {
    const srv = mockServer({
      simulateByMethod: { retire: simSuccess(nativeToScVal(true, { type: "bool" })) },
      getTransaction: { status: "FAILED" } as any,
    });
    const c = client(srv);
    await expect(c.retire(ALICE, 1n, BOB, "offset", async (x) => x)).rejects.toThrow("did not succeed");
  });
});
