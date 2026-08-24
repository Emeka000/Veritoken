#!/usr/bin/env bash
# scripts/setup-local.sh — One-command local development environment bootstrap (#401)
#
# Usage:
#   bash scripts/setup-local.sh [--identity NAME] [--network testnet|standalone] [--deploy] [--docker]
#
# Options:
#   --identity NAME   Stellar CLI identity to create/use (default: veritoken-dev)
#   --network NAME    Target network: testnet (default) or standalone
#   --deploy          Also build and deploy contracts after setup
#   --docker          Use Docker Compose stack instead of local toolchain
#
# What this does:
#   1. Checks required tools (Rust, stellar CLI, Node.js, Python 3)
#   2. Copies env templates if not already present
#   3. Installs Node.js dependencies (root + frontend + sdk)
#   4. Creates and funds a testnet identity (or standalone via Docker)
#   5. Optionally builds and deploys contracts
#   6. Prints a summary of what to do next

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Defaults ──────────────────────────────────────────────────────────────────
IDENTITY="${VERITOKEN_IDENTITY:-veritoken-dev}"
NETWORK="${STELLAR_NETWORK:-testnet}"
DO_DEPLOY=0
USE_DOCKER=0

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --identity) IDENTITY="$2"; shift 2 ;;
    --network)  NETWORK="$2";  shift 2 ;;
    --deploy)   DO_DEPLOY=1;   shift ;;
    --docker)   USE_DOCKER=1;  shift ;;
    --help|-h)
      sed -n '2,20p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

ok()   { echo "  ✓ $*"; }
warn() { echo "  ! $*"; }
step() { echo ""; echo "==> $*"; }

# ── Docker path ───────────────────────────────────────────────────────────────
if [[ "$USE_DOCKER" == "1" ]]; then
  step "Starting Docker Compose stack"
  cd "$REPO_ROOT"
  [[ -f .env.docker ]] || { cp .env.docker.example .env.docker; warn "Created .env.docker from template — edit secrets if needed"; }
  docker compose --env-file .env.docker up --build -d
  step "Waiting for stack to be ready"
  bash "$SCRIPT_DIR/docker-health.sh"
  echo ""
  echo "Docker stack is running. Frontend: http://localhost:5173"
  exit 0
fi

# ── Prerequisite checks ───────────────────────────────────────────────────────
step "Checking prerequisites"

check_tool() {
  local name="$1" cmd="$2" hint="$3"
  if command -v "$cmd" >/dev/null 2>&1; then
    ok "$name: $(command -v "$cmd")"
  else
    echo "  ✗ $name not found. $hint" >&2
    MISSING=1
  fi
}

MISSING=0
check_tool "Rust / cargo"  cargo   "Install from https://rustup.rs"
check_tool "stellar CLI"   stellar "Install from https://developers.stellar.org/docs/tools/stellar-cli"
check_tool "Node.js"       node    "Install from https://nodejs.org (>=20 required)"
check_tool "Python 3"      python3 "Install from https://python.org"

if [[ "$MISSING" == "1" ]]; then
  echo ""
  echo "ERROR: One or more required tools are missing. Install them and re-run." >&2
  exit 1
fi

# Verify wasm32v1-none target (matches rust-toolchain.toml)
if rustup target list --installed 2>/dev/null | grep -q "wasm32v1-none"; then
  ok "wasm32v1-none target installed"
else
  step "Adding wasm32v1-none Rust target"
  rustup target add wasm32v1-none
fi

# ── Env file setup ────────────────────────────────────────────────────────────
step "Setting up environment files"

cd "$REPO_ROOT"

if [[ ! -f frontend/.env ]]; then
  cp frontend/.env.example frontend/.env
  warn "Created frontend/.env from template — fill in contract IDs after deploy"
else
  ok "frontend/.env already exists"
fi

# ── Node.js dependencies ──────────────────────────────────────────────────────
step "Installing Node.js dependencies"
npm install --silent
ok "Root + workspace dependencies installed"

# ── Stellar identity ──────────────────────────────────────────────────────────
step "Setting up Stellar identity: $IDENTITY (network: $NETWORK)"
bash "$SCRIPT_DIR/setup-identity.sh" "$IDENTITY"

# ── Optional deploy ───────────────────────────────────────────────────────────
if [[ "$DO_DEPLOY" == "1" ]]; then
  step "Building and deploying contracts to $NETWORK"
  STELLAR_NETWORK="$NETWORK" bash "$SCRIPT_DIR/deploy.sh" "$IDENTITY"
fi

# ── Smoke check ───────────────────────────────────────────────────────────────
step "Smoke check"
if cargo check --target wasm32v1-none --quiet 2>/dev/null; then
  ok "cargo check passed"
else
  warn "cargo check reported issues — run 'cargo check --target wasm32v1-none' for details"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Veritoken local environment ready"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo " Identity : $IDENTITY  (network: $NETWORK)"
echo ""
echo " Next steps:"
if [[ "$DO_DEPLOY" == "0" ]]; then
  echo "   Deploy contracts : bash scripts/deploy.sh $IDENTITY"
fi
echo "   Start frontend   : cd frontend && npm run dev"
echo "   Run tests        : cargo test --features testutils"
echo "   SDK tests        : npm run --workspace sdk test"
echo ""
echo " Tip: re-run with --deploy to build and deploy in one step."
echo "      re-run with --docker to use the containerised stack instead."
echo ""
