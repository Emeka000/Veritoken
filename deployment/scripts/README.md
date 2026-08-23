# Deployment Scripts

TypeScript scripts for deploying and verifying Veritoken contracts on Stellar.

## Prerequisites

- Node.js 20+
- A funded Stellar account (secret key)
- Compiled WASM files (run `cargo build --target wasm32v1-none --release` from repo root)

## Setup

```bash
cd deployment/scripts
npm ci
```

## Scripts

### `deploy.ts` — Deploy contracts

Reads the deployment config, uploads WASMs, deploys contracts that have changed
(detected by comparing WASM hashes against an existing manifest), and writes a
manifest JSON with the new contract IDs.

**Environment variables:**

| Variable | Description |
|---|---|
| `DEPLOYER_SECRET` | Stellar secret key of the deployer account |
| `STELLAR_RPC_URL` | Soroban RPC endpoint |
| `STELLAR_NETWORK_PASSPHRASE` | Network passphrase |
| `WASM_DIR` | Directory containing compiled `*.wasm` files |
| `CONFIG_FILE` | Path to the deployment config JSON |
| `MANIFEST_OUT` | Output path for the deployment manifest JSON |

**Run against a local Docker standalone node:**

```bash
# Start the standalone node first
docker run -d -p 8000:8000 --name stellar-local stellar/quickstart:latest --standalone

# Wait for it to become healthy
until curl -s -X POST http://localhost:8000/soroban/rpc \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
  | grep -q '"status":"healthy"'; do sleep 2; done

# Build WASMs
cd ../../
cargo build --target wasm32v1-none --release
cd deployment/scripts

# Deploy
DEPLOYER_SECRET="<your-secret-key>" \
STELLAR_RPC_URL="http://localhost:8000/soroban/rpc" \
STELLAR_NETWORK_PASSPHRASE="Standalone Network ; February 2017" \
WASM_DIR="../../target/wasm32v1-none/release" \
CONFIG_FILE="../config.testnet.json" \
MANIFEST_OUT="../manifests/local-dev.json" \
npx tsx deploy.ts
```

**Run against testnet:**

```bash
DEPLOYER_SECRET="<your-testnet-secret>" \
STELLAR_RPC_URL="https://soroban-testnet.stellar.org" \
STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015" \
WASM_DIR="../../target/wasm32v1-none/release" \
CONFIG_FILE="../config.testnet.json" \
MANIFEST_OUT="../manifests/testnet-$(git rev-parse HEAD).json" \
npx tsx deploy.ts
```

---

### `check-funded.ts` — Verify deployer account balance

Checks that the deployer account exists and has at least `MIN_BALANCE_XLM` XLM
(default: 10 XLM) before attempting deployment.

**Environment variables:**

| Variable | Description | Default |
|---|---|---|
| `DEPLOYER_SECRET` | Stellar secret key | required |
| `STELLAR_RPC_URL` | Soroban RPC endpoint | required |
| `MIN_BALANCE_XLM` | Minimum required XLM balance | `10` |

**Run locally:**

```bash
DEPLOYER_SECRET="<your-secret>" \
STELLAR_RPC_URL="http://localhost:8000/soroban/rpc" \
npx tsx check-funded.ts
```

---

### `verify-manifest.ts` — Verify deployed contracts

Reads a manifest file and confirms each contract ID is live on-chain and
responds to a `name()` call.

**Environment variables:**

| Variable | Description |
|---|---|
| `MANIFEST_FILE` | Path to the manifest JSON to verify |
| `STELLAR_RPC_URL` | Soroban RPC endpoint |
| `STELLAR_NETWORK_PASSPHRASE` | Network passphrase |

**Run locally:**

```bash
MANIFEST_FILE="../manifests/testnet-abc123.json" \
STELLAR_RPC_URL="https://soroban-testnet.stellar.org" \
STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015" \
npx tsx verify-manifest.ts
```

**Against local Docker node:**

```bash
MANIFEST_FILE="../manifests/local-dev.json" \
STELLAR_RPC_URL="http://localhost:8000/soroban/rpc" \
STELLAR_NETWORK_PASSPHRASE="Standalone Network ; February 2017" \
npx tsx verify-manifest.ts
```

## Required GitHub Secrets

The CI/CD workflows require these secrets to be set in the GitHub repository:

| Secret | Description |
|---|---|
| `TESTNET_DEPLOYER_SECRET` | Stellar secret key for the testnet deployer account |
| `MAINNET_DEPLOYER_SECRET` | Stellar secret key for the mainnet deployer account |

Secrets are only used in deployment workflows that run on protected branches
(`main`/`master`) or via manual `workflow_dispatch`. PR builds from forks
never have access to these secrets.

## GitHub Environments

The deployment workflows require two [GitHub Environments](https://docs.github.com/en/actions/deployment/targeting-different-deployment-environments/using-environments-for-deployment):

- **`testnet`** — used by the `deploy-testnet.yml` workflow
- **`mainnet`** — used by the `deploy-mainnet.yml` workflow; configure required
  reviewers here to enforce the manual approval gate before mainnet deployments

## Manifest File Format

```json
{
  "schema_version": 1,
  "git_sha": "<40-char git SHA>",
  "network": "testnet",
  "deployed_at": "2024-01-01T00:00:00.000Z",
  "contracts": {
    "kyc_registry": {
      "contract_id": "C...",
      "wasm_hash": "<sha256-hex>",
      "deployed_at": "2024-01-01T00:00:00.000Z",
      "network": "testnet"
    }
  }
}
```
