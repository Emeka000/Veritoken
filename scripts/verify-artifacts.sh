#!/usr/bin/env bash
# verify-artifacts.sh — pre-deployment WASM artifact verification
#
# Checks that every required WASM artifact exists, is a valid WASM binary
# (magic bytes 00 61 73 6d), and falls within acceptable size bounds before
# any deployment command runs.
#
# Usage:
#   bash scripts/verify-artifacts.sh
#   bash scripts/verify-artifacts.sh --dry-run    # print results, always exit 0
#
# Exit codes:
#   0 — all artifacts pass
#   1 — one or more checks failed (specific error printed before exit)
#
# Environment:
#   WASM_DIR  — override the directory containing built WASM files
#               (default: target/wasm32-unknown-unknown/release)

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────

WASM_DIR="${WASM_DIR:-target/wasm32-unknown-unknown/release}"

# Minimum size: a valid (non-empty) compiled Soroban contract is several KB.
# Anything smaller is almost certainly a build error or a stub.
MIN_BYTES=4096       # 4 KB

# Maximum size: keep parity with the CI size-check threshold.
MAX_BYTES=131072     # 128 KB

# The five artifacts that must be present and valid before deployment proceeds.
REQUIRED_ARTIFACTS=(
  "kyc_registry"
  "compliance_engine"
  "invoice_token"
  "property_token"
  "carbon_credit_token"
)

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
fi

# ── Helpers ───────────────────────────────────────────────────────────────────

FAILURES=0

pass()  { printf "  [ok]  %s\n" "$1"; }
warn()  { printf "  [warn] %s\n" "$1"; }
fail()  {
  printf "  [FAIL] %s\n" "$1" >&2
  FAILURES=$(( FAILURES + 1 ))
}

# Returns 0 (true) if the first four bytes of the file are the WASM magic number.
is_valid_wasm() {
  local file="$1"
  # WASM magic: \0asm  → 00 61 73 6d
  local magic
  magic=$(xxd -p -l 4 "$file" 2>/dev/null || od -A n -N 4 -t x1 "$file" 2>/dev/null | tr -d ' \n')
  [[ "$magic" == "0061736d" ]]
}

human_size() {
  local bytes="$1"
  if command -v bc &>/dev/null; then
    echo "$(echo "scale=1; $bytes / 1024" | bc) KB"
  else
    echo "$bytes bytes"
  fi
}

# ── Pre-flight: WASM_DIR must exist ──────────────────────────────────────────

echo "==> Verifying WASM artifacts in: $WASM_DIR"
echo ""

if [[ ! -d "$WASM_DIR" ]]; then
  echo "ERROR: WASM output directory not found: $WASM_DIR" >&2
  echo "       Run 'cargo build --release --target wasm32-unknown-unknown' first." >&2
  if $DRY_RUN; then exit 0; fi
  exit 1
fi

# ── Per-artifact checks ───────────────────────────────────────────────────────

printf "%-36s %-12s %-10s %-10s  %s\n" "Artifact" "Size" "Min OK" "Max OK" "Magic"
echo "────────────────────────────────────────────────────────────────────────────"

for name in "${REQUIRED_ARTIFACTS[@]}"; do
  file="$WASM_DIR/${name}.wasm"

  # 1. File existence
  if [[ ! -f "$file" ]]; then
    printf "%-36s %-12s\n" "${name}.wasm" "MISSING"
    fail "${name}.wasm not found at $file"
    continue
  fi

  size=$(wc -c < "$file")
  size_human=$(human_size "$size")

  # 2. Minimum size
  if [[ "$size" -lt "$MIN_BYTES" ]]; then
    min_ok="NO ($(human_size "$size") < $(human_size "$MIN_BYTES"))"
  else
    min_ok="yes"
  fi

  # 3. Maximum size
  if [[ "$size" -gt "$MAX_BYTES" ]]; then
    max_ok="NO ($(human_size "$size") > $(human_size "$MAX_BYTES"))"
  else
    max_ok="yes"
  fi

  # 4. WASM magic bytes
  if is_valid_wasm "$file"; then
    magic_ok="yes"
  else
    magic_ok="NO"
  fi

  printf "%-36s %-12s %-10s %-10s  %s\n" \
    "${name}.wasm" "$size_human" "$min_ok" "$max_ok" "$magic_ok"

  # Accumulate failures
  [[ "$min_ok" == "yes" ]] || fail "${name}.wasm is suspiciously small (${size_human}) — possible build error"
  [[ "$max_ok" == "yes" ]] || fail "${name}.wasm exceeds the ${MAX_BYTES}-byte deployment limit (${size_human})"
  [[ "$magic_ok" == "yes" ]] || fail "${name}.wasm does not start with the WASM magic number — file may be corrupt or not a WASM binary"
done

echo "────────────────────────────────────────────────────────────────────────────"
echo ""

# ── Summary ───────────────────────────────────────────────────────────────────

if [[ "$FAILURES" -eq 0 ]]; then
  echo "Artifact verification passed. All ${#REQUIRED_ARTIFACTS[@]} artifacts are present and valid."
  exit 0
fi

echo "Artifact verification FAILED: $FAILURES check(s) did not pass." >&2
echo "Resolve the errors above before deploying." >&2

if $DRY_RUN; then
  warn "dry-run mode: exiting 0 despite failures"
  exit 0
fi

exit 1
