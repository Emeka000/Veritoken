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

Exit code `0` means all checks passed. Exit code `1` means at least one check failed — run `docker compose logs` for details.

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

## Stopping the Stack

```bash
docker compose down
```

To also remove the build cache volumes (forces a full rebuild next time):

```bash
docker compose down -v
```

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
