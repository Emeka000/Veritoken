# Rollback and Recovery Guide

This guide covers how to roll back or recover from a bad deployment, a misconfigured contract, a broken frontend release, or an environment switch. The steps are written to be followed under pressure — read through the relevant section before you need it.

> **Soroban contracts are immutable.** There is no in-place upgrade or rollback for contract code. "Rolling back" a contract means deploying the previous version alongside the existing one, migrating state, and updating the frontend to point at the new contract IDs. The steps for this are in [Contract Code Rollback](#3-contract-code-rollback) below.

---

## Prerequisites

Every command in this guide assumes:

```bash
export ADMIN_KEY=<your-admin-keypair-name>   # registered in Stellar CLI
export NETWORK=mainnet                        # or testnet / standalone
export CE_ID=<compliance-engine-contract-id>
export KYC_ID=<kyc-registry-contract-id>
export INVOICE_ID=<invoice-token-contract-id>
export PROPERTY_ID=<property-token-contract-id>
export CARBON_ID=<carbon-credit-token-contract-id>
```

Keep a copy of the current contract IDs in a secure document outside the repository.

---

## Decision Tree

```
Deployment went wrong
        │
        ├── Frontend config change only?
        │         └─► Section 1 — Frontend Rollback
        │
        ├── Compliance rules misconfigured?
        │         └─► Section 2 — Compliance Config Rollback
        │
        ├── Contract code needs to change?
        │         └─► Section 3 — Contract Code Rollback
        │
        ├── Wrong network / environment?
        │         └─► Section 4 — Environment Rollback
        │
        └── Not sure / live incident in progress?
                  └─► Step 1: Pause all transfers (Section 5)
                      Step 2: Diagnose
                      Step 3: Apply the relevant section above
```

---

## 1. Frontend Rollback

Use this when a frontend deployment introduced a regression and you need to revert the UI without touching any contracts.

### Revert using git

```bash
# Find the last known-good commit
git log --oneline frontend/

# Create a revert commit (non-destructive)
git revert <bad-commit-sha> --no-edit

# Push the revert to trigger a new deployment
git push origin main
```

### Revert contract ID configuration only

If the frontend `.env` was updated with wrong contract IDs:

```bash
# Edit frontend/.env (or the CI secret / hosting environment variable)
# and replace the wrong IDs with the previous values

# For Vite/static hosting: rebuild and redeploy
cd frontend
npm run build
# deploy the dist/ directory via your hosting provider
```

Contract IDs are write-once at deploy time — reverting `.env` to the old IDs immediately restores the frontend to pointing at the previous contracts.

---

## 2. Compliance Config Rollback

Use this when `set_rules` was called with incorrect values (e.g. wrong `max_holders`, wrong `min_holding_period`, or accidental pause).

### Correct a misconfigured rule

```bash
# Inspect the current rules
stellar contract invoke \
  --id "$CE_ID" \
  --source "$ADMIN_KEY" \
  --network "$NETWORK" \
  -- get_rules

# Apply the corrected ruleset
stellar contract invoke \
  --id "$CE_ID" \
  --source "$ADMIN_KEY" \
  --network "$NETWORK" \
  -- set_rules \
  --rules '{
    "max_transfer_amount": 0,
    "min_holding_period": 0,
    "max_holders": 2000,
    "require_same_jurisdiction": false,
    "paused": false
  }'
```

Replace the field values with your intended configuration. There is no rule history on-chain — apply the correct values directly.

### Unpause if accidentally paused

```bash
stellar contract invoke \
  --id "$CE_ID" \
  --source "$ADMIN_KEY" \
  --network "$NETWORK" \
  -- unpause
```

Verify:

```bash
stellar contract invoke \
  --id "$CE_ID" \
  --source "$ADMIN_KEY" \
  --network "$NETWORK" \
  -- get_rules
# paused should now be false
```

### Remove an incorrect blocklist entry

```bash
stellar contract invoke \
  --id "$CE_ID" \
  --source "$ADMIN_KEY" \
  --network "$NETWORK" \
  -- remove_from_blocklist \
  --addr "G...HOLDER"
```

### Remove an incorrect KYC approval

```bash
stellar contract invoke \
  --id "$KYC_ID" \
  --source "$ADMIN_KEY" \
  --network "$NETWORK" \
  -- revoke \
  --verifier "G...VERIFIER_ADDRESS" \
  --addr "G...SUBJECT_ADDRESS"
```

---

## 3. Contract Code Rollback

Use this when a contract was deployed with a code bug that must be fixed. Because Soroban contracts are immutable, the procedure is:

1. **Pause** — stop all activity on the affected contracts.
2. **Snapshot state** — export all on-chain state before any migration.
3. **Fix and build** — apply the code fix and produce new WASM artifacts.
4. **Deploy new contracts** — deploy fresh instances of the fixed contracts.
5. **Replay state** — import the snapshotted state into the new instances.
6. **Update frontend** — point the UI at the new contract IDs.
7. **Unpause** — resume transfers.

### Step 1 — Pause all transfers

```bash
stellar contract invoke \
  --id "$CE_ID" \
  --source "$ADMIN_KEY" \
  --network "$NETWORK" \
  -- pause
```

### Step 2 — Snapshot all state

Save the output of each command to a file before continuing.

```bash
# Compliance rules
stellar contract invoke \
  --id "$CE_ID" --source "$ADMIN_KEY" --network "$NETWORK" \
  -- get_rules > snapshot/compliance-rules.json

# Blocklist (repeat with increasing --start until output is empty)
stellar contract invoke \
  --id "$CE_ID" --source "$ADMIN_KEY" --network "$NETWORK" \
  -- get_blocklist --start 0 --limit 50 > snapshot/blocklist.json

# KYC records per verifier (repeat per verifier and per page)
stellar contract invoke \
  --id "$KYC_ID" --source "$ADMIN_KEY" --network "$NETWORK" \
  -- get_subjects_by_verifier \
  --verifier "G...VERIFIER" --start 0 --limit 50 > snapshot/kyc-subjects.json

# Invoice metadata
stellar contract invoke \
  --id "$INVOICE_ID" --source "$ADMIN_KEY" --network "$NETWORK" \
  -- get_meta > snapshot/invoice-meta.json

# Property metadata
stellar contract invoke \
  --id "$PROPERTY_ID" --source "$ADMIN_KEY" --network "$NETWORK" \
  -- get_meta > snapshot/property-meta.json

# Carbon credit metadata
stellar contract invoke \
  --id "$CARBON_ID" --source "$ADMIN_KEY" --network "$NETWORK" \
  -- get_meta > snapshot/carbon-meta.json
```

Verify the snapshots are non-empty before proceeding.

### Step 3 — Fix and build

Apply the code fix on a branch, get it reviewed, and merge. Then build:

```bash
git checkout main && git pull
cargo build --release --target wasm32-unknown-unknown

WASM_DIR="target/wasm32-unknown-unknown/release"

# Optimise binaries
stellar contract optimize --wasm "$WASM_DIR/kyc_registry.wasm"
stellar contract optimize --wasm "$WASM_DIR/compliance_engine.wasm"
stellar contract optimize --wasm "$WASM_DIR/invoice_token.wasm"
stellar contract optimize --wasm "$WASM_DIR/property_token.wasm"
stellar contract optimize --wasm "$WASM_DIR/carbon_credit_token.wasm"
```

### Step 4 — Deploy new contracts

```bash
ADMIN_ADDR="$(stellar keys address $ADMIN_KEY)"

NEW_KYC_ID=$(stellar contract deploy \
  --source-account "$ADMIN_KEY" --network "$NETWORK" \
  --wasm "$WASM_DIR/kyc_registry.wasm" \
  -- --admin "$ADMIN_ADDR")
echo "NEW_KYC_REGISTRY_ID=$NEW_KYC_ID"

NEW_CE_ID=$(stellar contract deploy \
  --source-account "$ADMIN_KEY" --network "$NETWORK" \
  --wasm "$WASM_DIR/compliance_engine.wasm" \
  -- --admin "$ADMIN_ADDR" --kyc-registry "$NEW_KYC_ID")
echo "NEW_COMPLIANCE_ENGINE_ID=$NEW_CE_ID"

# Deploy asset tokens with the same --meta values from your snapshots
NEW_INV_ID=$(stellar contract deploy \
  --source-account "$ADMIN_KEY" --network "$NETWORK" \
  --wasm "$WASM_DIR/invoice_token.wasm" \
  -- --admin "$ADMIN_ADDR" \
     --kyc-registry "$NEW_KYC_ID" \
     --compliance-engine "$NEW_CE_ID" \
     --meta "$(cat snapshot/invoice-meta.json)")
echo "NEW_INVOICE_TOKEN_ID=$NEW_INV_ID"

NEW_PROP_ID=$(stellar contract deploy \
  --source-account "$ADMIN_KEY" --network "$NETWORK" \
  --wasm "$WASM_DIR/property_token.wasm" \
  -- --admin "$ADMIN_ADDR" \
     --kyc-registry "$NEW_KYC_ID" \
     --compliance-engine "$NEW_CE_ID" \
     --meta "$(cat snapshot/property-meta.json)")
echo "NEW_PROPERTY_TOKEN_ID=$NEW_PROP_ID"

NEW_CARBON_ID=$(stellar contract deploy \
  --source-account "$ADMIN_KEY" --network "$NETWORK" \
  --wasm "$WASM_DIR/carbon_credit_token.wasm" \
  -- --admin "$ADMIN_ADDR" \
     --kyc-registry "$NEW_KYC_ID" \
     --compliance-engine "$NEW_CE_ID" \
     --meta "$(cat snapshot/carbon-meta.json)")
echo "NEW_CARBON_TOKEN_ID=$NEW_CARBON_ID"
```

Record all new IDs before moving on.

### Step 5 — Replay state

Restore compliance rules and blocklist entries into the new compliance engine:

```bash
stellar contract invoke \
  --id "$NEW_CE_ID" --source "$ADMIN_KEY" --network "$NETWORK" \
  -- set_rules --rules "$(cat snapshot/compliance-rules.json)"

# Re-add blocklist entries from snapshot/blocklist.json
# (run one invoke per address)
```

Re-approve KYC subjects in the new registry using a trusted verifier:

```bash
# For each subject in snapshot/kyc-subjects.json:
stellar contract invoke \
  --id "$NEW_KYC_ID" --source "$ADMIN_KEY" --network "$NETWORK" \
  -- approve \
  --verifier "G...VERIFIER" \
  --addr "G...SUBJECT" \
  --tier <tier> \
  --expiry <expiry> \
  --jurisdiction <jurisdiction>
```

### Step 6 — Update frontend

```bash
cat > frontend/.env <<EOF
VITE_STELLAR_NETWORK=$NETWORK
VITE_KYC_REGISTRY_ID=$NEW_KYC_ID
VITE_COMPLIANCE_ENGINE_ID=$NEW_CE_ID
VITE_INVOICE_TOKEN_ID=$NEW_INV_ID
VITE_PROPERTY_TOKEN_ID=$NEW_PROP_ID
VITE_CARBON_TOKEN_ID=$NEW_CARBON_ID
EOF

cd frontend && npm run build
# deploy dist/ to your hosting provider
```

### Step 7 — Unpause

```bash
stellar contract invoke \
  --id "$NEW_CE_ID" --source "$ADMIN_KEY" --network "$NETWORK" \
  -- unpause
```

Verify transfers work end-to-end before announcing the incident resolved.

---

## 4. Environment Rollback

Use this when a deployment pointed at the wrong network (e.g. mainnet command was run against testnet config, or vice versa).

### Identify which network was used

```bash
# Each contract ID is tied to a specific network — fetch confirms which one
stellar contract fetch --network testnet --id "$CONTRACT_ID"
stellar contract fetch --network mainnet --id "$CONTRACT_ID"
# One of these will succeed; the other will fail
```

### Point the frontend at the correct network

Update `frontend/.env`:

```bash
VITE_STELLAR_NETWORK=mainnet   # or testnet
VITE_KYC_REGISTRY_ID=<correct-id-for-that-network>
# ... remaining IDs
```

Rebuild and redeploy the frontend.

### If contracts were deployed to the wrong network

Contracts deployed to the wrong network cannot be moved. Treat it as a new deployment:

- On testnet: the funds are test funds — abandon the contracts and redeploy to the correct network.
- On mainnet: if real funds are at stake, pause the contract immediately and follow the [Contract Code Rollback](#3-contract-code-rollback) procedure to deploy fresh instances on the intended network.

---

## 5. Emergency Stop During Any Rollback

If anything goes wrong mid-rollback and you need to freeze the system immediately:

```bash
stellar contract invoke \
  --id "$CE_ID" \
  --source "$ADMIN_KEY" \
  --network "$NETWORK" \
  -- pause
```

This blocks all transfers across every asset token. No funds can move while the pause is active. Resume with `-- unpause` after the issue is resolved.

For full incident response procedures — including admin key rotation and compromised verifier recovery — see [docs/incident-response.md](incident-response.md).

---

## Conditions for Using This Guide

| Situation | Recommended section |
|---|---|
| Wrong frontend `.env` committed | [Section 1](#1-frontend-rollback) |
| Wrong compliance rules applied | [Section 2](#2-compliance-config-rollback) |
| Contract code bug found post-deploy | [Section 3](#3-contract-code-rollback) |
| Deployed to wrong network | [Section 4](#4-environment-rollback) |
| Transfers must stop immediately | [Section 5](#5-emergency-stop-during-any-rollback) |
| Admin key compromised | [Incident Response Runbook — Section 2](incident-response.md) |
| KYC verifier compromised | [Incident Response Runbook — Section 3](incident-response.md) |

---

## Escalation

If you cannot execute the rollback steps with the available admin key, escalate to a key holder with admin authority. Do not leave a misconfigured contract running while waiting — pause it first, then escalate.

Contact information for key holders should be maintained in a secure, offline document that is accessible to at least two team members.
