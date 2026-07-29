#!/usr/bin/env tsx
/**
 * codegen-types.ts — Auto-generates TypeScript types from Soroban contract schemas.
 *
 * For each contract listed in CONTRACT_SCHEMAS, this script reads the on-chain
 * contract spec (stored as XDR in the compiled .wasm or pulled from the network
 * via `stellar contract info`) and emits a corresponding TypeScript interface
 * to `src/types/generated/`.
 *
 * Usage:
 *   npx tsx scripts/codegen-types.ts
 *   # or via npm script: npm run codegen
 *
 * The generated files are committed to source control so the build does not
 * require a live Stellar RPC connection. Re-run after any contract change.
 *
 * Issue #433 — Auto-Generated Types from Contract Schema
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "../src/types/generated");

// ── Contract manifest ─────────────────────────────────────────────────────────

/**
 * Map of friendly name → WASM path (relative to repo root) and the optional
 * contract ID for pulling live spec from the network.
 *
 * WASM paths are built artifacts produced by `cargo build --target wasm32-unknown-unknown`.
 */
const CONTRACT_SCHEMAS: Record<string, { wasm: string; envVar: string }> = {
  kyc_registry: {
    wasm: "../../target/wasm32-unknown-unknown/release/kyc_registry.wasm",
    envVar: "VITE_KYC_REGISTRY_CONTRACT_ID",
  },
  compliance_engine: {
    wasm: "../../target/wasm32-unknown-unknown/release/compliance_engine.wasm",
    envVar: "VITE_COMPLIANCE_ENGINE_CONTRACT_ID",
  },
  invoice_token: {
    wasm: "../../target/wasm32-unknown-unknown/release/invoice_token.wasm",
    envVar: "VITE_INVOICE_TOKEN_CONTRACT_ID",
  },
  property_token: {
    wasm: "../../target/wasm32-unknown-unknown/release/property_token.wasm",
    envVar: "VITE_PROPERTY_TOKEN_CONTRACT_ID",
  },
  carbon_credit_token: {
    wasm: "../../target/wasm32-unknown-unknown/release/carbon_credit_token.wasm",
    envVar: "VITE_CARBON_TOKEN_CONTRACT_ID",
  },
  rwa_token: {
    wasm: "../../target/wasm32-unknown-unknown/release/rwa_token.wasm",
    envVar: "VITE_RWA_TOKEN_CONTRACT_ID",
  },
};

// ── Stellar CLI wrappers ──────────────────────────────────────────────────────

/**
 * Attempt to run `stellar contract bindings typescript` for a contract.
 * Returns the generated TypeScript source as a string, or null on failure.
 */
function generateBindings(contractName: string, wasmPath: string): string | null {
  const absWasm = join(__dirname, wasmPath);
  if (!existsSync(absWasm)) {
    console.warn(`  ⚠  WASM not found at ${absWasm} — skipping ${contractName}`);
    console.warn(`     Run: cargo build --release --target wasm32-unknown-unknown`);
    return null;
  }

  try {
    const result = execSync(
      `stellar contract bindings typescript --wasm "${absWasm}" --output-dir /dev/stdout`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    );
    return result;
  } catch (err) {
    console.warn(`  ⚠  stellar CLI failed for ${contractName}:`, (err as Error).message?.split("\n")[0]);
    return null;
  }
}

// ── Schema-to-TypeScript mapper ───────────────────────────────────────────────

/**
 * Minimal schema descriptor that mirrors the structure emitted by
 * `stellar contract info --output json`.
 */
interface ContractFunctionSpec {
  name: string;
  inputs: Array<{ name: string; type: string }>;
  output: string;
}

interface ContractTypeSpec {
  name: string;
  kind: "struct" | "enum" | "union";
  fields?: Array<{ name: string; type: string }>;
  variants?: Array<{ name: string; value?: number }>;
}

interface ContractSchema {
  functions: ContractFunctionSpec[];
  types: ContractTypeSpec[];
}

