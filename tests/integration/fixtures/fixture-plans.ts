import { createHash } from "node:crypto";
import * as path from "node:path";

import {
  Address,
  Keypair,
  Networks,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";

import {
  FixtureRunner,
  type FixtureAccounts,
  type FixturePlan,
} from "./fixture-runner";
import { SorobanTransport } from "./soroban-transport";

const QUICKSTART_ADMIN_SECRET =
  "SC5O7VZUXDJ6JBDSZ74DSERXL7W3Y5LTOAMRF7RQRL3TAGAPS7LUVG3L";

export const WASM_DIR = path.resolve(
  import.meta.dirname,
  "../../../target/wasm32v1-none/release",
);

export const wasmPath = (filename: string): string =>
  path.join(WASM_DIR, filename);

const deterministicKeypair = (label: string): Keypair =>
  Keypair.fromRawEd25519Seed(
    createHash("sha256").update(`veritoken-fixture:${label}`).digest(),
  );

export const createFixtureAccounts = (): FixtureAccounts => ({
  admin: Keypair.fromSecret(QUICKSTART_ADMIN_SECRET),
  investor: deterministicKeypair("investor"),
  subject: deterministicKeypair("subject"),
  unknown: deterministicKeypair("unknown"),
});

export const accountAddress = (keypair: Keypair): xdr.ScVal =>
  xdr.ScVal.scvAddress(
    xdr.ScAddress.scAddressTypeAccount(
      xdr.PublicKey.publicKeyTypeEd25519(
        Buffer.from(keypair.rawPublicKey()),
      ),
    ),
  );

export const contractAddress = (contractId: string): xdr.ScVal =>
  Address.fromString(contractId).toScVal();

export const i128 = (value: string): xdr.ScVal =>
  xdr.ScVal.scvI128(
    new xdr.Int128Parts({
      hi: xdr.Int64.fromString("0"),
      lo: xdr.Uint64.fromString(value),
    }),
  );

export interface InvoiceMetadataOptions {
  debtor: string;
  discountRateBps: number;
  faceValue: string;
  invoiceId: string;
  issuer: string;
}

export const invoiceMetadata = (
  options: InvoiceMetadataOptions,
): xdr.ScVal =>
  xdr.scvSortedMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("invoice_id"),
      val: xdr.ScVal.scvString(options.invoiceId),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("issuer"),
      val: xdr.ScVal.scvString(options.issuer),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("debtor"),
      val: xdr.ScVal.scvString(options.debtor),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("face_value_usd"),
      val: i128(options.faceValue),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("discount_rate_bps"),
      val: xdr.ScVal.scvU32(options.discountRateBps),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("due_date"),
      val: xdr.ScVal.scvU64(xdr.Uint64.fromString("1900000000")),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("currency"),
      val: xdr.ScVal.scvString("USD"),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("ipfs_doc_hash"),
      val: xdr.ScVal.scvString(""),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("notification_webhook"),
      val: xdr.ScVal.scvString(""),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("transfer_fee_bps"),
      val: xdr.ScVal.scvU32(0),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("fee_recipient"),
      val: xdr.ScVal.scvVoid(),
    }),
  ]);

const kycStep = {
  name: "kyc",
  wasmPath: wasmPath("kyc_registry.wasm"),
  afterDeploy: async (context) => {
    const admin = accountAddress(context.account("admin"));
    await context.invoke("kyc", "initialize", [admin]);
    await context.invoke("kyc", "add_verifier", [admin, admin]);
  },
} satisfies FixturePlan["steps"][number];

const complianceStep = {
  name: "compliance",
  wasmPath: wasmPath("compliance_engine.wasm"),
  dependsOn: ["kyc"],
  afterDeploy: async (context) => {
    await context.invoke("compliance", "initialize", [
      accountAddress(context.account("admin")),
      contractAddress(context.contract("kyc")),
      xdr.ScVal.scvU64(xdr.Uint64.fromString("0")),
    ]);
  },
} satisfies FixturePlan["steps"][number];

export const kycFixturePlan = (): FixturePlan => ({
  name: "kyc-lifecycle",
  steps: [kycStep],
});

export const complianceFixturePlan = (): FixturePlan => ({
  name: "compliance-lifecycle",
  steps: [kycStep, complianceStep],
});

const rwaStep = {
  name: "rwa",
  wasmPath: wasmPath("rwa_token.wasm"),
  dependsOn: ["kyc", "compliance"],
  constructorArgs: (context) => [
    accountAddress(context.account("admin")),
    xdr.ScVal.scvU32(7),
    xdr.ScVal.scvString("Veritoken RWA"),
    xdr.ScVal.scvString("VTRWA"),
    xdr.ScVal.scvString("property"),
    contractAddress(context.contract("kyc")),
    contractAddress(context.contract("compliance")),
    xdr.ScVal.scvVoid(),
    i128("0"),
  ],
} satisfies FixturePlan["steps"][number];

const invoiceStep = {
  name: "invoice",
  wasmPath: wasmPath("invoice_token.wasm"),
  dependsOn: ["kyc", "compliance"],
  constructorArgs: (context) => [
    accountAddress(context.account("admin")),
    contractAddress(context.contract("kyc")),
    contractAddress(context.contract("compliance")),
    invoiceMetadata({
      debtor: "Globex",
      discountRateBps: 250,
      faceValue: "1000000000000",
      invoiceId: "INV-001",
      issuer: "Acme Corp",
    }),
  ],
} satisfies FixturePlan["steps"][number];

export interface ProjectMetaOptions {
  projectId: string;
  standard: string;
  vintageYear: number;
  projectName: string;
  projectType: string;
  country: string;
  verifier: string;
  ipfsCertHash: string;
  registryUrl: string;
  registryProjectId: string;
}

