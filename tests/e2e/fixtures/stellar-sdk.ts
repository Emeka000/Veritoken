/**
 * Re-exports @stellar/stellar-sdk from tests/integration's own install
 * rather than adding a second copy as a dependency of this package.
 *
 * tests/e2e/global-setup.ts and chain-helpers.ts call directly into
 * tests/integration/fixtures/{fixture-runner,soroban-transport,fixture-plans}.ts
 * (reusing the same deploy plans and RPC transport the integration suite
 * uses) and pass them Keypair/rpc.Server/xdr values. TypeScript treats two
 * independently-installed copies of the same package version as distinct
 * nominal types (private class fields don't structurally match across
 * them), so a second copy here would make every one of those calls a type
 * error despite being runtime-identical.
 *
 * `npm install`'s postinstall (scripts/link-stellar-sdk.mjs) symlinks
 * node_modules/@stellar/stellar-sdk to tests/integration's install, so this
 * bare specifier resolves to that exact same physical package for both
 * `tsc` and Node's ESM loader. A relative path straight into
 * "../../integration/node_modules/@stellar/stellar-sdk" looks simpler but
 * doesn't work here — Node's ESM resolver only consults a package's
 * package.json "exports" map for bare specifiers, not for an explicit
 * relative path to its directory, so that form fails at runtime with
 * "Directory import is not supported" despite typechecking fine.
 */
export * from "@stellar/stellar-sdk";
