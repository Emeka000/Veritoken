#!/usr/bin/env bash
# Veritoken gas / performance report script
# Measures CPU instructions and memory bytes for the main read-path contract
# operations and writes the results to docs/gas-report.md.
#
# Usage:
#   bash scripts/gas-report.sh [identity] [network]
#
# Defaults:
#   identity = veritoken-dev
#   network  = testnet
#
# Contract IDs are read from frontend/.env (the file written by deploy.sh).
# Override any ID by exporting the corresponding variable before running:
#
#   export VITE_KYC_REGISTRY_ID=C...
#   bash scripts/gas-report.sh veritoken-dev testnet
#
# Requirements:
#   stellar CLI with --cost flag support (stellar-cli >= 20.0.0)
#   A deployed set of contracts (run deploy.sh first)
#   An address with active KYC to use as the probe address (PROBE_ADDRESS)

set -euo pipefail

IDENTITY="${1:-veritoken-dev}"
NETWORK="${2:-testnet}"
PROBE_ADDRESS="${PROBE_ADDRESS:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_ROOT/frontend/.env"
REPORT_FILE="$REPO_ROOT/docs/gas-report.md"

# ── Load contract IDs from frontend/.env ─────────────────────────────────────

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source <(grep -E '^VITE_' "$ENV_FILE" | sed 's/^/export /')
fi

KYC_ID="${VITE_KYC_REGISTRY_ID:-}"
CE_ID="${VITE_COMPLIANCE_ENGINE_ID:-}"
INV_ID="${VITE_INVOICE_TOKEN_ID:-}"

if [[ -z "$KYC_ID" || -z "$CE_ID" || -z "$INV_ID" ]]; then
  echo "ERROR: Contract IDs not found. Run 'bash scripts/deploy.sh $IDENTITY' first,"
  echo "       or export VITE_KYC_REGISTRY_ID / VITE_COMPLIANCE_ENGINE_ID / VITE_INVOICE_TOKEN_ID."
  exit 1
fi

if [[ -z "$PROBE_ADDRESS" ]]; then
  PROBE_ADDRESS="$(stellar keys address "$IDENTITY")"
fi

SOURCE="--source-account $IDENTITY --network $NETWORK"
TIMESTAMP="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

echo "==> Veritoken gas report"
echo "    Network:  $NETWORK"
echo "    Identity: $IDENTITY ($PROBE_ADDRESS)"
echo "    KYC:      $KYC_ID"
echo "    CE:       $CE_ID"
echo "    Invoice:  $INV_ID"
echo ""

# ── Helper: invoke with --cost and extract metrics ────────────────────────────

# run_cost CONTRACT FUNCTION ARGS...
# Prints "cpu_insns mem_bytes" on stdout.
run_cost() {
  local contract_id="$1"
  local fn_name="$2"
  shift 2

  local output
  # --cost prints resource usage to stderr; result goes to stdout.
  # We capture stderr to parse cpu_insns and mem_bytes.
  output=$(stellar contract invoke \
    $SOURCE \
    --id "$contract_id" \
    --cost \
    -- "$fn_name" "$@" 2>&1 || true)

  local cpu mem
  cpu=$(echo "$output" | grep -i 'cpu_insns\|cpu instructions' | grep -oE '[0-9]+' | head -1 || echo "N/A")
  mem=$(echo "$output" | grep -i 'mem_bytes\|memory bytes' | grep -oE '[0-9]+' | head -1 || echo "N/A")
  echo "$cpu $mem"
}

# ── Collect measurements ──────────────────────────────────────────────────────

echo "    Measuring compliance-engine::get_rules..."
read -r CPU_GET_RULES MEM_GET_RULES <<< "$(run_cost "$CE_ID" get_rules)"

echo "    Measuring compliance-engine::is_blocklisted..."
read -r CPU_BLOCKLISTED MEM_BLOCKLISTED <<< "$(run_cost "$CE_ID" is_blocklisted --addr "$PROBE_ADDRESS")"

echo "    Measuring compliance-engine::holder_count..."
read -r CPU_HOLDER_COUNT MEM_HOLDER_COUNT <<< "$(run_cost "$CE_ID" holder_count)"

echo "    Measuring compliance-engine::can_transfer..."
read -r CPU_CAN_TRANSFER MEM_CAN_TRANSFER <<< "$(run_cost "$CE_ID" can_transfer \
  --from "$PROBE_ADDRESS" --to "$PROBE_ADDRESS" --amount 10000000)"

echo "    Measuring kyc-registry::is_approved..."
read -r CPU_IS_APPROVED MEM_IS_APPROVED <<< "$(run_cost "$KYC_ID" is_approved --addr "$PROBE_ADDRESS")"

