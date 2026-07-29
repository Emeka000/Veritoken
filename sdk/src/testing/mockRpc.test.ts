import { describe, it, expect } from "vitest";
import { Networks, nativeToScVal, Account, Contract, TransactionBuilder, Keypair } from "@stellar/stellar-sdk";
import {
  mockServer, simSuccess, simFailure, simMalformed, simCorruptRetval,
  sendPending, sendError, txSuccess, txFailed, txNotFound,
  extractMethodName, mockAssemble, noSleep,
} from "./mockRpc.js";

const PASSPHRASE = Networks.TESTNET;
const CONTRACT_ID = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const SOURCE = Keypair.random().publicKey();

function buildTx(method: string) {
  const account = new Account(SOURCE, "0");
  const contract = new Contract(CONTRACT_ID);
  return new TransactionBuilder(account, { fee: "100", networkPassphrase: PASSPHRASE })
    .addOperation(contract.call(method))
    .setTimeout(30)
    .build();
}

describe("extractMethodName", () => {
  it("pulls the contract method out of an invokeHostFunction op", () => {
    expect(extractMethodName(buildTx("balance"))).toBe("balance");
    expect(extractMethodName(buildTx("total_supply"))).toBe("total_supply");
  });
});

describe("response builders", () => {
  it("simSuccess carries the retval through", () => {
    const r = simSuccess(nativeToScVal(42n, { type: "i128" }));
    expect(r.result?.retval).toBeDefined();
  });
  it("simFailure exposes an error string", () => {
    expect(simFailure("Error(Contract, #6)").error).toBe("Error(Contract, #6)");
  });
  it("simMalformed has no retval", () => {
    expect(simMalformed().result).toBeUndefined();
  });
  it("simCorruptRetval has an undecodable retval", () => {
    expect(simCorruptRetval().result?.retval).toBeDefined();
  });
  it("send/getTransaction builders set expected status", () => {
    expect(sendPending().status).toBe("PENDING");
    expect(sendError().status).toBe("ERROR");
    expect(txSuccess().status).toBe("SUCCESS");
    expect(txFailed().status).toBe("FAILED");
    expect(txNotFound().status).toBe("NOT_FOUND");
  });
});

describe("mockServer", () => {
  it("dispatches simulateByMethod based on the called contract method", async () => {
    const srv = mockServer({
      simulateByMethod: {
        balance: simSuccess(nativeToScVal(7n, { type: "i128" })),
        name: simSuccess(nativeToScVal("Carbon Token", { type: "string" })),
      },
    });
    const balSim = await srv.simulateTransaction(buildTx("balance"));
    const nameSim = await srv.simulateTransaction(buildTx("name"));
    expect((balSim as any).result.retval).toBeDefined();
    expect((nameSim as any).result.retval).toBeDefined();
  });

  it("falls back to the generic `simulate` responder for unlisted methods", async () => {
    const srv = mockServer({ simulate: simFailure("Error(Contract, #3)") });
    const sim = await srv.simulateTransaction(buildTx("anything"));
    expect((sim as any).error).toBe("Error(Contract, #3)");
  });

  it("cycles through an array of getTransaction responses then repeats the last", async () => {
    const srv = mockServer({ getTransaction: [txNotFound(), txNotFound(), txSuccess()] });
    expect((await srv.getTransaction("h")).status).toBe("NOT_FOUND");
    expect((await srv.getTransaction("h")).status).toBe("NOT_FOUND");
    expect((await srv.getTransaction("h")).status).toBe("SUCCESS");
    expect((await srv.getTransaction("h")).status).toBe("SUCCESS");
  });

  it("returns the configured sequence from getAccount", async () => {
    const srv = mockServer({ sequence: "999" });
    expect(await srv.getAccount("G...")).toEqual({ sequence: "999" });
  });

  it("returns configured getEvents responses", async () => {
    const srv = mockServer({ getEvents: { latestLedger: 5, events: [] } as any });
    expect((await srv.getEvents({} as any)).latestLedger).toBe(5);
  });

  it("every RPC method is a spy that can be asserted on", async () => {
    const srv = mockServer();
    await srv.getAccount("G...");
    expect(srv.getAccount).toHaveBeenCalledOnce();
  });
});

describe("mockAssemble / noSleep", () => {
  it("mockAssemble builds valid XDR from the raw transaction", () => {
    const raw = buildTx("balance");
    const built = mockAssemble(raw as any, simSuccess(nativeToScVal(1n, { type: "i128" })) as any);
    expect(typeof built.build().toXDR()).toBe("string");
  });
  it("noSleep resolves immediately", async () => {
    await expect(noSleep(10_000)).resolves.toBeUndefined();
  });
});
