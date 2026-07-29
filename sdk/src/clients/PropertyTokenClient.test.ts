import { describe, it, expect } from "vitest";
import { Networks, nativeToScVal } from "@stellar/stellar-sdk";
import { PropertyTokenClient } from "./PropertyTokenClient.js";
import { mockServer, simSuccess, simFailure, simMalformed } from "../testing/mockRpc.js";

const PASSPHRASE = Networks.TESTNET;
const CONTRACT_ID = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const ALICE = "GBQG2SJ7MXUH34SI3MJ2I256I5UMGM2QSQZM77YFX5S6JOHXUQJEPC3A";
const ADMIN = "GAQWW5UBJVPNKMM5NLAIBEL6QK24ODXABL7YAXBN6KNMH3OYNM5JXT35";

function client(server: ReturnType<typeof mockServer>) {
  return new PropertyTokenClient(CONTRACT_ID, server, PASSPHRASE);
}

describe("PropertyTokenClient — happy paths", () => {
  it("totalShares() decodes an i128 retval", async () => {
    const c = client(mockServer({ simulateByMethod: { total_shares: simSuccess(nativeToScVal(10_000n, { type: "i128" })) } }));
    expect(await c.totalShares()).toBe(10_000n);
  });

  it("pendingDividend() decodes an i128 retval", async () => {
    const c = client(mockServer({ simulateByMethod: { pending_dividend: simSuccess(nativeToScVal(42n, { type: "i128" })) } }));
    expect(await c.pendingDividend(ALICE)).toBe(42n);
  });

  it("mint() builds, signs, submits, and confirms", async () => {
    const srv = mockServer({ simulateByMethod: { mint: simSuccess(nativeToScVal(true, { type: "bool" })) } });
    const c = client(srv);
    await expect(c.mint(ADMIN, ALICE, 100n, async (x) => x)).resolves.toBeUndefined();
    expect(srv.sendTransaction).toHaveBeenCalledOnce();
  });
});

describe("PropertyTokenClient — failure modes", () => {
  it("read() surfaces the raw simulation error message", async () => {
    const c = client(mockServer({ simulateByMethod: { total_shares: simFailure("RPC connection refused") } }));
    await expect(c.totalShares()).rejects.toThrow("Simulation error calling total_shares");
  });

  it("write() enriches a KycTierInsufficient contract error", async () => {
    const c = client(mockServer({ simulateByMethod: { transfer: simFailure("Error(Contract, #5)") } }));
    await expect(c.transfer(ALICE, ADMIN, 1n, async (x) => x)).rejects.toThrow("KYC tier is too low");
  });

  it("read() throws a clear error on a malformed (missing-retval) payload", async () => {
    const c = client(mockServer({ simulateByMethod: { balance: simMalformed() } }));
    await expect(c.balance(ALICE)).rejects.toThrow("No return value from balance");
  });

  it("write() throws when the network rejects the submitted transaction", async () => {
    const srv = mockServer({
      simulateByMethod: { claim_dividend: simSuccess(nativeToScVal(true, { type: "bool" })) },
      send: { status: "ERROR", hash: "", errorResult: { msg: "bad" } } as any,
    });
    const c = client(srv);
    await expect(c.claimDividend(ALICE, async (x) => x)).rejects.toThrow("Transaction rejected by network");
  });
});