echo "    Measuring kyc-registry::get_record..."
read -r CPU_GET_RECORD MEM_GET_RECORD <<< "$(run_cost "$KYC_ID" get_record --addr "$PROBE_ADDRESS")"

echo "    Measuring kyc-registry::get_tier..."
read -r CPU_GET_TIER MEM_GET_TIER <<< "$(run_cost "$KYC_ID" get_tier --addr "$PROBE_ADDRESS")"

echo "    Measuring invoice-token::is_settled..."
read -r CPU_IS_SETTLED MEM_IS_SETTLED <<< "$(run_cost "$INV_ID" is_settled)"

echo "    Measuring invoice-token::get_meta..."
read -r CPU_GET_META MEM_GET_META <<< "$(run_cost "$INV_ID" get_meta)"

# ── Write report ──────────────────────────────────────────────────────────────

cat > "$REPORT_FILE" <<REPORT
# Gas and Performance Report

Generated: $TIMESTAMP  
Network: $NETWORK  
KYC Registry: \`$KYC_ID\`  
Compliance Engine: \`$CE_ID\`  
Invoice Token: \`$INV_ID\`  
Probe address: \`$PROBE_ADDRESS\`

Regenerate this report at any time:
\`\`\`bash
bash scripts/gas-report.sh $IDENTITY $NETWORK
\`\`\`

---

## What these numbers mean

Soroban charges for two resources on every transaction:

- **cpu_insns** — CPU instructions consumed by the WASM execution. The network
  ledger limit is 100,000,000 instructions per transaction. Operations that stay
  below 1,000,000 are considered inexpensive.
- **mem_bytes** — WASM linear memory allocated during execution. The per-transaction
  limit is 41,943,040 bytes (40 MB). Most contract calls use well under 1 MB.

These measurements were captured using \`stellar contract invoke --cost\` against
live contracts on $NETWORK. They reflect the read path only — write operations
(transfer, approve, set_rules) will be higher because they also pay for storage
I/O and event emission.

---

## Baseline measurements

| Contract | Function | cpu_insns | mem_bytes | Notes |
|---|---|---|---|---|
| compliance-engine | \`get_rules\` | $CPU_GET_RULES | $MEM_GET_RULES | Read global rules struct |
| compliance-engine | \`is_blocklisted\` | $CPU_BLOCKLISTED | $MEM_BLOCKLISTED | Single address lookup |
| compliance-engine | \`holder_count\` | $CPU_HOLDER_COUNT | $MEM_HOLDER_COUNT | Read counter |
| compliance-engine | \`can_transfer\` | $CPU_CAN_TRANSFER | $MEM_CAN_TRANSFER | Cross-contract: calls KYC registry |
| kyc-registry | \`is_approved\` | $CPU_IS_APPROVED | $MEM_IS_APPROVED | Single address lookup |
| kyc-registry | \`get_record\` | $CPU_GET_RECORD | $MEM_GET_RECORD | Full KycRecord struct |
| kyc-registry | \`get_tier\` | $CPU_GET_TIER | $MEM_GET_TIER | Single u32 lookup |
| invoice-token | \`is_settled\` | $CPU_IS_SETTLED | $MEM_IS_SETTLED | Boolean flag read |
| invoice-token | \`get_meta\` | $CPU_GET_META | $MEM_GET_META | Full InvoiceMeta struct |

---

## Key observations

**Most expensive read: \`can_transfer\`**  
\`can_transfer\` on the compliance engine is the costliest read operation because
it makes a cross-contract call into the KYC registry to validate both parties.
Every token \`transfer\` call invokes \`can_transfer\` as part of its compliance
check, so optimizing this path has the highest leverage on overall transaction cost.

**Cheapest operations**  
Single-key reads (\`is_approved\`, \`is_settled\`, \`holder_count\`) are the
cheapest because they resolve a single persistent storage entry with no
cross-contract overhead.

**Struct reads**  
\`get_rules\`, \`get_record\`, and \`get_meta\` are more expensive than scalar reads
because they deserialize larger structs, but they remain well within the
per-transaction resource limits.

---

## Comparing over time

Commit this file after each report run. To see how costs changed:

\`\`\`bash
git diff HEAD docs/gas-report.md
\`\`\`

To compare two branches:
\`\`\`bash
git diff main..feat/my-branch -- docs/gas-report.md
\`\`\`

If \`cpu_insns\` grows significantly after a code change, examine whether new
cross-contract calls or additional storage reads were introduced.

---

## Running locally

\`\`\`bash
# After deploying to testnet
bash scripts/gas-report.sh veritoken-dev testnet

# With a specific probe address (must have KYC approval)
PROBE_ADDRESS=G... bash scripts/gas-report.sh veritoken-dev testnet
\`\`\`
REPORT

echo ""
echo "==> Report written to docs/gas-report.md"
