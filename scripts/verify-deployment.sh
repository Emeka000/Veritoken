#!/usr/bin/env bash
# Verifies a deployment manifest against local artifacts and deployed state.
#
# Usage:
#   bash scripts/verify-deployment.sh [identity-name]
#
# Exit codes:
#   0 - every artifact, code hash, metadata value, registry link, and health
#       check matches
#   1 - verification failed; inspect deployment-verification-report.json

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IDENTITY="${1:-${STELLAR_IDENTITY:-}}"
DEPLOY_MANIFEST="${DEPLOY_MANIFEST:-deploy-manifest.json}"
DEPLOY_VERIFICATION_REPORT="${DEPLOY_VERIFICATION_REPORT:-deployment-verification-report.json}"

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

ARGS=(
  "$SCRIPT_DIR/deployment_cli.py"
  verify
  --manifest "$DEPLOY_MANIFEST"
  --report "$DEPLOY_VERIFICATION_REPORT"
)
if [[ -n "$IDENTITY" ]]; then
  ARGS+=(--identity "$IDENTITY")
fi

"$PYTHON_EXECUTABLE" "${ARGS[@]}"
echo "Deployment verified."
