# Troubleshooting Guide

This guide covers the most common problems contributors and operators run into
when working with Veritoken — from initial setup through contract deployment and
frontend development. Each entry lists the symptom, the likely cause, and the
concrete fix.

---

## Table of Contents

1. [Environment Setup](#1-environment-setup)
2. [Rust and Cargo](#2-rust-and-cargo)
3. [Contract Build and WASM](#3-contract-build-and-wasm)
4. [Stellar CLI and Deployment](#4-stellar-cli-and-deployment)
5. [Testnet Identity and Funding](#5-testnet-identity-and-funding)
6. [Contract Invocation Errors](#6-contract-invocation-errors)
7. [Reading Contract Error Messages](#7-reading-contract-error-messages)
8. [Frontend and Wallet](#8-frontend-and-wallet)
9. [CI Failures](#9-ci-failures)

---

## 1. Environment Setup

### Missing `wasm32v1-none` target

**Symptom**
```
error[E0463]: can't find crate for `core`
   = note: the `wasm32v1-none` target may not be installed
```

**Fix**
```bash
rustup target add wasm32v1-none
```

Verify the target is present:
```bash
rustup target list --installed | grep wasm32v1-none
```

---

### WASM target name mismatch (`wasm32v1-none` vs `wasm32-unknown-unknown`)

**Symptom**
Contracts build, but `scripts/check-wasm-size.sh`, `scripts/verify-artifacts.sh`
or `scripts/deploy.sh` report that `target/wasm32v1-none/release` is missing,
or CI fails while your local build succeeded.

**Cause**
The project targets `wasm32v1-none`. Older documentation and Soroban tutorials
use `wasm32-unknown-unknown`, which writes artifacts to
`target/wasm32-unknown-unknown/release/` — a directory none of the repository
scripts read.

**Which target is used where**

| Context | Target | Source of truth |
|---|---|---|
| Local builds | `wasm32v1-none` | `rust-toolchain.toml` (`targets = ["wasm32v1-none"]`) |
| CI (`ci.yml`, `build.yml`, `release.yml`, deploy/e2e/integration workflows) | `wasm32v1-none` | `dtolnay/rust-toolchain` step with `targets: wasm32v1-none` |
| Scripts (`check-wasm-size.sh`, `verify-artifacts.sh`, `deploy.sh`) | `wasm32v1-none` | default `WASM_DIR=target/wasm32v1-none/release` |

**Fix — local setup**
```bash
rustup target add wasm32v1-none
cargo build --release --target wasm32v1-none
ls target/wasm32v1-none/release/*.wasm
```

**Fix — matching CI locally**
CI installs the target through the toolchain action and then runs:
```bash
cargo build --release --target wasm32v1-none \
  --workspace \
  --exclude integration-tests \
  --exclude fuzz-tests \
  --exclude smoke-tests \
  --exclude dividend-regression-tests
WASM_DIR=target/wasm32v1-none/release bash scripts/verify-artifacts.sh
```

Do not change `rust-toolchain.toml` to work around the mismatch; update the
command you are running instead.

---

### Wrong Rust toolchain version

**Symptom**
Build fails with feature-gate errors or the wrong edition is inferred.

**Fix**
The project pins its toolchain in `rust-toolchain.toml`. Running any `cargo`
command inside the repo automatically installs the correct toolchain via
`rustup`. If that does not happen:
```bash
rustup show      # prints the active toolchain
rustup update
```

---

### Stellar CLI not found

**Symptom**
```
command not found: stellar
```

**Fix**
Install the Stellar CLI following the
[official instructions](https://developers.stellar.org/docs/tools/developer-tools/cli/stellar-cli).
On most systems:
```bash
cargo install --locked stellar-cli --features opt
```

After installation, confirm it is on your `PATH`:
```bash
stellar --version
```

---

### Node.js version is too old

**Symptom**
`npm install` or `npm run dev` fails with a syntax error or a
peer-dependency mismatch.

**Fix**
Veritoken requires Node.js ≥ 20. Check your current version:
```bash
node --version
```

Use [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm)
to install Node 20:
```bash
nvm install 20 && nvm use 20
```

---

## 2. Rust and Cargo

### `cargo check` succeeds but `cargo test` panics

**Symptom**
Tests compile but fail at runtime with `PanicError` or `HostError`.

**Likely cause**
The `testutils` feature flag is not set. Soroban test utilities are gated
behind this flag.

**Fix**
```bash
cargo test --features testutils
```

---

### Clippy warnings treated as errors

**Symptom**
CI fails on `cargo clippy` but the build works locally.

**Fix**
Run clippy locally with the same flags CI uses:
```bash
cargo clippy --all-targets --all-features -- -D warnings
```

Address every warning before pushing. Common Soroban-specific warnings:

- `clippy::unwrap_used` — replace `.unwrap()` with `panic_with_error!` or a
  proper `Result` handler
- Unused imports in `#[cfg(test)]` blocks — guard them with `#[cfg(test)]` or
  remove them

---

### `cargo fmt` diff in CI

**Symptom**
CI `cargo fmt` step fails even though the code looks formatted locally.

**Fix**
The project uses a custom `rustfmt.toml`. Run the formatter before pushing:
```bash
cargo fmt --all
```

Commit the result. Do not run `rustfmt` from an editor plugin that ignores
`rustfmt.toml`.

---

## 3. Contract Build and WASM

### WASM binary exceeds the size limit

**Symptom**
CI `Check WASM sizes` step reports `❌ EXCEEDS LIMIT` (threshold: 128 KB).

**Likely causes**
- A new dependency pulls in large stdlib components.
- `opt-level` or `lto` settings were inadvertently changed.

**Fix**
Confirm the release profile in the workspace `Cargo.toml`:
```toml
[profile.release]
opt-level = "z"
lto = true
codegen-units = 1
```

Then optimize the specific binary:
```bash
stellar contract optimize --wasm target/wasm32v1-none/release/<contract>.wasm
```

Check the resulting sizes:
```bash
ls -lh target/wasm32v1-none/release/*.wasm
```

---

### `wasm32` build fails with `std` symbol errors

**Symptom**
```
error: cannot find macro `println` in this scope
```
or linker errors referencing `std::` symbols.

**Likely cause**
A dependency does not support `no_std`, or `#![no_std]` was accidentally
removed from a contract crate root.

**Fix**
Every contract `src/lib.rs` must start with:
```rust
#![no_std]
```

Check that newly added dependencies declare `default-features = false`.

---

### Build succeeds but WASM output is missing

**Symptom**
`target/wasm32v1-none/release/` does not contain the expected `.wasm`
file after `cargo build`.

**Fix**
Build against the correct target and profile:
```bash
cargo build --release --target wasm32v1-none
```

The output filename is derived from the crate `[package] name` with hyphens
replaced by underscores (e.g. `invoice-token` → `invoice_token.wasm`).

---

## 4. Stellar CLI and Deployment

### `deploy.sh` fails with `identity not found`

**Symptom**
```
error: identity 'alice' not found
```

**Fix**
Create the identity first:
```bash
bash scripts/setup-identity.sh veritoken-dev
bash scripts/deploy.sh veritoken-dev
```

---

### `deploy.sh` stops after an upload, deployment, or initializer

**Symptom**
The script exits after one or more remote operations and reports an incomplete
checkpoint at `deploy-manifest.partial.json`.

**Fix**
Inspect the reported error and checkpoint, fix the underlying problem, then
resume the exact run:

```bash
DEPLOY_RESUME=1 bash scripts/deploy.sh veritoken-dev
```

The resume path requires the same identity, network, config hash, and artifacts.
It verifies any already-deployed code hash before continuing and does not
redeploy completed stages. The previous canonical `deploy-manifest.json` and
`frontend/.env` remain unchanged until the new deployment passes every
verification check.

---

### `stellar contract deploy` returns `InsufficientFunds`

**Symptom**
```
error: transaction submission failed: insufficient funds
```

**Fix**
Re-fund your testnet account via Friendbot:
```bash
curl "https://friendbot.stellar.org?addr=$(stellar keys address veritoken-dev)"
```

Each contract deployment costs roughly 1–2 XLM in fees plus ledger entry
reserves. Friendbot dispenses 10,000 XLM — enough for multiple deployments.

---

### `contract deploy` times out or returns `TxTooLate`

**Symptom**
The CLI hangs or prints `TxTooLate` / `bad sequence`.

**Fix**
Retry the command. If it fails repeatedly, check the network status at
[https://status.stellar.org](https://status.stellar.org). You can also try a
different RPC endpoint:
```bash
export STELLAR_RPC_URL=https://soroban-testnet.stellar.org
bash scripts/deploy.sh veritoken-dev
```

---

### Constructor args rejected — `unexpected argument '--admin'`

**Symptom**
```
error: unexpected argument '--admin'
```

**Fix**
Upgrade the Stellar CLI to the latest version:
```bash
cargo install --locked stellar-cli --features opt
```

The `--` separator that passes constructor arguments requires a recent CLI
version. Verify with `stellar --version`.

---

## 5. Testnet Identity and Funding

### `stellar keys address` returns nothing

**Symptom**
The command exits without output.

**Fix**
The key does not exist yet. Generate it:
```bash
stellar keys generate --network testnet veritoken-dev
stellar keys address veritoken-dev
```

---

### Friendbot returns `{"status": 400}`

**Likely cause**
The account already has a balance, or the Friendbot service is temporarily
rate-limiting your IP.

**Fix**
Check the current balance first:
```bash
stellar account info --network testnet --source veritoken-dev
```

If the account already has XLM, no additional funding is needed. If you hit a
rate limit, wait a few minutes and retry.

---

## 6. Contract Invocation Errors

### `KycNotApproved` (error code 2) on `transfer`

**Cause**
Both the sender and receiver must have an active, non-expired KYC record
before any transfer is allowed.

**Fix**
Approve both addresses using the admin script:
```bash
bash scripts/admin/approve-kyc.sh <VERIFIER_IDENTITY> <HOLDER_ADDRESS>
```

Or invoke the registry directly:
```bash
stellar contract invoke \
  --source-account <VERIFIER_IDENTITY> \
  --network testnet \
  --id "$VITE_KYC_REGISTRY_ID" \
  -- approve \
  --verifier "$(stellar keys address <VERIFIER_IDENTITY>)" \
  --addr "<HOLDER_ADDRESS>" \
  --tier 1 \
  --expiry 0 \
  --jurisdiction "US"
```

Check an address's current KYC status:
```bash
bash scripts/admin/check-kyc.sh <ADDRESS>
```

---

### `TransferBlocked` (error code 3) on `transfer`

**Possible causes and fixes**

| Cause | How to confirm | Fix |
|---|---|---|
| Contract is paused | `stellar contract invoke --id $CE_ID -- get_rules` → `paused: true` | `bash scripts/admin/unpause.sh` |
| Address is on the blocklist | `stellar contract invoke --id $CE_ID -- is_blocklisted --addr <ADDR>` | `bash scripts/admin/remove-blocklist.sh <ADDR>` |
| Amount exceeds `max_transfer_amount` | Check `get_rules` output | Reduce the amount or update the rule |
| Holding period not met | Check `min_holding_period` in `get_rules` | Wait, or set to `0` on testnet |
| `max_holders` reached | Compare `holder_count` vs `max_holders` in `get_rules` | Increase the limit via `set_rules` |
| Tier policy blocks the pair | `stellar contract invoke --id $CE_ID -- get_tier_policy --from-tier N --to-tier M` | Update or remove the policy |

---

### `NotVerifier` (error code 2 on KYC registry) when calling `approve`

**Cause**
The signing address has not been registered as a verifier.

**Fix**
```bash
bash scripts/admin/add-verifier.sh <VERIFIER_ADDRESS>
```

---

### `NoRecord` when reading KYC status

**Cause**
The address has never had a KYC record submitted — it is entirely absent, not
merely unapproved.

**Fix**
Submit an `approve` or `reject` call for the address to create an initial
record:
```bash
stellar contract invoke \
  --source-account <VERIFIER_IDENTITY> \
  --network testnet \
  --id "$VITE_KYC_REGISTRY_ID" \
  -- approve \
  --verifier "$(stellar keys address <VERIFIER_IDENTITY>)" \
  --addr "<HOLDER_ADDRESS>" \
  --tier 1 \
  --expiry 0 \
  --jurisdiction "US"
```

---

## 7. Reading Contract Error Messages

Contract failures surface in three layers. Work through them in order: find the
numeric code, decode it with the SDK helpers, then confirm the original
transaction or simulation failure.

### 7.1 Find the error code in the contract API reference

Every contract returns a numeric error code. The canonical tables live in
[`docs/contract-api-reference.md`](./contract-api-reference.md):

- [KYC Registry error table](./contract-api-reference.md#kyc-registry-errors)
- [Compliance Engine error table](./contract-api-reference.md#compliance-engine-errors)
- [RWA Token error table](./contract-api-reference.md#rwa-token-errors)
- [Invoice Token error table](./contract-api-reference.md#invoice-token-errors)

Look up the contract that failed, then match the number to its variant name and
description. The numeric code is the stable identifier — the human-readable
message is not.

### 7.2 Interpret the SDK error helpers

The SDK exposes three helpers in [`sdk/src/errors.ts`](../sdk/src/errors.ts):

| Helper | Purpose |
|---|---|
| `lookupError(contract, code)` | Returns the error definition (name, message, docs) for a numeric code, or `undefined` if the code is unknown. |
| `parseContractError(contract, rawError)` | Extracts the numeric code from a raw Soroban string matching `Error(Contract, #N)` and returns the corresponding definition. |
| `formatContractError(contract, err)` | Produces a user-facing message from either a raw string or a thrown error, falling back to a generic message when the code is unknown. |

The frontend re-exports the same helpers from
[`frontend/src/lib/contractErrors.ts`](../frontend/src/lib/contractErrors.ts),
so the UI and the SDK decode errors identically. If you add a new contract
error, update the table in `docs/contract-api-reference.md` and the definitions
consumed by `sdk/src/errors.ts` together.

### 7.3 Identify the original transaction or simulation failure

Before formatting, capture the raw failure:

- **Simulation failures** — `stellar contract invoke` prints the raw host error,
  e.g. `HostError: Error(Contract, #2)`. The same string appears in the
  `error` field of an RPC `simulateTransaction` response.
- **Transaction failures** — query the transaction result with
  `stellar contract invoke --is-view` or inspect the `resultMetaXdr` of the
  submitted transaction. The contract error code is embedded in the diagnostic
  events.

Pass the raw string to `parseContractError` (or `formatContractError`) to
resolve it to a named error.

### 7.4 Worked example: `Error(Contract, #2)` on the KYC registry

1. **Contract layer** — the KYC registry returns code `2`. The
   [KYC Registry error table](./contract-api-reference.md#kyc-registry-errors)
   maps `2` to `NotVerifier`: the signing address is not a registered verifier.
2. **SDK layer** — `parseContractError("kyc", "Error(Contract, #2)")` returns
   the `NotVerifier` definition. `formatContractError("kyc", err)` renders the
   user-facing message for that definition.
3. **Transaction layer** — the original simulation or transaction result
   contains `Error(Contract, #2)`; the fix is to register the verifier with
   `bash scripts/admin/add-verifier.sh <VERIFIER_ADDRESS>` (see
   [§6](#6-contract-invocation-errors)).

### 7.5 Provider messages can differ

Different RPC providers may wrap or reword the error text — some return
`Error(Contract, #2)`, others include extra diagnostic context or a different
prefix. The underlying failure and the numeric code are the same. Always
resolve errors by the numeric code via `lookupError` / `parseContractError`
rather than matching on message text.

---

## 8. Frontend and Wallet

### `.env` variables are missing or undefined at runtime

**Symptom**
The dashboard shows empty contract IDs or API calls fail with
`invalid contract ID`.

**Fix**
1. Copy the example file: `cp frontend/.env.example frontend/.env`
2. After a successful `deploy.sh` run, contract IDs are written to
   `frontend/.env` automatically.
3. If you deployed manually, paste your contract IDs into `frontend/.env`.
4. Restart the dev server after editing `.env` — Vite does not hot-reload
   environment files.

---

### Freighter wallet not detected

**Symptom**
"Connect Wallet" does nothing, or the UI shows `Wallet not detected`.

**Fix**
1. Install the [Freighter browser extension](https://freighter.app).
2. Set Freighter to **Testnet** (Settings → Network → Testnet).
3. Reload the page after switching networks.
4. In Chromium-based browsers, allow the extension to run in incognito mode if
   testing there.

---

### Wallet connected but transactions do not sign

**Symptom**
Freighter opens the signing popup but returns `User declined`, or the popup
does not appear.

**Fix**
- Confirm Freighter is unlocked.
- Confirm the active Freighter account has XLM for fees.
- If the popup does not appear, allow popups from `localhost` in your browser
  settings.

---

### `Cannot find module '@stellar/stellar-sdk'`

**Symptom**
`npm run build` exits with a missing module error.

**Fix**
```bash
cd frontend
npm install
```

If the error persists, clear and reinstall:
```bash
rm -rf node_modules package-lock.json
npm install
```

---

### `VITE_*` env var is `undefined` in the browser

**Fix**
All variables exposed to Vite must be prefixed with `VITE_`. Check
`frontend/.env` and confirm names match those used in
`frontend/src/lib/contractFactory.ts`. Restart the dev server after any edit
to `.env`.

---

### CORS errors when querying the Stellar RPC

**Symptom**
Browser console shows `Cross-Origin Request Blocked` for calls to
`soroban-testnet.stellar.org`.

**Fix**
Add a proxy rule to `frontend/vite.config.ts`:
```ts
server: {
  proxy: {
    "/rpc": {
      target: "https://soroban-testnet.stellar.org",
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/rpc/, ""),
    },
  },
},
```

Then update the RPC URL in `frontend/src/lib/stellar.ts` to `/rpc`.

---

## 9. CI Failures

### CI fails on `working-directory: Veritoken` but passes locally

**Cause**
CI checks out the repository into a subdirectory named after the repo. Local
runs happen directly from the repo root. This is expected — no action needed
on your part.

---

### `cargo fmt --check` fails in CI despite formatting locally

**Fix**
Run the formatter with `--all` to cover every workspace member:
```bash
cargo fmt --all
git diff   # should be empty
```

---

### Frontend `npm test` fails in CI but passes locally

**Cause**
CI runs `npm ci` (not `npm install`) — a clean install from the lockfile. If
you added a dependency locally without committing the updated
`package-lock.json`, CI will not have it.

**Fix**
```bash
cd frontend
npm install
git add package.json package-lock.json
git commit -m "chore: update frontend dependencies"
```

---

## Still stuck?

Open an [issue on GitHub](https://github.com/abore9769/Veritoken/issues) with:

- The exact command you ran
- The full error output
- Your OS, Rust version (`rustc --version`), and Stellar CLI version
  (`stellar --version`)

For security-sensitive issues follow the [Security Policy](../SECURITY.md) and
do not open a public issue.