/** Maps a Soroban XDR type string to a TypeScript type string. */
function sorobanTypeToTs(t: string): string {
  const map: Record<string, string> = {
    "u32": "number",
    "i32": "number",
    "u64": "bigint",
    "i64": "bigint",
    "u128": "bigint",
    "i128": "bigint",
    "bool": "boolean",
    "string": "string",
    "bytes": "Uint8Array",
    "address": "string",
    "void": "void",
  };
  if (map[t]) return map[t];
  if (t.startsWith("Vec<")) {
    const inner = t.slice(4, -1);
    return `${sorobanTypeToTs(inner)}[]`;
  }
  if (t.startsWith("Option<")) {
    const inner = t.slice(7, -1);
    return `${sorobanTypeToTs(inner)} | null`;
  }
  if (t.startsWith("Map<")) {
    const [k, v] = t.slice(4, -1).split(", ");
    return `Map<${sorobanTypeToTs(k)}, ${sorobanTypeToTs(v)}>`;
  }
  // Custom struct/enum reference — emit as-is (PascalCase assumed).
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Generate a TypeScript interface/enum from a ContractTypeSpec. */
function typeSpecToTs(spec: ContractTypeSpec): string {
  if (spec.kind === "struct" && spec.fields) {
    const fields = spec.fields
      .map((f) => `  ${f.name}: ${sorobanTypeToTs(f.type)};`)
      .join("\n");
    return `export interface ${spec.name} {\n${fields}\n}`;
  }
  if (spec.kind === "enum" && spec.variants) {
    const members = spec.variants
      .map((v) => (v.value !== undefined ? `  ${v.name} = ${v.value},` : `  ${v.name},`))
      .join("\n");
    return `export enum ${spec.name} {\n${members}\n}`;
  }
  if (spec.kind === "union" && spec.variants) {
    const members = spec.variants.map((v) => `"${v.name}"`).join(" | ");
    return `export type ${spec.name} = ${members};`;
  }
  return `// Unsupported type spec: ${spec.name}`;
}

/** Generate a typed client method signature from a ContractFunctionSpec. */
function functionSpecToTs(spec: ContractFunctionSpec): string {
  const params = spec.inputs
    .map((i) => `${i.name}: ${sorobanTypeToTs(i.type)}`)
    .join(", ");
  const ret = sorobanTypeToTs(spec.output);
  return `  ${spec.name}(${params}): Promise<${ret}>;`;
}

/**
 * Build a complete generated type file from a parsed schema.
 * Falls back to an empty module when the schema has no entries.
 */
function schemaToTypeFile(contractName: string, schema: ContractSchema): string {
  const banner = [
    `/**`,
    ` * AUTO-GENERATED — do not edit manually.`,
    ` * Re-generate with: npm run codegen`,
    ` *`,
    ` * Contract: ${contractName}`,
    ` * Generated: ${new Date().toISOString()}`,
    ` *`,
    ` * Issue #433 — Auto-Generated Types from Contract Schema`,
    ` */`,
    ``,
    `// ── Contract types ───────────────────────────────────────────────────────────`,
    ``,
  ].join("\n");

  const typeDecls = schema.types.map(typeSpecToTs).join("\n\n");

  const clientInterface = [
    ``,
    `// ── Typed client interface ───────────────────────────────────────────────────`,
    ``,
    `/** Auto-generated typed interface for the ${contractName} contract. */`,
    `export interface I${toPascal(contractName)}Client {`,
    ...schema.functions.map(functionSpecToTs),
    `}`,
  ].join("\n");

  return [banner, typeDecls, clientInterface, ""].join("\n");
}

function toPascal(s: string): string {
  return s
    .split(/[_-]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

// ── Fallback: parse the existing hand-written types/index.ts ─────────────────

/**
 * When neither WASM nor CLI is available, produce a minimal generated file
 * that re-exports the existing hand-written types.  This ensures the import
 * path `types/generated/<name>` always exists.
 */
function fallbackTypeFile(contractName: string): string {
  return [
    `/**`,
    ` * AUTO-GENERATED — do not edit manually.`,
    ` * Re-generate with: npm run codegen`,
    ` *`,
    ` * Contract: ${contractName}`,
    ` * Generated: ${new Date().toISOString()} (fallback — WASM not available)`,
    ` *`,
    ` * Issue #433 — Auto-Generated Types from Contract Schema`,
    ` */`,
    ``,
    `// Re-exports hand-written types until WASM bindings are available.`,
    `export * from "../index";`,
    ``,
  ].join("\n");
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  console.log("🔧  Veritoken type codegen starting…\n");

  if (!existsSync(OUT_DIR)) {
    mkdirSync(OUT_DIR, { recursive: true });
    console.log(`  Created output directory: ${OUT_DIR}`);
  }

  const indexLines: string[] = [
    `/**`,
    ` * AUTO-GENERATED barrel — do not edit manually.`,
    ` * Re-generate with: npm run codegen`,
    ` *`,
    ` * Issue #433 — Auto-Generated Types from Contract Schema`,
    ` */`,
    ``,
  ];

  for (const [name, cfg] of Object.entries(CONTRACT_SCHEMAS)) {
    console.log(`  Processing ${name}…`);

    // Try Stellar CLI bindings first.
    const bindings = generateBindings(name, cfg.wasm);
    let content: string;

    if (bindings) {
      // CLI produced output — save as-is.
      content = bindings;
      console.log(`  ✓  Generated via stellar CLI`);
    } else {
      // Emit fallback re-export file.
      content = fallbackTypeFile(name);
      console.log(`  ℹ  Emitted fallback re-export`);
    }

    const outFile = join(OUT_DIR, `${name}.ts`);
    writeFileSync(outFile, content, "utf-8");
    indexLines.push(`export * from "./${name}";`);
  }

  // Write barrel index.
  writeFileSync(join(OUT_DIR, "index.ts"), indexLines.join("\n") + "\n", "utf-8");
  console.log(`\n✅  Codegen complete → ${OUT_DIR}/index.ts`);
}

main();
