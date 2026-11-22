# Docker Local Environment

The Veritoken Docker environment gives every developer and CI runner an identical local stack: a Stellar standalone node, the Rust/WASM contract toolchain, and the Vite frontend dev server — all wired together with a single `docker compose up`.

---

## Prerequisites

- [Docker Desktop](https://docs.docker.com/get-docker/) ≥ 24 (or Docker Engine + Compose v2)
- No other prerequisites — Rust, Node.js, and the Stellar CLI are all provided inside the container.

---

## Quick Start

```bash
# 1. Copy the example environment file and fill in any values you need.
#    For local standalone work the defaults are fine; leave secrets blank.
cp .env.docker.example .env.docker

# 2. Start the full stack (Stellar node + contracts toolchain + frontend).
docker compose --env-file .env.docker up --build

# 3. In a second terminal, confirm everything is healthy.
bash scripts/docker-health.sh
```

The frontend is available at **http://localhost:5173**.
The Stellar Soroban RPC is at **http://localhost:8000/soroban/rpc**.

---

## Services

| Service | Purpose | Port |
|---|---|---|
| `stellar` | Stellar standalone node with Soroban RPC | 8000 |
| `contracts` | Rust + WASM toolchain for building and deploying contracts | — |
| `frontend` | Vite dev server with hot-reload | 5173 |

The `contracts` service depends on `stellar` being healthy before it starts.
The `frontend` service also waits for `stellar` to be healthy.

---

## Building and Deploying Contracts

Open a shell in the contracts container:

```bash
docker compose exec contracts bash
```

Then run the normal scripts:

```bash
# Create and fund a local identity
bash scripts/setup-identity.sh veritoken-dev

# Build and deploy all contracts; writes contract IDs to frontend/.env
bash scripts/deploy.sh veritoken-dev
```

After deploy, the contract IDs are written to `frontend/.env` on your host
(the source directory is bind-mounted into the container).
The frontend dev server picks them up automatically via hot-reload.

---

## Running Tests

```bash
docker compose exec contracts cargo test --features testutils
```

---

## Health Check

```bash
bash scripts/docker-health.sh
```

The script checks:
1. Stellar Soroban RPC endpoint responds at `localhost:8000`
2. The `contracts` container is running and `cargo check` passes
3. The Vite dev server responds at `localhost:5173`

Exit code `0` means all checks passed. Exit code `1` means at least one check
failed — the summary names each unmet prerequisite so you know which service to
investigate, and you can run `docker compose logs` for details.

To validate the failure path without Docker (for example on a fresh clone or
in CI), run:

```bash
bash scripts/docker-health.sh --self-test
```

This simulates one unhealthy service and exits `0` only when the script
correctly reports it as not ready.

---

## Environment Variables

Copy `.env.docker.example` to `.env.docker` and edit as needed.
Do **not** commit `.env.docker` — it may contain secrets.

Key variables:

| Variable | Default | Description |
|---|---|---|
| `STELLAR_NETWORK` | `standalone` | Network the node runs on |
| `STELLAR_RPC_URL` | `http://stellar:8000/soroban/rpc` | RPC URL used inside the containers |
| `ADMIN_SECRET_KEY` | *(empty)* | Admin account secret key for deploy scripts |
| `VITE_KYC_REGISTRY_ID` | *(empty)* | Populated by `deploy.sh` |
| `VITE_COMPLIANCE_ENGINE_ID` | *(empty)* | Populated by `deploy.sh` |
| `VITE_INVOICE_TOKEN_ID` | *(empty)* | Populated by `deploy.sh` |
| `VITE_PROPERTY_TOKEN_ID` | *(empty)* | Populated by `deploy.sh` |
| `VITE_CARBON_TOKEN_ID` | *(empty)* | Populated by `deploy.sh` |

For secret handling guidance, see [docs/secret-safe-deployment.md](secret-safe-deployment.md).

---

## Event Indexer Stack

The event indexer runs from its own compose file, `docker-compose.indexer.yml`,
separate from the main development stack. It starts three services:

| Service | Purpose | Port | Health signal |
|---|---|---|---|
| `postgres` | PostgreSQL 16 database for indexed events | 5432 | `pg_isready -U veritoken -d veritoken_indexer` |
| `stellar` | Stellar standalone node with Soroban RPC | 8000 | `curl -sf http://localhost:8000/soroban/rpc` |
| `indexer` | Event indexer service and REST API | 3001 | `wget -qO- http://localhost:3001/health` |

`indexer` only starts after both `postgres` and `stellar` report `healthy`.

> The indexer stack and the main stack both bind host port 8000 for `stellar`.
> Stop one before starting the other, or change the host port mapping.

### Start the indexer

```bash
# Optional: contracts to index, as comma-separated label:contractId pairs.
# Leave unset to start the service with no pollers.
export CONTRACT_IDS="rwa:<RWA_TOKEN_ID>,kyc:<KYC_REGISTRY_ID>"

docker compose -f docker-compose.indexer.yml up --build -d
```

No secrets are required for local use. The database credentials
(`veritoken` / `veritoken`) are fixed local-only values defined in the compose file.

### Environment variables

All variables are set in `docker-compose.indexer.yml`; only `CONTRACT_IDS` is
read from the host shell.

| Variable | Compose value | Required | Notes |
|---|---|---|---|
| `DATABASE_URL` | `postgres://veritoken:veritoken@postgres:5432/veritoken_indexer` | Yes | Standard `PG*` variables are also honoured |
| `RPC_URL` | `http://stellar:8000/soroban/rpc` | Yes | Falls back to `STELLAR_RPC_URL`; startup fails if both are blank |
| `STELLAR_NETWORK` | `standalone` | No | Only used to pick a passphrase when `NETWORK_PASSPHRASE` is unset (`mainnet` or testnet) |
| `NETWORK_PASSPHRASE` | `Standalone Network ; February 2017` | No | Overrides `STELLAR_NETWORK` |
| `POLL_INTERVAL_MS` | `5000` | No | Must be a positive integer |
| `PORT` | `3001` | No | Must be between 1 and 65535 |
| `CONTRACT_IDS` | `${CONTRACT_IDS:-}` | No | `label:contractId` pairs; duplicate labels or IDs abort startup |

### Startup sequence

On start the indexer:

1. Loads and validates configuration. Invalid values exit the process with
   `[indexer] Fatal startup error: ...`, and compose restarts it (`restart: unless-stopped`).
2. Runs database migrations from `migrations/`.
3. Starts one poller per entry in `CONTRACT_IDS`. If none are configured it logs
   `No contracts configured — set CONTRACT_IDS env var` and keeps running.
4. Starts the REST API and logs `REST API listening on port 3001`.

### Confirm it is healthy

```bash
# All three services should show "(healthy)".
docker compose -f docker-compose.indexer.yml ps

# Startup log for the indexer.
docker compose -f docker-compose.indexer.yml logs indexer

# Health endpoint.
curl -s http://localhost:3001/health
```

A healthy indexer returns HTTP `200`:

```json
{ "status": "ok", "lag_seconds": 0, "cursors": {} }
```

- `cursors` maps each contract ID to its last processed paging token and stays
  empty until events are indexed.
- `lag_seconds` is a coarse estimate: `60` for a poller that has not processed a
  ledger yet, `30` once it has, and `0` when no contracts are configured.
- If the database cannot be reached, `/health` returns HTTP `503` with
  `{ "status": "error", "error": "..." }`.

The indexer is not covered by `scripts/docker-health.sh`; use the commands above.

### Stop the indexer

```bash
docker compose -f docker-compose.indexer.yml down      # keep indexed data
docker compose -f docker-compose.indexer.yml down -v   # also drop the postgres-data volume
```

---

## Stopping the Stack

Stopping and resetting are different operations. Read the table before running a cleanup command.

| Command | Containers | `cargo-cache` / `node-modules` volumes | Local Stellar ledger | Use when |
|---|---|---|---|---|
| `docker compose stop` | Stopped, kept | Kept | Kept | You want to pause and resume the same stack |
| `docker compose down` | Removed | Kept | **Reset** | You want a clean shutdown; expect to redeploy |
| `docker compose down -v` | Removed | **Removed** (slower next build) | **Reset** | You want a full rebuild of caches as well |

Points to note:

- The `stellar` service has no volume. Its ledger lives inside its container, so `docker compose down` resets the local chain even without `-v`. Only `docker compose stop` followed by `docker compose start` keeps it.
- After any reset, deploy again with `scripts/deploy.sh`. The contract IDs in `frontend/.env` and `.env.docker` refer to the old ledger and will no longer work.
- `down -v` does not delete any data that is not already reset by `down`. It only adds the removal of the two cache volumes.
- Do not run `down -v` on the indexer stack unless you intend to drop its database. See [Stop the indexer](#stop-the-indexer).

Stop the stack without resetting it:

```bash
docker compose stop
```

Shut down cleanly (the local chain resets):

```bash
docker compose down
```

Remove the build caches as well (forces a full rebuild on the next start):

```bash
docker compose down -v
```

After any of these, run the [Health Check](#health-check) before you start work again.

---

## CI Usage

The same Docker images are usable in CI. The GitHub Actions workflow (`ci.yml`) does not use Docker today — it installs toolchains directly for speed. If you want a fully containerised CI, replace the `rust` and `frontend` jobs with:

```yaml
services:
  stellar:
    image: stellar/quickstart:latest
    options: --health-cmd "curl -sf http://localhost:8000/soroban/rpc"

container:
  image: veritoken-dev  # built from Dockerfile
```

---

## Troubleshooting

**`stellar` container exits immediately**
Check `docker compose logs stellar`. The quickstart image requires a healthy Docker networking environment. If port 8000 is already in use, change the host port in `docker-compose.yml`.

**`contracts` container fails `cargo check`**
The Rust source has a compile error. Run `docker compose exec contracts bash` and `cargo check --target wasm32-unknown-unknown` to see the full error.

**Frontend shows blank contract IDs**
Run `bash scripts/deploy.sh` inside the contracts container first to populate `frontend/.env`.

**Permission errors on mounted volumes**
On Linux the bind mount uses UID 1000 by default. If your host user has a different UID, add `user: "${UID}:${GID}"` under the relevant service in `docker-compose.yml`.

## Checking environment example completeness

The standard-library test in `scripts/deployment/tests/test_examples.py` checks
that `.env.docker.example` defines every interpolation variable referenced by
root compose files, including the optional indexer `CONTRACT_IDS` variable. It
checks names only, so blank placeholders are sufficient. It does not read
`.env.docker`, resolve credentials, or start Docker. The deployment automation
workflow runs it whenever compose files or the example change.

To run the existing offline suite from the repository root:

```bash
PYTHONPATH=scripts python -m unittest discover -s scripts/deployment/tests -v
```

This suite also loads `deployment/config.testnet.json` through the deployment
parser without resolving its identity or artifact placeholders. The compose
check is a lightweight interpolation scan, not a full YAML parser; revisit it
if compose configuration begins using more complex YAML quoting.
