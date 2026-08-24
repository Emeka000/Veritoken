#!/usr/bin/env node
/**
 * postinstall: symlinks node_modules/@stellar/stellar-sdk to
 * tests/integration's install instead of adding a second copy as a direct
 * dependency of this package. See fixtures/stellar-sdk.ts and the README's
 * "Why a separate @stellar/stellar-sdk import" section for why — in short,
 * two independently-installed copies of the same package are two distinct
 * types as far as TypeScript is concerned, and this package passes
 * SDK values (Keypair, rpc.Server, xdr.ScVal) directly into
 * tests/integration/fixtures/*.ts functions.
 */
import { existsSync, mkdirSync, symlinkSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, "..", "..", "integration", "node_modules", "@stellar", "stellar-sdk");
const linkDir = join(here, "..", "node_modules", "@stellar");
const link = join(linkDir, "stellar-sdk");

if (!existsSync(target)) {
  console.error(
    `[link-stellar-sdk] ${target} does not exist.\n` +
      "Run `npm ci` in tests/integration first — tests/e2e reuses that install " +
      "instead of adding a second copy of @stellar/stellar-sdk (see README.md).",
  );
  process.exit(1);
}

mkdirSync(linkDir, { recursive: true });
if (existsSync(link)) rmSync(link, { recursive: true, force: true });
symlinkSync(target, link, "dir");
console.log(`[link-stellar-sdk] linked node_modules/@stellar/stellar-sdk -> ${target}`);
