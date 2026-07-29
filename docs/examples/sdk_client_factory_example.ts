/**
 * SDK client factory & dependency injection example (#395).
 *
 * Run with: `npx tsx docs/examples/sdk_client_factory_example.ts`
 * (requires VITE_KYC_REGISTRY_ID / VITE_RWA_TOKEN_ID to be set — see README.md)
 *
 * This mirrors the three workflows in the other language examples
 * (read metadata, check KYC state, submit a transfer) but shows how a host
 * application composes clients through `createClients`/`ClientFactory`
 * instead of constructing each one by hand.
 */

import {
  createClients,
  ClientFactory,
  type KycRegistryClient,
  type SignTx,
} from "@veritoken/sdk";

// ── 1. Basic usage: build every configured client from one config object ──────

const clients = createClients({
  network: "testnet",
  contractIds: {
    kycRegistry: process.env.VITE_KYC_REGISTRY_ID,
    rwaToken: process.env.VITE_RWA_TOKEN_ID,
    // complianceEngine / invoiceToken / propertyToken / carbonToken omitted
    // here — they're simply absent from `clients` rather than throwing.
  },
});

async function readWorkflow(address: string) {
  const isApproved = await clients.kycRegistry?.isApproved(address);
  const balance = await clients.rwaToken?.balance(address);
  console.log({ isApproved, balance });
}

// ── 2. ClientFactory: fail-fast getters instead of optional-chaining ──────────

const factory = new ClientFactory({
  network: "testnet",
  contractIds: { kycRegistry: process.env.VITE_KYC_REGISTRY_ID },
});

async function submitWorkflow(address: string, to: string, amount: bigint, signTx: SignTx) {
  // Throws a clear error immediately if rwaToken wasn't configured, instead
  // of a confusing "Cannot read properties of undefined" deep in a handler.
  const rwa = factory.get("rwaToken");
  await rwa.transfer(address, to, amount, signTx);
}

// ── 3. Dependency injection: swap in a mock client for tests ──────────────────
//
// Any object structurally matching the client's public API can be injected —
// no real contract ID or network access required. This is how downstream
// applications unit-test code that depends on the SDK without touching a
// live (or even mocked) RPC endpoint.

function buildTestClients() {
  const fakeKyc: Pick<KycRegistryClient, "isApproved"> = {
    isApproved: async (_addr: string) => true,
  };

  return createClients({
    contractIds: {},
    overrides: { kycRegistry: fakeKyc as KycRegistryClient },
  });
}

async function main() {
  const address = "GBQG2SJ7MXUH34SI3MJ2I256I5UMGM2QSQZM77YFX5S6JOHXUQJEPC3A";
  await readWorkflow(address);

  const test = buildTestClients();
  console.log("injected mock KYC approved:", await test.kycRegistry?.isApproved(address));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
