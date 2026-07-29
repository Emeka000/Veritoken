import { describe, it, expect } from "vitest";
import { Networks, nativeToScVal } from "@stellar/stellar-sdk";
import { ComplianceEngineClient } from "./ComplianceEngineClient.js";
import { mockServer, simSuccess, simFailure, simMalformed } from "../testing/mockRpc.js";

const PASSPHRASE = Networks.TESTNET;
const CONTRACT_ID = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const ALICE = "GBQG2SJ7MXUH34SI3MJ2I256I5UMGM2QSQZM77YFX5S6JOHXUQJEPC3A";
const ADMIN = "GAQWW5UBJVPNKMM5NLAIBEL6QK24ODXABL7YAXBN6KNMH3OYNM5JXT35";

function client(server: ReturnType<typeof mockServer>) {
  return new ComplianceEngineClient(CONTRACT_ID, server, PASSPHRASE);
}

describe("ComplianceEngineClient — happy paths", () => {
  it("isBlocklisted() decodes a bool retval", async () => {
    const c = client(mockServer({ simulateByMethod: { is_blocklisted: simSuccess(nativeToScVal(false, { type: "bool" })) } }));
    expect(await c.isBlocklisted(ALICE)).toBe(false);
  });

  it("holderCount() decodes a u32 retval", async () => {
    const c = client(mockServer({ simulateByMethod: { holder_count: simSuccess(nativeToScVal(12, { type: "u32" })) } }));
    expect(await c.holderCount()).toBe(12);
  });

  it("pause() builds, signs, submits, and confirms", async () => {
    const srv = mockServer({ simulateByMethod: { pause: simSuccess(nativeToScVal(true, { type: "bool" })) } });
    const c = client(srv);
    await expect(c.pause(ADMIN, async (x) => x)).resolves.toBeUndefined();
    expect(srv.sendTransaction).toHaveBeenCalledOnce();
  });
});

describe("ComplianceEngineClient — failure modes", () => {
  it("read() surfaces the raw simulation error message", async () => {
    const c = client(mockServer({ simulateByMethod: { is_blocklisted: simFailure("RPC connection refused") } }));
    await expect(c.isBlocklisted(ALICE)).rejects.toThrow("Simulation error calling is_blocklisted");
  });

  it("write() enriches an Unauthorized contract error", async () => {
    const c = client(mockServer({ simulateByMethod: { add_to_blocklist: simFailure("Error(Contract, #3)") } }));
    await expect(c.addToBlocklist(ALICE, ADMIN, async (x) => x)).rejects.toThrow("Unauthorized");
  });

  it("read() throws a clear error on a malformed (missing-retval) payload", async () => {
    const c = client(mockServer({ simulateByMethod: { blocklist_count: simMalformed() } }));
    await expect(c.blocklistCount()).rejects.toThrow("No return value from blocklist_count");
  });

  it("write() throws when the network rejects the submitted transaction", async () => {
    const srv = mockServer({
      simulateByMethod: { unpause: simSuccess(nativeToScVal(true, { type: "bool" })) },
      send: { status: "ERROR", hash: "", errorResult: { msg: "bad" } } as any,
    });
    const c = client(srv);
    await expect(c.unpause(ADMIN, async (x) => x)).rejects.toThrow("Transaction rejected by network");
  });
});
