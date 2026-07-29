import { describe, it, expect } from "vitest";
import { Networks, nativeToScVal } from "@stellar/stellar-sdk";
import { KycRegistryClient } from "./KycRegistryClient.js";
import { mockServer, simSuccess, simFailure, simMalformed } from "../testing/mockRpc.js";
import { AuthError } from "../auth.js";

const PASSPHRASE = Networks.TESTNET;
const CONTRACT_ID = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const ALICE = "GBQG2SJ7MXUH34SI3MJ2I256I5UMGM2QSQZM77YFX5S6JOHXUQJEPC3A";
const VERIFIER = "GAQWW5UBJVPNKMM5NLAIBEL6QK24ODXABL7YAXBN6KNMH3OYNM5JXT35";
const ADMIN = "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37";

function client(server: ReturnType<typeof mockServer>) {
  return new KycRegistryClient(CONTRACT_ID, server, PASSPHRASE);
}

const addrList = (addrs: string[]) => simSuccess(nativeToScVal(addrs));

describe("KycRegistryClient — happy paths", () => {
  it("isApproved() decodes a bool retval", async () => {
    const c = client(mockServer({ simulateByMethod: { is_approved: simSuccess(nativeToScVal(true, { type: "bool" })) } }));
    expect(await c.isApproved(ALICE)).toBe(true);
  });

  it("getTier() decodes a u32 retval", async () => {
    const c = client(mockServer({ simulateByMethod: { get_tier: simSuccess(nativeToScVal(2, { type: "u32" })) } }));
    expect(await c.getTier(ALICE)).toBe(2);
  });

  it("getAdmins() decodes a Vec<Address> retval", async () => {
    const c = client(mockServer({ simulateByMethod: { get_admins: addrList([ADMIN]) } }));
    expect(await c.getAdmins()).toEqual([ADMIN]);
  });

  it("approve() runs the verifier pre-check, then builds, signs, submits, and confirms", async () => {
    const srv = mockServer({
      simulateByMethod: {
        verifier_list_pub: addrList([VERIFIER]),
        approve: simSuccess(nativeToScVal(true, { type: "bool" })),
      },
    });
    const c = client(srv);
    const sign = async (x: string) => x;
    await expect(c.approve(VERIFIER, ALICE, 1, 0n, "US", sign)).resolves.toBeUndefined();
    expect(srv.sendTransaction).toHaveBeenCalledOnce();
  });

  it("addVerifier() runs the admin pre-check, then submits", async () => {
    const srv = mockServer({
      simulateByMethod: {
        get_admins: addrList([ADMIN]),
        add_verifier: simSuccess(nativeToScVal(true, { type: "bool" })),
      },
    });
    const c = client(srv);
    await expect(c.addVerifier(ADMIN, VERIFIER, async (x) => x)).resolves.toBeUndefined();
    expect(srv.sendTransaction).toHaveBeenCalledOnce();
  });
});

describe("KycRegistryClient — failure modes", () => {
  it("read() surfaces the raw simulation error message", async () => {
    const c = client(mockServer({ simulateByMethod: { is_approved: simFailure("RPC connection refused") } }));
    await expect(c.isApproved(ALICE)).rejects.toThrow("Simulation error calling is_approved");
  });

  it("read() throws a clear error on a malformed (missing-retval) payload", async () => {
    const c = client(mockServer({ simulateByMethod: { verifier_count: simMalformed() } }));
    await expect(c.verifierCount()).rejects.toThrow("No return value from verifier_count");
  });

  it("write() throws when the network rejects the submitted transaction", async () => {
    const srv = mockServer({
      simulateByMethod: {
        verifier_list_pub: addrList([VERIFIER]),
        revoke: simSuccess(nativeToScVal(true, { type: "bool" })),
      },
      send: { status: "ERROR", hash: "", errorResult: { msg: "bad" } } as any,
    });
    const c = client(srv);
    await expect(c.revoke(VERIFIER, ALICE, async (x) => x)).rejects.toThrow("Transaction rejected by network");
  });

  it("write() throws when confirmation lands as FAILED", async () => {
    const srv = mockServer({
      simulateByMethod: {
        verifier_list_pub: addrList([VERIFIER]),
        reject: simSuccess(nativeToScVal(true, { type: "bool" })),
      },
      getTransaction: { status: "FAILED" } as any,
    });
    const c = client(srv);
    await expect(c.reject(VERIFIER, ALICE, async (x) => x)).rejects.toThrow("did not succeed");
  });

  it("addVerifier() rejects locally with AuthError when the caller isn't a registered admin — no network write attempted", async () => {
    const srv = mockServer({ simulateByMethod: { get_admins: addrList([ADMIN]) } });
    const c = client(srv);
    await expect(c.addVerifier(ALICE, VERIFIER, async (x) => x)).rejects.toThrow(AuthError);
    await expect(c.addVerifier(ALICE, VERIFIER, async (x) => x)).rejects.toThrow("not a registered admin");
    expect(srv.sendTransaction).not.toHaveBeenCalled();
  });

  it("approve() rejects locally with AuthError when the caller isn't a registered verifier", async () => {
    const srv = mockServer({ simulateByMethod: { verifier_list_pub: addrList([VERIFIER]) } });
    const c = client(srv);
    await expect(c.approve(ALICE, ALICE, 1, 0n, "US", async (x) => x)).rejects.toThrow(AuthError);
    expect(srv.sendTransaction).not.toHaveBeenCalled();
  });

  it("write() enriches an on-chain Unauthorized contract error into an AuthError once the local pre-check passes", async () => {
    const c = client(mockServer({
      simulateByMethod: {
        get_admins: addrList([ADMIN]),
        add_verifier: simFailure("Error(Contract, #3)"),
      },
    }));
    await expect(c.addVerifier(ADMIN, VERIFIER, async (x) => x)).rejects.toThrow("Unauthorized");
  });
});
