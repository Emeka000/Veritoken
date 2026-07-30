import { describe, it, expect } from "vitest";
import { CONTRACT_METADATA, discoverContracts } from "./metadata.js";
import type { ClientKey } from "./factory.js";

const KYC_ID = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const RWA_ID = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

const ALL_KEYS: ClientKey[] = [
  "kycRegistry",
  "complianceEngine",
  "invoiceToken",
  "propertyToken",
  "carbonToken",
  "rwaToken",
];

describe("CONTRACT_METADATA", () => {
  it("has an entry for every known client key", () => {
    for (const key of ALL_KEYS) {
      expect(CONTRACT_METADATA[key]).toBeDefined();
      expect(CONTRACT_METADATA[key].package).toBeTruthy();
      expect(CONTRACT_METADATA[key].role).toBeTruthy();
    }
  });

  it("has no extra keys beyond the known client keys", () => {
    expect(Object.keys(CONTRACT_METADATA).sort()).toEqual([...ALL_KEYS].sort());
  });
});

describe("discoverContracts", () => {
  it("marks configured contracts with their ID and configured: true", () => {
    const report = discoverContracts({ kycRegistry: KYC_ID }, "testnet", "2026-01-01T00:00:00.000Z");
    const kyc = report.contracts.find((c) => c.key === "kycRegistry");
    expect(kyc).toMatchObject({
      key: "kycRegistry",
      package: "kyc-registry",
      role: "identity_registry",
      contractId: KYC_ID,
      configured: true,
    });
  });

  it("marks unconfigured contracts with contractId: null and configured: false", () => {
    const report = discoverContracts({ kycRegistry: KYC_ID }, "testnet", "2026-01-01T00:00:00.000Z");
    const rwa = report.contracts.find((c) => c.key === "rwaToken");
    expect(rwa).toMatchObject({ key: "rwaToken", contractId: null, configured: false });
  });

  it("returns every known contract even when contractIds is empty", () => {
    const report = discoverContracts({}, "testnet", "2026-01-01T00:00:00.000Z");
    expect(report.contracts).toHaveLength(ALL_KEYS.length);
    expect(report.contracts.every((c) => !c.configured)).toBe(true);
  });

  it("handles a fully-configured set", () => {
    const report = discoverContracts(
      { kycRegistry: KYC_ID, rwaToken: RWA_ID },
      "mainnet",
      "2026-01-01T00:00:00.000Z",
    );
    const configured = report.contracts.filter((c) => c.configured);
    expect(configured.map((c) => c.key).sort()).toEqual(["kycRegistry", "rwaToken"]);
  });

  it("passes through network and generatedAt verbatim", () => {
    const report = discoverContracts({}, "futurenet", "2026-07-29T12:00:00.000Z");
    expect(report.network).toBe("futurenet");
    expect(report.generatedAt).toBe("2026-07-29T12:00:00.000Z");
  });

  it("treats an empty-string contract ID as unconfigured", () => {
    const report = discoverContracts({ kycRegistry: "" }, "testnet", "2026-01-01T00:00:00.000Z");
    const kyc = report.contracts.find((c) => c.key === "kycRegistry");
    expect(kyc).toMatchObject({ contractId: null, configured: false });
  });
});
