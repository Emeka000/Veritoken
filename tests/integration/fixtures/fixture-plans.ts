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

export const rwaFixturePlan = (): FixturePlan => ({
  name: "rwa-lifecycle",
  steps: [
    kycStep,
    complianceStep,
    {
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
    },
  ],
});

export const invoiceFixturePlan = (): FixturePlan => ({
  name: "invoice-lifecycle",
  steps: [
    kycStep,
    complianceStep,
    {
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
    },
  ],
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
