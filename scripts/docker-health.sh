#!/usr/bin/env bash
# scripts/docker-health.sh — verify that the Docker stack is fully ready.
#
# Usage: bash scripts/docker-health.sh
#
# Exit codes:
#   0  All checks passed — the stack is ready.
#   1  One or more checks failed.

set -euo pipefail

PASS=0
FAIL=1
overall=0

check() {
  local label="$1"
  local cmd="$2"
  if eval "$cmd" > /dev/null 2>&1; then
    echo "  ✅  $label"
  else
    echo "  ❌  $label"
    overall=1
  fi
}

echo ""
echo "==> Veritoken Docker stack health check"
echo ""

# ── Stellar node ──────────────────────────────────────────────────────────
echo "Stellar node (http://localhost:8000):"
check "Soroban RPC endpoint responding" \
  "curl -sf http://localhost:8000/soroban/rpc"

# ── Contracts service ─────────────────────────────────────────────────────
echo ""
echo "Contracts service:"
check "Container is running" \
  "docker compose ps contracts | grep -q 'running\|Up'"
check "cargo check passes inside container" \
  "docker compose exec -T contracts cargo check --target wasm32v1-none --quiet"

# ── Frontend service ──────────────────────────────────────────────────────
echo ""
echo "Frontend (http://localhost:5173):"
check "Dev server responding" \
  "curl -sf http://localhost:5173"

# ── Summary ───────────────────────────────────────────────────────────────
echo ""
if [ "$overall" -eq 0 ]; then
  echo "All checks passed. The Veritoken stack is ready."
else
  echo "One or more checks failed. Check 'docker compose logs' for details."
fi
echo ""

exit "$overall"
