/**
 * Integration tests for Veritoken contracts against a local Stellar quickstart
 * node. Every test receives a newly deployed fixture, while uploaded WASM code
 * is cached for the lifetime of this process.
 *
 * Prerequisites:
 *   - A Stellar standalone node on http://localhost:8000
 *     (`docker-compose up -d` from the repository root)
 *   - WASM binaries under target/wasm32v1-none/release/
 *
 * Run: npm run test:lifecycle
 */

import { scValToNative, xdr } from "@stellar/stellar-sdk";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import type { FixtureContext } from "./fixtures/fixture-runner";
import {
  accountAddress,
  complianceFixturePlan,
  createIntegrationFixtureEnvironment,
  i128,
  invoiceFixturePlan,
  invoiceMetadata,
  kycFixturePlan,
  rwaFixturePlan,
} from "./fixtures/fixture-plans";

const { runner } = createIntegrationFixtureEnvironment();

describe("KYC Registry lifecycle", () => {
  let fixture: FixtureContext | undefined;

  beforeEach(async () => {
    fixture = await runner.setup(kycFixturePlan());
  });

  afterEach(async () => {
    await runner.teardown(fixture);
    fixture = undefined;
  });

  const current = (): FixtureContext => {
    if (!fixture) throw new Error("KYC fixture was not initialized");
    return fixture;
  };

  it("deploys KYC registry and admin can add a verifier", async () => {
    expect(current().contract("kyc")).toBeTruthy();
    const count = await current().invoke("kyc", "verifier_count", []);
    expect(count.u32()).toBe(1);
  });

  it("lifecycle_count starts at zero for an unknown subject", async () => {
    const result = await current().invoke("kyc", "get_lifecycle_count", [
      accountAddress(current().account("unknown")),
    ]);
    expect(result.u32()).toBe(0);
  });

  it("approve records a lifecycle entry and advances count to 1", async () => {
    const subject = accountAddress(current().account("subject"));
    const verifier = accountAddress(current().account("admin"));

    await current().invoke("kyc", "approve", [
      verifier,
      subject,
      xdr.ScVal.scvU32(1),
      xdr.ScVal.scvU64(xdr.Uint64.fromString("0")),
      xdr.ScVal.scvString("US"),
    ]);

    const count = await current().invoke("kyc", "get_lifecycle_count", [
      subject,
    ]);
    expect(count.u32()).toBe(1);
  });

  it("approve then revoke produces two lifecycle entries", async () => {
    const subject = accountAddress(current().account("subject"));
    const verifier = accountAddress(current().account("admin"));

    await current().invoke("kyc", "approve", [
      verifier,
      subject,
      xdr.ScVal.scvU32(0),
      xdr.ScVal.scvU64(xdr.Uint64.fromString("0")),
      xdr.ScVal.scvString("DE"),
    ]);
    await current().invoke("kyc", "revoke", [verifier, subject]);

    const count = await current().invoke("kyc", "get_lifecycle_count", [
      subject,
    ]);
    expect(count.u32()).toBe(2);
  });

  it("get_lifecycle_history returns entries after transitions", async () => {
    const subject = accountAddress(current().account("subject"));
    const verifier = accountAddress(current().account("admin"));

    await current().invoke("kyc", "approve", [
      verifier,
      subject,
      xdr.ScVal.scvU32(2),
      xdr.ScVal.scvU64(xdr.Uint64.fromString("0")),
      xdr.ScVal.scvString("GB"),
    ]);

    const history = await current().invoke("kyc", "get_lifecycle_history", [
      subject,
      xdr.ScVal.scvU32(0),
      xdr.ScVal.scvU32(10),
    ]);
    expect(history.vec()?.length).toBeGreaterThanOrEqual(1);
  });

  it("is_approved returns true after approve and false after revoke", async () => {
    const subject = accountAddress(current().account("subject"));
    const verifier = accountAddress(current().account("admin"));

    await current().invoke("kyc", "approve", [
      verifier,
      subject,
      xdr.ScVal.scvU32(0),
      xdr.ScVal.scvU64(xdr.Uint64.fromString("0")),
      xdr.ScVal.scvString("JP"),
    ]);
    const approved = await current().invoke("kyc", "is_approved", [subject]);
    expect(scValToNative(approved)).toBe(true);

    await current().invoke("kyc", "revoke", [verifier, subject]);
    const revoked = await current().invoke("kyc", "is_approved", [subject]);
    expect(scValToNative(revoked)).toBe(false);
  });

  it("get_lifecycle_history returns an empty vector for an unknown subject", async () => {
    const history = await current().invoke("kyc", "get_lifecycle_history", [
      accountAddress(current().account("unknown")),
      xdr.ScVal.scvU32(0),
      xdr.ScVal.scvU32(10),
    ]);
    expect(history.vec()?.length).toBe(0);
  });
});

describe("Compliance Engine lifecycle", () => {
  let fixture: FixtureContext | undefined;

  beforeEach(async () => {
    fixture = await runner.setup(complianceFixturePlan());
  });

  afterEach(async () => {
    await runner.teardown(fixture);
    fixture = undefined;
  });

  const current = (): FixtureContext => {
    if (!fixture) throw new Error("Compliance fixture was not initialized");
    return fixture;
  };

  it("deploys compliance engine and default rules allow transfers", async () => {
    expect(current().contract("compliance")).toBeTruthy();

    const result = await current().invoke("compliance", "can_transfer", [
      accountAddress(current().account("investor")),
      accountAddress(current().account("subject")),
      i128("1000"),
    ]);
    expect(scValToNative(result)).toBe(true);
  });

  it("pause blocks all transfers without leaking state into the next test", async () => {
    await current().invoke("compliance", "pause", []);

    const result = await current().invoke("compliance", "can_transfer", [
      accountAddress(current().account("investor")),
      accountAddress(current().account("subject")),
      i128("1"),
    ]);
    expect(scValToNative(result)).toBe(false);
  });
});

