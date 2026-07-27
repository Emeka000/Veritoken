#!/usr/bin/env bash
# Pause all transfers on the compliance engine.
# Usage: bash scripts/admin/pause.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../../frontend/.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a; source "$ENV_FILE"; set +a
fi

NETWORK="${VITE_STELLAR_NETWORK:-testnet}"
IDENTITY="${ADMIN_IDENTITY:-alice}"

echo "==> Pausing compliance engine..."
stellar contract invoke \
  --id "$VITE_COMPLIANCE_ENGINE_ID" \
  --network "$NETWORK" \
  --source-account "$IDENTITY" \
  -- pause

echo "Done. All transfers are now halted."
