#!/usr/bin/env node
/**
 * Contract client generator (#392).
 *
 * Scaffolds a new `<Name>Client.ts` + `<Name>Client.test.ts` pair under
 * sdk/src/clients/ that follow the same convention as every existing client
 * (KycRegistryClient, RwaTokenClient, ...): extend `BaseContractClient`,
 * take (contractId, server, networkPassphrase) in the constructor, and use
 * `this.read()` / `this.write()` for every contract call.
 *
 * This removes the boilerplate of copy-pasting an existing client and
 * renaming things by hand — it does NOT attempt to invent method signatures
 * for you (it can't know your contract's interface), and it does NOT edit
 * errors.ts / factory.ts / index.ts, since those are small, deliberate edits
 * best made by a human. The generator prints exactly what's left to do.
 *
 * Usage:
 *   node scripts/generate-client.mjs --name Escrow
 *   node scripts/generate-client.mjs --name Escrow --key escrowContract
 *   npm run generate:client -- --name Escrow
 *
 * See sdk/README.md#adding-a-new-contract-client for the full walkthrough.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENTS_DIR = join(__dirname, "..", "src", "clients");

function parseArgs(argv) {
  const args = { force: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--name") args.name = argv[++i];
    else if (arg === "--key") args.key = argv[++i];
    else if (arg === "--force") args.force = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
  }
  return args;
}

function lowerFirst(s) {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function printHelp() {
  console.log(`Usage: node scripts/generate-client.mjs --name <PascalCaseName> [--key <shortKey>] [--force]

  --name   Required. PascalCase contract name, e.g. "Escrow" -> EscrowClient.ts
  --key    Optional. Short key used for ContractName/ClientKey, e.g. "escrow".
           Defaults to the camelCase form of --name.
  --force  Overwrite existing files instead of failing.

Example:
  node scripts/generate-client.mjs --name Escrow
`);
}

function clientTemplate(name, key) {
  return `import type { rpc } from "@stellar/stellar-sdk";
import { BaseContractClient, type SignTx } from "./base.js";
// import { encodeAddress, encodeU32, encodeU64, encodeI128, encodeString } from "../codec.js";

/**
 * Scaffolded by \`generate-client.mjs --name ${name}\`. Remaining steps
 * (see sdk/README.md#adding-a-new-contract-client for details):
 *
 * 1. Add "${key}" to \`ContractName\` in ../errors.ts and give it an
 *    \`ERROR_MAPS\` entry (copy the shape of an existing contract's errors).
 *    Only once that's done will the \`super(...)\` call below type-check —
 *    remove the @ts-expect-error line below at that point.
 * 2. Fill in the Read/Write API methods to match the contract's public
 *    functions, following the pattern of the other *Client.ts files.
 * 3. Register the client in ../factory.ts: add it to \`ClientMap\` and \`CTORS\`.
 * 4. Export it from ../index.ts.
 * 5. Replace the placeholder test in ${name}Client.test.ts with real
 *    coverage using ../testing/mockRpc.js (see any existing *Client.test.ts).
 */
export class ${name}Client extends BaseContractClient {
  constructor(
    contractId: string,
    server: rpc.Server,
    networkPassphrase: string,
  ) {
    // @ts-expect-error "${key}" isn't a ContractName yet — see step 1 above.
    super(contractId, server, networkPassphrase, "${key}");
  }

  // ── Read API ──────────────────────────────────────────────────────────────

  // async example(): Promise<string> {
  //   return this.read<string>("example", []);
  // }

  // ── Write API ─────────────────────────────────────────────────────────────

  // async example(callerAddress: string, signTx: SignTx): Promise<void> {
  //   await this.write("example", [], callerAddress, signTx);
  // }
}
`;
}

function testTemplate(name) {
  return `import { describe, it, expect } from "vitest";
import { Networks } from "@stellar/stellar-sdk";
import { ${name}Client } from "./${name}Client.js";
import { mockServer } from "../testing/mockRpc.js";

const PASSPHRASE = Networks.TESTNET;
const CONTRACT_ID = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

function client(server: ReturnType<typeof mockServer>) {
  return new ${name}Client(CONTRACT_ID, server, PASSPHRASE);
}

describe("${name}Client", () => {
  // Delete this placeholder once real methods exist. Use simSuccess /
  // simFailure / simMalformed from ../testing/mockRpc.js to cover happy
  // paths and failure modes — see PropertyTokenClient.test.ts for the
  // established pattern (read decode, write happy path, error enrichment,
  // malformed payload, network rejection).
  it.todo("add coverage for each read/write method");

  it("constructs against a mock server", () => {
    expect(client(mockServer())).toBeInstanceOf(${name}Client);
  });
});
`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.name) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  if (!/^[A-Z][A-Za-z0-9]*$/.test(args.name)) {
    console.error(`Invalid --name "${args.name}": must be PascalCase (e.g. "Escrow", "RealEstateToken").`);
    process.exit(1);
  }

  const name = args.name;
  const key = args.key ?? lowerFirst(name);

  mkdirSync(CLIENTS_DIR, { recursive: true });
  const clientPath = join(CLIENTS_DIR, `${name}Client.ts`);
  const testPath = join(CLIENTS_DIR, `${name}Client.test.ts`);

  for (const p of [clientPath, testPath]) {
    if (existsSync(p) && !args.force) {
      console.error(`${p} already exists. Pass --force to overwrite.`);
      process.exit(1);
    }
  }

  writeFileSync(clientPath, clientTemplate(name, key));
  writeFileSync(testPath, testTemplate(name));

  console.log(`Created:
  ${clientPath}
  ${testPath}

Next steps:
  1. Add "${key}" to ContractName in src/errors.ts (+ an ERROR_MAPS entry).
  2. Fill in the Read/Write API methods in ${name}Client.ts.
  3. Register ${name}Client in ClientMap + CTORS in src/factory.ts.
  4. Export ${name}Client from src/index.ts.
  5. Write real tests in ${name}Client.test.ts (see any existing *Client.test.ts).

Full walkthrough: sdk/README.md#adding-a-new-contract-client
`);
}

main();
