/**
 * Veritoken — JavaScript (Node.js) integration examples
 * ======================================================
 * Demonstrates three common workflows against deployed Veritoken contracts
 * using plain Node.js — no TypeScript compiler or bundler required.
 *
 * Workflows covered:
 *   1. Read compliance rules and token metadata (simulation, no signing)
 *   2. Check KYC state for an address
 *   3. Build, sign, and submit a token transfer
 *
 * Prerequisites
 * -------------
 *   node >= 20
 *   npm install @stellar/stellar-sdk
 *
 * Set the contract IDs before running:
 *
 *   export VITE_KYC_REGISTRY_ID=C...
 *   export VITE_COMPLIANCE_ENGINE_ID=C...
 *   export VITE_INVOICE_TOKEN_ID=C...
 *   export VITE_RWA_TOKEN_ID=C...
 *   export STELLAR_SECRET_KEY=S...   # required for workflow 3 only
 *
 * TypeScript SDK equivalents are noted in inline comments so you can find the
 * corresponding method in sdk/src/clients/ for each call.
 */

import {
  Address,
  Contract,
  Keypair,
  Networks,
  SorobanRpc,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";

// ── Configuration ─────────────────────────────────────────────────────────────

const NETWORK = process.env.STELLAR_NETWORK ?? "testnet";

const RPC_URL =
  NETWORK === "mainnet"
    ? "https://mainnet.sorobanrpc.com"
    : "https://soroban-testnet.stellar.org";

const NETWORK_PASSPHRASE =
  NETWORK === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;

const KYC_REGISTRY_ID = process.env.VITE_KYC_REGISTRY_ID;
const COMPLIANCE_ENGINE_ID = process.env.VITE_COMPLIANCE_ENGINE_ID;
const INVOICE_TOKEN_ID = process.env.VITE_INVOICE_TOKEN_ID;
const RWA_TOKEN_ID = process.env.VITE_RWA_TOKEN_ID;

// Address to inspect in the KYC workflow — replace with a real address
const EXAMPLE_ADDRESS =
  process.env.EXAMPLE_ADDRESS ??
  "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

const server = new SorobanRpc.Server(RPC_URL, { allowHttp: false });

// Throwaway keypair used for simulation reads — the source is not verified.
const SIM_KEYPAIR = Keypair.random();

// ── Helper: simulate a read-only contract call ────────────────────────────────

/**
 * Simulate a contract call and return the decoded return value.
 *
 * TypeScript SDK equivalent:
 *   BaseContractClient.simulate(method, args)  (sdk/src/clients/base.ts)
 *
 * @param {string} contractId
 * @param {string} method
 * @param {xdr.ScVal[]} args
 * @returns {Promise<unknown>} Native JS value decoded from the SCVal
 */
async function simulateCall(contractId, method, args) {
  const contract = new Contract(contractId);
  const simAccount = await server.getAccount(SIM_KEYPAIR.publicKey());

  const tx = new TransactionBuilder(simAccount, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const result = await server.simulateTransaction(tx);

  if (SorobanRpc.Api.isSimulationError(result)) {
    throw new Error(`Simulation error in ${method}: ${result.error}`);
  }
  if (!result.result?.retval) {
    throw new Error(`No return value from ${method}`);
  }

  // scValToNative converts the Soroban SCVal to a plain JS value.
  // This mirrors what the TypeScript SDK's scVal<T>() helper does internally.
  return scValToNative(result.result.retval);
}

// ── Workflow 1: Read compliance rules and token metadata ──────────────────────

/**
 * Fetch compliance rules and invoice metadata without signing anything.
 *
 * TypeScript SDK equivalents:
 *   ComplianceEngineClient.getRules()  → compliance-engine::get_rules
 *   InvoiceTokenClient.getMeta()       → invoice-token::get_meta
 */
async function workflowReadMetadata() {
  console.log("\n── Workflow 1: Read metadata ─────────────────────────────────────");

  // get_rules takes no arguments — pass an empty array
  const rules = await simulateCall(COMPLIANCE_ENGINE_ID, "get_rules", []);
  console.log("Compliance rules:");
  console.log(JSON.stringify(rules, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));

  // get_meta on the invoice token returns the full InvoiceMeta struct
  const meta = await simulateCall(INVOICE_TOKEN_ID, "get_meta", []);
  console.log("\nInvoice token metadata:");
  console.log(JSON.stringify(meta, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
}

// ── Workflow 2: Check KYC state for an address ────────────────────────────────

/**
 * Query whether an address is KYC-approved and retrieve its full record.
 *
 * TypeScript SDK equivalents:
 *   KycRegistryClient.isApproved(addr)  → kyc-registry::is_approved
 *   KycRegistryClient.getTier(addr)     → kyc-registry::get_tier
 *   KycRegistryClient.getRecord(addr)   → kyc-registry::get_record
 *
 * @param {string} address Stellar public key (G...)
 */
async function workflowCheckKyc(address) {
  console.log("\n── Workflow 2: KYC state check ───────────────────────────────────");
  console.log(`Checking KYC state for: ${address}`);

  // Address.toScVal() converts a Stellar address string into the SCVal the
  // contract expects. This is the same helper the TypeScript SDK uses.
  const addrArg = new Address(address).toScVal();

  const isApproved = await simulateCall(KYC_REGISTRY_ID, "is_approved", [addrArg]);
  console.log(`  is_approved: ${isApproved}`);

  // get_tier returns u32: 0=Basic, 1=Accredited, 2=Institutional
  const tier = await simulateCall(KYC_REGISTRY_ID, "get_tier", [addrArg]);
  const tierNames = { 0: "Basic", 1: "Accredited", 2: "Institutional" };
  console.log(`  tier: ${tier} (${tierNames[tier] ?? "unknown"})`);

  // get_record returns the full KycRecord struct
  const record = await simulateCall(KYC_REGISTRY_ID, "get_record", [addrArg]);
  console.log("  full record:");
  console.log(
    JSON.stringify(record, (_, v) => (typeof v === "bigint" ? v.toString() : v), 4),
  );
}

// ── Workflow 3: Build, sign, and submit a token transfer ──────────────────────

/**
 * Build a transfer transaction, sign it, and submit it to the network.
 *
 * amount is in stroops (7 decimal places).
 * To transfer 1.0 token pass amount = 10_000_000n.
 *
 * TypeScript SDK equivalent:
 *   RwaTokenClient.buildTransferXdr(from, to, amount)
 *   — then sign and submit via Freighter or stellar-sdk
 *
 * @param {string} secretKey  Stellar secret key (S...)
 * @param {string} toAddress  Recipient address (G...)
 * @param {bigint} amount     Amount in stroops
 */
async function workflowTransfer(secretKey, toAddress, amount) {
  console.log("\n── Workflow 3: Token transfer ────────────────────────────────────");

  const keypair = Keypair.fromSecret(secretKey);
  const fromAddress = keypair.publicKey();
  console.log(`  from:   ${fromAddress}`);
  console.log(`  to:     ${toAddress}`);
  console.log(`  amount: ${amount} stroops (${Number(amount) / 10_000_000} tokens)`);

  const sourceAccount = await server.getAccount(fromAddress);
  const contract = new Contract(RWA_TOKEN_ID);

  // Build the transaction.
  // nativeToScVal converts JS values to SCVal — the same function the
  // TypeScript SDK uses internally in buildTransferXdr().
  let tx = new TransactionBuilder(sourceAccount, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "transfer",
        new Address(fromAddress).toScVal(),
        new Address(toAddress).toScVal(),
        nativeToScVal(amount, { type: "i128" }),
      ),
    )
    .setTimeout(30)
    .build();

  // Simulate to get the resource footprint and updated fee estimate
  const simResult = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(simResult)) {
    console.error(`  Simulation failed: ${simResult.error}`);
    return;
  }

  // assembleTransaction adds the resource footprint returned by simulation
  tx = SorobanRpc.assembleTransaction(tx, simResult).build();
  tx.sign(keypair);

  const sendResult = await server.sendTransaction(tx);
  console.log(`  Submitted tx hash: ${sendResult.hash}`);

  if (sendResult.status === "ERROR") {
    console.error(`  Error: ${sendResult.errorResult?.toXDR("base64")}`);
    return;
  }

  // Poll until confirmed
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const poll = await server.getTransaction(sendResult.hash);
    if (poll.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      console.log("  Transfer confirmed ✓");
      return;
    }
    if (poll.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
      console.error(`  Transfer failed: ${poll.resultXdr.toXDR("base64")}`);
      return;
    }
  }

  console.log("  Timed out waiting for confirmation — check the explorer.");
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  if (!KYC_REGISTRY_ID || !COMPLIANCE_ENGINE_ID || !INVOICE_TOKEN_ID) {
    console.error(
      "Missing contract IDs. Set VITE_KYC_REGISTRY_ID, " +
        "VITE_COMPLIANCE_ENGINE_ID, and VITE_INVOICE_TOKEN_ID.",
    );
    process.exit(1);
  }

  await workflowReadMetadata();
  await workflowCheckKyc(EXAMPLE_ADDRESS);

  const secretKey = process.env.STELLAR_SECRET_KEY;
  const toAddress = process.env.TRANSFER_TO_ADDRESS ?? EXAMPLE_ADDRESS;
  const amount = BigInt(process.env.TRANSFER_AMOUNT ?? "10000000"); // default 1.0 token

  if (secretKey && RWA_TOKEN_ID) {
    await workflowTransfer(secretKey, toAddress, amount);
  } else {
    console.log(
      "\n── Workflow 3 skipped ────────────────────────────────────────────\n" +
        "Set STELLAR_SECRET_KEY and VITE_RWA_TOKEN_ID to run the transfer workflow.",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
