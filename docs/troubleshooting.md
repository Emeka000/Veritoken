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
7. [Frontend and Wallet](#7-frontend-and-wallet)
8. [CI Failures](#8-ci-failures)

---

## 1. Environment Setup

### Missing `wasm32-unknown-unknown` target

**Symptom**
```
error[E0463]: can't find crate for `std`
   = note: the `wasm32-unknown-unknown` target may not be installed
```

**Fix**
```bash
rustup target add wasm32-unknown-unknown
```

Verify the target is present:
```bash
rustup target list --installed | grep wasm32
```

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
stellar contract optimize --wasm target/wasm32-unknown-unknown/release/<contract>.wasm
```

Check the resulting sizes:
```bash
ls -lh target/wasm32-unknown-unknown/release/*.wasm
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
`target/wasm32-unknown-unknown/release/` does not contain the expected `.wasm`
file after `cargo build`.

**Fix**
Build against the correct target and profile:
```bash
cargo build --release --target wasm32-unknown-unknown
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

### `deploy.sh` fails mid-way, leaving `frontend/.env` incomplete

**Symptom**
The script exits after one or two contracts. `frontend/.env` is absent or has
empty values.

**Fix**
The script uses `set -euo pipefail` and stops at the first error. Fix the
underlying error and re-run the full script. Each run creates new contract
instances; old testnet instances are simply abandoned.

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

## 7. Frontend and Wallet

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

## 8. CI Failures

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