/** Encodes the carbon-credit-token contract's `ProjectMeta` struct as a sorted ScMap. */
export const projectMeta = (options: ProjectMetaOptions): xdr.ScVal =>
  xdr.scvSortedMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("project_id"),
      val: xdr.ScVal.scvString(options.projectId),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("standard"),
      val: xdr.ScVal.scvString(options.standard),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("vintage_year"),
      val: xdr.ScVal.scvU32(options.vintageYear),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("project_name"),
      val: xdr.ScVal.scvString(options.projectName),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("project_type"),
      val: xdr.ScVal.scvString(options.projectType),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("country"),
      val: xdr.ScVal.scvString(options.country),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("verifier"),
      val: xdr.ScVal.scvString(options.verifier),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("ipfs_cert_hash"),
      val: xdr.ScVal.scvString(options.ipfsCertHash),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("registry_url"),
      val: xdr.ScVal.scvString(options.registryUrl),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("registry_project_id"),
      val: xdr.ScVal.scvString(options.registryProjectId),
    }),
  ]);

const carbonStep = {
  name: "carbon",
  wasmPath: wasmPath("carbon_credit_token.wasm"),
  dependsOn: ["kyc", "compliance"],
  constructorArgs: (context) => [
    accountAddress(context.account("admin")),
    contractAddress(context.contract("kyc")),
    contractAddress(context.contract("compliance")),
    projectMeta({
      country: "BR",
      ipfsCertHash: "",
      projectId: "PROJ-001",
      projectName: "Amazon Reforestation",
      projectType: "forestry",
      registryProjectId: "VCS-001",
      registryUrl: "",
      standard: "VCS",
      verifier: "SCS Global Services",
      vintageYear: 2024,
    }),
  ],
} satisfies FixturePlan["steps"][number];

export interface PropertyMetaOptions {
  propertyId: string;
  legalName: string;
  jurisdiction: string;
  address: string;
  totalValuationUsd: string;
  totalShares: string;
  propertyType: string;
  ipfsTitleHash: string;
  kycTierRequired: number;
}

/** Encodes the property-token contract's `PropertyMeta` struct as a sorted ScMap. */
export const propertyMeta = (options: PropertyMetaOptions): xdr.ScVal =>
  xdr.scvSortedMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("property_id"),
      val: xdr.ScVal.scvString(options.propertyId),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("legal_name"),
      val: xdr.ScVal.scvString(options.legalName),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("jurisdiction"),
      val: xdr.ScVal.scvString(options.jurisdiction),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("address"),
      val: xdr.ScVal.scvString(options.address),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("total_valuation_usd"),
      val: i128(options.totalValuationUsd),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("total_shares"),
      val: i128(options.totalShares),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("property_type"),
      val: xdr.ScVal.scvString(options.propertyType),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("ipfs_title_hash"),
      val: xdr.ScVal.scvString(options.ipfsTitleHash),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("kyc_tier_required"),
      val: xdr.ScVal.scvU32(options.kycTierRequired),
    }),
  ]);

const propertyStep = {
  name: "property",
  wasmPath: wasmPath("property_token.wasm"),
  dependsOn: ["kyc", "compliance"],
  constructorArgs: (context) => [
    accountAddress(context.account("admin")),
    contractAddress(context.contract("kyc")),
    contractAddress(context.contract("compliance")),
    propertyMeta({
      address: "1 Market St, San Francisco, CA",
      ipfsTitleHash: "",
      jurisdiction: "US",
      kycTierRequired: 0,
      legalName: "Veritoken Property Holdings LLC",
      propertyId: "PROP-001",
      propertyType: "commercial",
      totalShares: "1000000",
      totalValuationUsd: "5000000000",
    }),
  ],
} satisfies FixturePlan["steps"][number];

export const rwaFixturePlan = (): FixturePlan => ({
  name: "rwa-lifecycle",
  steps: [kycStep, complianceStep, rwaStep],
});

export const invoiceFixturePlan = (): FixturePlan => ({
  name: "invoice-lifecycle",
  steps: [kycStep, complianceStep, invoiceStep],
});

export const carbonFixturePlan = (): FixturePlan => ({
  name: "carbon-lifecycle",
  steps: [kycStep, complianceStep, carbonStep],
});

export const propertyFixturePlan = (): FixturePlan => ({
  name: "property-lifecycle",
  steps: [kycStep, complianceStep, propertyStep],
});

/**
 * Deploys all six Veritoken contracts in one fixture — used by the E2E suite
 * (tests/e2e/global-setup.ts), which needs every contract ID populated before
 * the frontend dev server boots (main.tsx refuses to render without them).
 */
export const fullDeploymentPlan = (): FixturePlan => ({
  name: "full-deployment",
  steps: [kycStep, complianceStep, rwaStep, invoiceStep, propertyStep, carbonStep],
});

export interface IntegrationFixtureEnvironment {
  runner: FixtureRunner;
}

export const createIntegrationFixtureEnvironment =
  (): IntegrationFixtureEnvironment => {
    const rpcUrl =
      process.env.STELLAR_RPC_URL ?? "http://localhost:8000/soroban/rpc";
    const server = new rpc.Server(rpcUrl, { allowHttp: true });
    const transport = new SorobanTransport({
      networkPassphrase: Networks.STANDALONE,
      pollIntervalMs: Number(process.env.STELLAR_POLL_INTERVAL_MS ?? 250),
      rpc: server,
      transactionTimeoutMs: Number(
        process.env.STELLAR_TRANSACTION_TIMEOUT_MS ?? 30_000,
      ),
    });
    return {
      runner: new FixtureRunner(transport, {
        accounts: createFixtureAccounts(),
      }),
    };
  };
