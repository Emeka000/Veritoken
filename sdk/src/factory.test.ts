import { describe, it, expect } from "vitest";
import { Networks } from "@stellar/stellar-sdk";
import { createClients, ClientFactory } from "./factory.js";
import { KycRegistryClient } from "./clients/KycRegistryClient.js";
import { RwaTokenClient } from "./clients/RwaTokenClient.js";
import { mockServer } from "./testing/mockRpc.js";

const KYC_ID = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const RWA_ID = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

describe("createClients", () => {
  it("builds only the clients whose contract ID is present", () => {
    const server = mockServer();
    const clients = createClients({ server, contractIds: { kycRegistry: KYC_ID } });
    expect(clients.kycRegistry).toBeInstanceOf(KycRegistryClient);
    expect(clients.rwaToken).toBeUndefined();
  });

  it("builds multiple clients sharing the same injected server", () => {
    const server = mockServer();
    const clients = createClients({
      server,
      contractIds: { kycRegistry: KYC_ID, rwaToken: RWA_ID },
    });
    expect(clients.kycRegistry).toBeInstanceOf(KycRegistryClient);
    expect(clients.rwaToken).toBeInstanceOf(RwaTokenClient);
  });

  it("defaults to a real testnet server when none is injected", () => {
    const clients = createClients({ contractIds: { kycRegistry: KYC_ID } });
    expect(clients.kycRegistry).toBeInstanceOf(KycRegistryClient);
  });

  it("dependency injection: overrides take priority over contractIds for the same key", () => {
    const fakeKyc = { isApproved: async () => true } as unknown as KycRegistryClient;
    const clients = createClients({
      server: mockServer(),
      contractIds: { kycRegistry: KYC_ID },
      overrides: { kycRegistry: fakeKyc },
    });
    expect(clients.kycRegistry).toBe(fakeKyc);
  });

  it("dependency injection: a mock client can be supplied with no contract ID at all", () => {
    const fakeRwa = { balance: async () => 42n } as unknown as RwaTokenClient;
    const clients = createClients({ contractIds: {}, overrides: { rwaToken: fakeRwa } });
    expect(clients.rwaToken).toBe(fakeRwa);
  });

  it("respects an explicit networkPassphrase override", () => {
    const server = mockServer();
    const clients = createClients({
      server,
      networkPassphrase: Networks.PUBLIC,
      contractIds: { kycRegistry: KYC_ID },
    });
    expect(clients.kycRegistry).toBeInstanceOf(KycRegistryClient);
  });
});

describe("ClientFactory", () => {
  it("get() returns a configured client", () => {
    const factory = new ClientFactory({ server: mockServer(), contractIds: { kycRegistry: KYC_ID } });
    expect(factory.get("kycRegistry")).toBeInstanceOf(KycRegistryClient);
  });

  it("get() throws a descriptive error for an unconfigured client", () => {
    const factory = new ClientFactory({ server: mockServer(), contractIds: { kycRegistry: KYC_ID } });
    expect(() => factory.get("rwaToken")).toThrow(/rwaToken.*not configured/s);
  });

  it("has() reflects configuration state", () => {
    const factory = new ClientFactory({ server: mockServer(), contractIds: { kycRegistry: KYC_ID } });
    expect(factory.has("kycRegistry")).toBe(true);
    expect(factory.has("rwaToken")).toBe(false);
  });

  it("get() returns an injected override", () => {
    const fakeKyc = {} as KycRegistryClient;
    const factory = new ClientFactory({ contractIds: {}, overrides: { kycRegistry: fakeKyc } });
    expect(factory.get("kycRegistry")).toBe(fakeKyc);
  });
});
