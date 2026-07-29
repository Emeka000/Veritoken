#!/usr/bin/env bash
# Veritoken deployment compatibility entry point.
#
# Usage:
#   bash scripts/deploy.sh [identity-name]
#
# Existing operator inputs remain supported:
#   STELLAR_NETWORK, WASM_DIR, DEPLOY_CONFIG, DEPLOY_MANIFEST,
#   DEPLOY_VERIFICATION_REPORT, FRONTEND_ENV_FILE, STELLAR_BIN.
#
# Set DEPLOY_SKIP_BUILD=1 to deploy artifacts that were already built and
# validated. Set DEPLOY_RESUME=1 to continue the exact partial checkpoint
# written by an interrupted run.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IDENTITY="${1:-${STELLAR_IDENTITY:-alice}}"
NETWORK="${STELLAR_NETWORK:-testnet}"
WASM_DIR="${WASM_DIR:-target/wasm32-unknown-unknown/release}"
DEPLOY_CONFIG="${DEPLOY_CONFIG:-deployment/config.testnet.json}"
DEPLOY_MANIFEST="${DEPLOY_MANIFEST:-deploy-manifest.json}"
DEPLOY_VERIFICATION_REPORT="${DEPLOY_VERIFICATION_REPORT:-deployment-verification-report.json}"
FRONTEND_ENV_FILE="${FRONTEND_ENV_FILE:-frontend/.env}"

find_python() {
  if [[ -n "${PYTHON_BIN:-}" ]]; then
    printf '%s\n' "$PYTHON_BIN"
  elif command -v python3 >/dev/null 2>&1; then
    printf '%s\n' "python3"
  elif command -v python >/dev/null 2>&1; then
    printf '%s\n' "python"
  else
    echo "ERROR: Python 3.10 or newer is required." >&2
    exit 1
  fi
}

PYTHON_EXECUTABLE="$(find_python)"
cd "$REPO_ROOT"

if [[ "${DEPLOY_SKIP_BUILD:-0}" != "1" ]]; then
  echo "==> Building release WASM artifacts..."
  cargo build --release --target wasm32-unknown-unknown
fi

echo "==> Validating release WASM artifacts..."
WASM_DIR="$WASM_DIR" bash "$SCRIPT_DIR/verify-artifacts.sh"

ARGS=(
  "$SCRIPT_DIR/deployment_cli.py"
  deploy
  --identity "$IDENTITY"
  --network "$NETWORK"
  --wasm-dir "$WASM_DIR"
  --config "$DEPLOY_CONFIG"
  --manifest "$DEPLOY_MANIFEST"
  --report "$DEPLOY_VERIFICATION_REPORT"
  --frontend-env "$FRONTEND_ENV_FILE"
)

if [[ "${DEPLOY_RESUME:-0}" == "1" ]]; then
  ARGS+=(--resume)
fi

echo "==> Deploying and verifying contracts on $NETWORK..."
"$PYTHON_EXECUTABLE" "${ARGS[@]}"

echo ""
echo "Deployment verified."
echo "Canonical contract IDs: $DEPLOY_MANIFEST"
echo "Auditable verification report: $DEPLOY_VERIFICATION_REPORT"
