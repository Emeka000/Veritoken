#!/usr/bin/env bash
# check-wasm-size.sh — enforce the Veritoken contract size budget.
#
# Usage:
#   bash scripts/check-wasm-size.sh [--wasm-dir <path>]
#
# Exits 0 when every WASM binary is within budget, 1 otherwise.
# When WASM binaries do not exist yet, prints a warning and exits 0
# (the caller is expected to build first).
#
# Per-contract budgets (bytes)
# ────────────────────────────
# These figures are measured from the release build and include a 20 % headroom
# above the current binary size to absorb minor feature additions without
# triggering a false-positive failure.  If you need to raise a threshold:
#   1. Confirm the growth is intentional (not dead code, unused deps, etc.).
#   2. Update the value below and add a note in docs/contract-size-budget.md.
#   3. Open a PR so the change is reviewed.
#
# To regenerate baselines after a legitimate size increase:
#   cargo build --release --target wasm32-unknown-unknown
#   bash scripts/check-wasm-size.sh --print-sizes

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────

WASM_DIR="target/wasm32-unknown-unknown/release"

# Parse optional --wasm-dir override
while [[ $# -gt 0 ]]; do
    case "$1" in
        --wasm-dir)
            WASM_DIR="$2"
            shift 2
            ;;
        --print-sizes)
            PRINT_ONLY=1
            shift
            ;;
        *)
            echo "Unknown argument: $1" >&2
            exit 1
            ;;
    esac
done

PRINT_ONLY="${PRINT_ONLY:-0}"

# Per-contract byte budgets.
# Keys are basename of the WASM file (without path, with .wasm extension).
declare -A BUDGETS=(
    ["kyc_registry.wasm"]=204800          # 200 KB
    ["compliance_engine.wasm"]=204800      # 200 KB
    ["rwa_token.wasm"]=262144             # 256 KB
    ["invoice_token.wasm"]=262144         # 256 KB
    ["property_token.wasm"]=262144        # 256 KB
    ["carbon_credit_token.wasm"]=204800   # 200 KB
    ["token_helpers.wasm"]=65536          # 64 KB  (library, not a standalone contract)
)

# Global fallback for any WASM not listed above.
DEFAULT_BUDGET=262144   # 256 KB

# ── Report ────────────────────────────────────────────────────────────────────

if [ ! -d "$WASM_DIR" ]; then
    echo "WASM directory not found: $WASM_DIR"
    echo "Run 'cargo build --release --target wasm32-unknown-unknown' first."
    exit 0
fi

shopt -s nullglob
WASMS=("$WASM_DIR"/*.wasm)
shopt -u nullglob

if [ ${#WASMS[@]} -eq 0 ]; then
    echo "No WASM files found in $WASM_DIR — skipping size check."
    exit 0
fi

EXIT_CODE=0

printf "\n%-52s %12s  %12s  %s\n" "Contract" "Size (bytes)" "Budget (bytes)" "Status"
printf '%s\n' "$(printf '─%.0s' {1..100})"

for WASM in "${WASMS[@]}"; do
    NAME=$(basename "$WASM")
    SIZE=$(wc -c < "$WASM")

    if [[ -v BUDGETS["$NAME"] ]]; then
        BUDGET="${BUDGETS[$NAME]}"
    else
        BUDGET="$DEFAULT_BUDGET"
    fi

    SIZE_KB=$(awk "BEGIN { printf \"%.1f\", $SIZE / 1024 }")
    BUDGET_KB=$(awk "BEGIN { printf \"%.1f\", $BUDGET / 1024 }")
    PCT=$(awk "BEGIN { printf \"%.0f\", ($SIZE / $BUDGET) * 100 }")

    if [ "$PRINT_ONLY" -eq 1 ]; then
        printf "%-52s %12d  %12d  %s KB / %s KB (%s%%)\n" \
            "$NAME" "$SIZE" "$BUDGET" "$SIZE_KB" "$BUDGET_KB" "$PCT"
        continue
    fi

    if [ "$SIZE" -gt "$BUDGET" ]; then
        STATUS="❌  OVER BUDGET — ${SIZE_KB} KB > ${BUDGET_KB} KB (${PCT}%)"
        EXIT_CODE=1
    elif [ "$PCT" -ge 90 ]; then
        STATUS="⚠️   NEAR LIMIT  — ${SIZE_KB} KB / ${BUDGET_KB} KB (${PCT}%)"
    else
        STATUS="✅  OK           — ${SIZE_KB} KB / ${BUDGET_KB} KB (${PCT}%)"
    fi

    printf "%-52s %12d  %12d  %s\n" "$NAME" "$SIZE" "$BUDGET" "$STATUS"
done

printf '%s\n\n' "$(printf '─%.0s' {1..100})"

if [ "$EXIT_CODE" -ne 0 ]; then
    cat <<'EOF'
One or more WASM binaries exceed their documented size budget.

Reduction techniques (in order of typical impact):
  1. Remove unused dependencies from the contract's Cargo.toml.
  2. Confirm [profile.release] has opt-level = "z", lto = true, codegen-units = 1.
  3. Run: wasm-opt -Oz <file>.wasm -o <file>.wasm  (requires binaryen).
  4. Review whether any large data structure or string literal can be trimmed.
  5. If the growth is intentional, update the BUDGETS table in this script
     and document the reason in docs/contract-size-budget.md.

See docs/contract-size-budget.md for the full budget policy.
EOF
fi

exit "$EXIT_CODE"
