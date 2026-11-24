/**
 * Veritoken — minimal read-only KYC status query (JavaScript, Node.js)
 * =====================================================================
 * Asks the KYC registry whether one address is currently approved, using the
 * repository's own SDK (`@veritoken/sdk`). It is a read-only simulation: no
 * secret key, no signing, no funded account, and no transaction is submitted.
 *
 * Run from the repository root:
 *
 *   npm install            # links the sdk workspace as @veritoken/sdk
 *   npm run build:sdk      # builds sdk/dist, which this script imports
 *
 *   export VITE_KYC_REGISTRY_ID=C...      # placeholder: your kyc-registry contract ID
 *   export KYC_SUBJECT_ADDRESS=G...       # placeholder: the address to check
 *   export STELLAR_NETWORK=testnet        # optional; defaults to testnet
 *
 *   node docs/examples/kyc_read_example.mjs
 *
 * Network configuration is resolved by the SDK (`resolveNetworkConfig`):
 * `VERITOKEN_NETWORK` / `STELLAR_NETWORK` pick the network, and
 * `VERITOKEN_RPC_URL` / `SOROBAN_RPC_URL` override the RPC endpoint.
 *
 * Exit codes: 0 when the read succeeded (approved OR not approved),
 * 1 when the status could not be read (bad input, RPC, or contract error).
 */

import { createClients, resolveNetworkConfig } from "@veritoken/sdk";

const CONTRACT_ID_RE = /^C[A-Z2-7]{55}$/;
const ACCOUNT_ID_RE = /^G[A-Z2-7]{55}$/;

const contractId = process.env.VITE_KYC_REGISTRY_ID ?? "";
const subject = process.env.KYC_SUBJECT_ADDRESS ?? "";

if (!CONTRACT_ID_RE.test(contractId) || !ACCOUNT_ID_RE.test(subject)) {
  console.error(
    "Set VITE_KYC_REGISTRY_ID to a kyc-registry contract ID (C...) and " +
      "KYC_SUBJECT_ADDRESS to a Stellar account address (G...).",
  );
  process.exit(1);
}

let network;
let kycRegistry;
try {
  // Throws InvalidNetworkConfigError for an unknown network or unsafe RPC URL,
  // and the client constructor throws for a malformed contract ID checksum.
  network = resolveNetworkConfig();
  ({ kycRegistry } = createClients({
    network: network.network,
    rpcUrl: network.rpcUrl,
    networkPassphrase: network.networkPassphrase,
    allowHttp: network.allowHttp,
    contractIds: { kycRegistry: contractId },
  }));
} catch (err) {
  console.error(`Invalid configuration: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

console.log(`Network:  ${network.network} (${network.rpcUrl})`);
console.log(`Registry: ${contractId}`);
console.log(`Subject:  ${subject}`);

try {
  // Simulates kyc-registry::is_approved(addr) and decodes the bool result.
  const approved = await kycRegistry.isApproved(subject);

  if (approved) {
    console.log("is_approved: true — the subject has a current, unexpired approval.");
  } else {
    // A definite answer from the contract, NOT a failure: the subject was never
    // approved, was rejected or revoked, or the approval has expired.
    console.log("is_approved: false — the read succeeded; the subject is not currently approved.");
  }
} catch (err) {
  // Network, RPC, or contract errors land here. They mean "status unknown",
  // and must never be treated as "not approved".
  console.error("KYC status could not be read (this is not a 'not approved' result):");
  console.error(`  ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
