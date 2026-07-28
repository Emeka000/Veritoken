#!/usr/bin/env bash
# load-env.sh — select a network-specific environment template and write
#               it to frontend/.env, with validation for missing or
#               conflicting values.
#
# Usage:
#   bash scripts/load-env.sh <network>
#
#   <network> must be one of: local | testnet | mainnet
#
# What it does:
#   1. Reads env/<network>.env
#   2. Validates that all required keys are present in the template
#   3. Warns when VITE_STELLAR_NETWORK in the template does not match the
#      requested network (guards against editing the wrong file)
#   4. Warns about empty contract ID values (normal before first deploy,
#      but flagged so the operator is aware)
#   5. Copies the template to frontend/.env
#
# Exit codes:
#   0 — env written successfully (warnings may still have been printed)
#   1 — unrecognised network, missing template, or structural validation error

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_DIR="$REPO_ROOT/env"
FRONTEND_ENV="$REPO_ROOT/frontend/.env"

# ── Required keys that every env file must declare ────────────────────────────

REQUIRED_KEYS=(
  VITE_STELLAR_NETWORK
  VITE_STELLAR_RPC_URL
  VITE_KYC_REGISTRY_ID
  VITE_COMPLIANCE_ENGINE_ID
  VITE_INVOICE_TOKEN_ID
  VITE_PROPERTY_TOKEN_ID
  VITE_CARBON_TOKEN_ID
)

# ── Helpers ───────────────────────────────────────────────────────────────────

info()  { echo "  [info]  $1"; }
warn()  { echo "  [warn]  $1"; }
error() { echo "  [ERROR] $1" >&2; }

usage() {
  echo "Usage: bash scripts/load-env.sh <network>"
  echo "       <network>: local | testnet | mainnet"
}

# ── Argument validation ───────────────────────────────────────────────────────

NETWORK="${1:-}"

if [[ -z "$NETWORK" ]]; then
  error "No network specified."
  usage
  exit 1
fi

case "$NETWORK" in
  local|testnet|mainnet) ;;
  *)
    error "Unrecognised network '$NETWORK'. Must be one of: local, testnet, mainnet."
    usage
    exit 1
    ;;
esac

TEMPLATE="$ENV_DIR/${NETWORK}.env"

if [[ ! -f "$TEMPLATE" ]]; then
  error "Template not found: $TEMPLATE"
  error "Expected file: env/${NETWORK}.env"
  exit 1
fi

echo "==> Loading environment for network: $NETWORK"
echo "    Template: $TEMPLATE"
echo ""

# ── Structural validation ─────────────────────────────────────────────────────

ERRORS=0

echo "==> Validating template..."

# 1. All required keys must be declared (value can be empty, but the key must exist)
for key in "${REQUIRED_KEYS[@]}"; do
  if ! grep -q "^${key}=" "$TEMPLATE"; then
    error "Required key '$key' is missing from $TEMPLATE"
    ERRORS=$(( ERRORS + 1 ))
  fi
done

if [[ "$ERRORS" -gt 0 ]]; then
  echo ""
  error "Template validation failed: $ERRORS structural error(s). Aborting."
  exit 1
fi

info "All required keys are declared"

# 2. Check that VITE_STELLAR_NETWORK value matches the requested network
DECLARED_NETWORK=$(grep "^VITE_STELLAR_NETWORK=" "$TEMPLATE" | cut -d= -f2 | tr -d '[:space:]')
if [[ "$DECLARED_NETWORK" != "$NETWORK" ]]; then
  warn "VITE_STELLAR_NETWORK in $TEMPLATE is '$DECLARED_NETWORK', but you requested '$NETWORK'."
  warn "Check that you are editing the correct template file."
fi

# 3. Warn about empty contract ID values
EMPTY_IDS=()
while IFS= read -r line; do
  # Skip comments and blank lines
  [[ "$line" =~ ^#   ]] && continue
  [[ -z "$line"       ]] && continue
  key="${line%%=*}"
  val="${line#*=}"
  if [[ "$key" == VITE_*_ID ]] && [[ -z "$val" ]]; then
    EMPTY_IDS+=("$key")
  fi
done < "$TEMPLATE"

if [[ "${#EMPTY_IDS[@]}" -gt 0 ]]; then
  warn "The following contract IDs are empty in the template:"
  for id in "${EMPTY_IDS[@]}"; do
    warn "  $id"
  done
  warn "This is normal before the first deploy. Fill them in after running deploy.sh."
fi

echo ""

# ── Write frontend/.env ───────────────────────────────────────────────────────

echo "==> Writing frontend/.env..."

# Back up any existing .env so operators can recover it
if [[ -f "$FRONTEND_ENV" ]]; then
  BACKUP="${FRONTEND_ENV}.bak"
  cp "$FRONTEND_ENV" "$BACKUP"
  info "Existing frontend/.env backed up to frontend/.env.bak"
fi

cp "$TEMPLATE" "$FRONTEND_ENV"
info "frontend/.env written from env/${NETWORK}.env"

echo ""
echo "Environment ready. Active network: $NETWORK"
if [[ "${#EMPTY_IDS[@]}" -gt 0 ]]; then
  echo ""
  echo "Next steps:"
  echo "  1. Run: bash scripts/deploy.sh <identity>"
  echo "  2. Contract IDs will be written to frontend/.env automatically."
  echo "  3. Or fill in the IDs manually if the contracts are already deployed."
fi