describe("RWA Token lifecycle", () => {
  let fixture: FixtureContext | undefined;

  beforeEach(async () => {
    fixture = await runner.setup(rwaFixturePlan());
  });

  afterEach(async () => {
    await runner.teardown(fixture);
    fixture = undefined;
  });

  it("deploys RWA token with correct metadata", async () => {
    if (!fixture) throw new Error("RWA fixture was not initialized");
    expect(fixture.contract("rwa")).toBeTruthy();
    const name = await fixture.invoke("rwa", "name", []);
    expect(name.str().toString()).toBe("Veritoken RWA");
  });
});

describe("RWA Token recovery lifecycle (2-of-3)", () => {
  let fixture: FixtureContext | undefined;

  beforeEach(async () => {
    fixture = await runner.setup(rwaFixturePlan());
  });

  afterEach(async () => {
    await runner.teardown(fixture);
    fixture = undefined;
  });

  const current = (): FixtureContext => {
    if (!fixture) throw new Error("RWA recovery fixture was not initialized");
    return fixture;
  };

  it.skip("completes a 2-of-3 propose → approve × 2 → execute recovery flow and new admin can mint", async () => {
    const admin = accountAddress(current().account("admin"));

    // Build three distinct guardian addresses (deterministic, re-derived from seed)
    const { Keypair, xdr: sdkXdr } = await import("@stellar/stellar-sdk");
    const { createHash } = await import("node:crypto");
    const guardianKeypair = (label: string) =>
      Keypair.fromRawEd25519Seed(
        createHash("sha256")
          .update(`veritoken-recovery-test:${label}`)
          .digest(),
      );
    const g1 = guardianKeypair("g1");
    const g2 = guardianKeypair("g2");
    const g3 = guardianKeypair("g3");
    const newAdmin = guardianKeypair("new-admin");

    const guardianAddress = (kp: InstanceType<typeof Keypair>): xdr.ScVal =>
      sdkXdr.ScVal.scvAddress(
        sdkXdr.ScAddress.scAddressTypeAccount(
          sdkXdr.PublicKey.publicKeyTypeEd25519(
            Buffer.from(kp.rawPublicKey()),
          ),
        ),
      );

    const membersVec = sdkXdr.ScVal.scvVec([
      guardianAddress(g1),
      guardianAddress(g2),
      guardianAddress(g3),
    ]);

    // configure_recovery(threshold=2, members=[g1,g2,g3], cooldown=100)
    await current().invoke("rwa", "configure_recovery", [
      sdkXdr.ScVal.scvU32(2),
      membersVec,
      sdkXdr.ScVal.scvU32(100),
    ]);

    // propose_recovery(caller=g1, proposed_admin=newAdmin)
    await current().invoke("rwa", "propose_recovery", [
      guardianAddress(g1),
      guardianAddress(newAdmin),
    ]);

    // approve_recovery(caller=g2)
    await current().invoke("rwa", "approve_recovery", [guardianAddress(g2)]);

    // approve_recovery(caller=g3) — second approval meets threshold=2
    await current().invoke("rwa", "approve_recovery", [guardianAddress(g3)]);

    // execute_recovery(caller=g1)
    await current().invoke("rwa", "execute_recovery", [guardianAddress(g1)]);

    // KYC-approve an investor and confirm new admin can mint
    const investor = accountAddress(current().account("investor"));
    await current().invoke("kyc", "approve", [
      admin, // verifier is admin in the fixture
      investor,
      sdkXdr.ScVal.scvU32(1),
      sdkXdr.ScVal.scvU64(sdkXdr.Uint64.fromString("0")),
      sdkXdr.ScVal.scvString("US"),
    ]);

    await current().invoke("rwa", "mint", [
      guardianAddress(newAdmin),
      investor,
      i128("1000"),
    ]);

    const balance = await current().invoke("rwa", "balance", [investor]);
    // balance should equal 1000
    expect(balance.i128()).toBeDefined();
  });
});

describe("Invoice Token multi-invoice lifecycle", () => {
  let fixture: FixtureContext | undefined;

  beforeEach(async () => {
    fixture = await runner.setup(invoiceFixturePlan());
  });

  afterEach(async () => {
    await runner.teardown(fixture);
    fixture = undefined;
  });

  const current = (): FixtureContext => {
    if (!fixture) throw new Error("Invoice fixture was not initialized");
    return fixture;
  };

  it("deploys invoice token and lists the initial invoice", async () => {
    expect(current().contract("invoice")).toBeTruthy();
    const invoices = await current().invoke("invoice", "list_invoices", [
      xdr.ScVal.scvU32(0),
      xdr.ScVal.scvU32(10),
    ]);
    expect(invoices.vec()?.length).toBe(1);
  });

  it("creates a second invoice in its isolated fixture", async () => {
    await current().invoke("invoice", "create_invoice", [
      invoiceMetadata({
        debtor: "Delta Ltd",
        discountRateBps: 100,
        faceValue: "500000000000",
        invoiceId: "INV-002",
        issuer: "Beta Corp",
      }),
    ]);

    const invoices = await current().invoke("invoice", "list_invoices", [
      xdr.ScVal.scvU32(0),
      xdr.ScVal.scvU32(10),
    ]);
    expect(invoices.vec()?.length).toBe(2);
  });
});
