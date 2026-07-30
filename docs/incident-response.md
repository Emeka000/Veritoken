# Incident Response Runbook

This runbook covers the five most likely operational incidents for a Veritoken deployment. Each section contains exact CLI commands. The emergency pause procedure is designed to be executable in under 5 minutes.

Keep a copy of this document and your admin key accessible offline (e.g. printed, or in a password manager with offline access) — you will not have time to look things up during a live incident.

---

## Prerequisites

Every command below assumes:

```bash
# Set once in your shell session
export ADMIN_KEY=<your-admin-keypair-name>   # registered in Stellar CLI
export NETWORK=mainnet                        # or testnet
export CE_ID=<compliance-engine-contract-id>
export KYC_ID=<kyc-registry-contract-id>
export INVOICE_ID=<invoice-token-contract-id>
export PROPERTY_ID=<property-token-contract-id>
export CARBON_ID=<carbon-credit-token-contract-id>
export RWA_ID=<rwa-token-contract-id>
```

---

## 1. Emergency Pause

Use this when you need to stop **all token transfers immediately** — market disruption, a suspected exploit, or a regulatory instruction.

**Target time: under 5 minutes.**

### Via CLI (fastest)

```bash
# Pause the compliance engine — blocks all transfers across every asset token
stellar contract invoke \
  --id "$CE_ID" \
  --source "$ADMIN_KEY" \
  --network "$NETWORK" \
  -- \
  pause
```

Verify the pause took effect:

```bash
stellar contract invoke \
  --id "$CE_ID" \
  --source "$ADMIN_KEY" \
  --network "$NETWORK" \
  -- \
  get_rules
# Look for "paused": true in the output
```

### Via the Admin Frontend

1. Open the Veritoken frontend and navigate to **Admin**.
2. Under **Emergency Controls**, click **Pause All Transfers**.
3. Confirm in the dialog. The button calls `compliance-engine::pause()`.
4. The "Compliance Rules" panel will reload and show `paused: true`.

### To Resume

```bash
stellar contract invoke \
  --id "$CE_ID" \
  --source "$ADMIN_KEY" \
  --network "$NETWORK" \
  -- \
  unpause
```

Or use **Unpause Transfers** in the Admin frontend.

### Pause Invoice Settlement and Redemption Only

To pause only invoice settlement/redemption without touching transfers, use the dedicated invoice-contract pause:

```bash
# Pause settlement and redemption flows (invoice-token only)
stellar contract invoke \
  --id "$INVOICE_ID" \
  --source "$ADMIN_KEY" \
  --network "$NETWORK" \
  -- \
  pause_lifecycle

# Resume
stellar contract invoke \
  --id "$INVOICE_ID" \
  --source "$ADMIN_KEY" \
  --network "$NETWORK" \
  -- \
  unpause_lifecycle
```

Query the current state:

```bash
stellar contract invoke \
  --id "$INVOICE_ID" \
  --source "$ADMIN_KEY" \
  --network "$NETWORK" \
  -- \
  lifecycle_paused
# Returns true / false
```

---

## 2. Admin Key Rotation

Use this when a key is at risk of compromise but has not yet been used maliciously. If it has already been used, go to section 3 (Compromised Verifier Response) for immediate revocations, then return here.

Admin rotation is a **two-step handover** to prevent accidental lockout.

### Step 1 — Propose the new admin (from the current admin key)

```bash
stellar contract invoke \
  --id "$CE_ID" \
  --source "$ADMIN_KEY" \
  --network "$NETWORK" \
  -- \
  propose_admin \
  --new_admin <NEW_ADMIN_ADDRESS>
```

Repeat for every contract that holds its own admin:

```bash
for CONTRACT_ID in "$INVOICE_ID" "$PROPERTY_ID" "$CARBON_ID" "$RWA_ID" "$KYC_ID"; do
  stellar contract invoke \
    --id "$CONTRACT_ID" \
    --source "$ADMIN_KEY" \
    --network "$NETWORK" \
    -- \
    propose_admin \
    --new_admin <NEW_ADMIN_ADDRESS>
done
```

### Step 2 — Accept from the new key

```bash
export NEW_ADMIN_KEY=<new-keypair-name>

for CONTRACT_ID in "$CE_ID" "$INVOICE_ID" "$PROPERTY_ID" "$CARBON_ID" "$RWA_ID" "$KYC_ID"; do
  stellar contract invoke \
    --id "$CONTRACT_ID" \
    --source "$NEW_ADMIN_KEY" \
    --network "$NETWORK" \
    -- \
    accept_admin
done
```

The KYC registry supports multiple admins. After accepting, optionally remove the old admin address:

```bash
stellar contract invoke \
  --id "$KYC_ID" \
  --source "$NEW_ADMIN_KEY" \
  --network "$NETWORK" \
  -- \
  remove_admin \
  --caller <NEW_ADMIN_ADDRESS> \
  --admin_to_remove <OLD_ADMIN_ADDRESS>
```

**Verify all contracts now have the new admin before revoking the old key.**

---

## 3. Compromised Verifier Response

Use this if a KYC verifier key has been compromised and may have approved fraudulent addresses.

### Step 1 — Bulk-revoke all subjects approved by the verifier

`revoke_all_by_verifier` is capped at 50 subjects per call. If the verifier approved more than 50 addresses, call repeatedly until it returns `revoked: 0`.

```bash
export COMPROMISED_VERIFIER=<verifier-address>

# Run in a loop until no more subjects remain
while true; do
  stellar contract invoke \
    --id "$KYC_ID" \
    --source "$ADMIN_KEY" \
    --network "$NETWORK" \
    -- \
    revoke_all_by_verifier \
    --caller <ADMIN_ADDRESS> \
    --verifier "$COMPROMISED_VERIFIER"

  # Check the event log; stop when bulk_rvkd event shows revoked=0
  break  # replace with real loop condition
done
```

### Step 2 — Remove the verifier

```bash
stellar contract invoke \
  --id "$KYC_ID" \
  --source "$ADMIN_KEY" \
  --network "$NETWORK" \
  -- \
  remove_verifier \
  --caller <ADMIN_ADDRESS> \
  --verifier "$COMPROMISED_VERIFIER"
```

### Step 3 — Pause transfers while you investigate (optional)

```bash
stellar contract invoke \
  --id "$CE_ID" \
  --source "$ADMIN_KEY" \
  --network "$NETWORK" \
  -- \
  pause
```

### Step 4 — Re-verify legitimate subjects

Work with the verifier to identify which approvals were legitimate. Re-approve them using a trusted verifier key:

```bash
stellar contract invoke \
  --id "$KYC_ID" \
  --source "$TRUSTED_VERIFIER_KEY" \
  --network "$NETWORK" \
  -- \
  approve \
  --verifier <TRUSTED_VERIFIER_ADDRESS> \
  --subject <SUBJECT_ADDRESS> \
  --tier 1 \
  --expiry <UNIX_TIMESTAMP> \
  --jurisdiction US
```

---

## 4. Contract Upgrade Process

**Soroban contracts are immutable.** There is no in-place upgrade path. A "contract upgrade" is a full snapshot-and-redeploy procedure.

### When to upgrade

- A critical bug is found post-deployment
- A new compliance requirement needs a contract change
- You are migrating to a new Soroban SDK version

### Step 1 — Pause everything

```bash
stellar contract invoke \
  --id "$CE_ID" \
  --source "$ADMIN_KEY" \
  --network "$NETWORK" \
  -- \
  pause
```

### Step 2 — Snapshot all state

```bash
# Export KYC records (paged — repeat with increasing start offset until empty)
stellar contract invoke \
  --id "$KYC_ID" \
  --source "$ADMIN_KEY" \
  --network "$NETWORK" \
  -- \
  get_subjects_by_verifier \
  --verifier <VERIFIER_ADDRESS> \
  --start 0 \
  --limit 50

# Export compliance rules
stellar contract invoke \
  --id "$CE_ID" \
  --source "$ADMIN_KEY" \
  --network "$NETWORK" \
  -- \
  get_rules

# Export blocklist
stellar contract invoke \
  --id "$CE_ID" \
  --source "$ADMIN_KEY" \
  --network "$NETWORK" \
  -- \
  get_blocklist \
  --start 0 \
  --limit 50

# Export invoice metadata
stellar contract invoke \
  --id "$INVOICE_ID" \
  --source "$ADMIN_KEY" \
  --network "$NETWORK" \
  -- \
  list_invoices \
  --start 0 \
  --limit 50
```

Save all output to files before continuing.

### Step 3 — Build the new WASM

```bash
cargo build --release --target wasm32-unknown-unknown
# Optimise with wasm-opt if available
wasm-opt -Oz \
  target/wasm32-unknown-unknown/release/invoice_token.wasm \
  -o target/wasm32-unknown-unknown/release/invoice_token_opt.wasm
```

### Step 3.5 — Simulate the upgrade

Before spending a transaction on Step 4, check what the new build actually
changes. `simulate-upgrade` runs entirely offline (no chain access needed
unless you pass `--identity`) and flags breaking interface changes or an
invalid schema-version bump before you deploy:

```bash
python3 scripts/deployment_cli.py simulate-upgrade \
  --manifest deploy-manifest.json \
  --contract invoice_token \
  --new-artifact target/wasm32-unknown-unknown/release/invoice_token_opt.wasm \
  --to-schema-version <NEXT_SCHEMA_VERSION> \
  --identity "$ADMIN_KEY" --network "$NETWORK"
```

See [`docs/deployment-automation.md`](deployment-automation.md#upgrade-simulation)
for the full report format. Resolve any `critical` risk in the output before
continuing to Step 4.

### Step 4 — Deploy new contracts

```bash
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/invoice_token_opt.wasm \
  --source "$ADMIN_KEY" \
  --network "$NETWORK" \
  -- \
  --admin <ADMIN_ADDRESS> \
  --kyc_registry "$KYC_ID" \
  --compliance_engine "$CE_ID" \
  # ... remaining constructor args
```

Note the new contract IDs.

### Step 5 — Replay state into new contracts

Use the snapshots from Step 2 to re-populate KYC records, compliance rules, blocklist entries, and invoice metadata into the new contract instances.

### Step 6 — Update frontend config

Replace the contract IDs in `frontend/.env`:

```
VITE_INVOICE_TOKEN_CONTRACT_ID=<new-id>
VITE_PROPERTY_TOKEN_CONTRACT_ID=<new-id>
# etc.
```

Redeploy the frontend.

### Step 7 — Unpause

```bash
stellar contract invoke \
  --id "$CE_ID" \
  --source "$ADMIN_KEY" \
  --network "$NETWORK" \
  -- \
  unpause
```

---

## 5. Holder Communication

### Immediate (within 1 hour of incident)

Post to all official channels (project Discord/Telegram/Twitter/email list):

```
[VERITOKEN NOTICE — <DATE> <TIME> UTC]

We are investigating an issue with the Veritoken contracts on <NETWORK>.

As a precautionary measure, all token transfers have been paused.
No funds have been lost. Your token balances are safe.

We will provide an update within 2 hours.

— Veritoken Operations
```

### Resolution notice

```
[VERITOKEN UPDATE — <DATE> <TIME> UTC]

The issue identified earlier today has been resolved.

Summary: <one-paragraph description of what happened and what was fixed>

Impact: <list of affected addresses or "no holders were affected">

Actions taken:
- <bullet list of steps executed from this runbook>

Token transfers have been resumed as of <TIME> UTC (ledger <LEDGER_NUMBER>).

If you were unable to complete a transaction during the pause window,
please retry. Contact <support@yourdomain.com> with any questions.

— Veritoken Operations
```

### Post-incident

Within 5 business days, publish a public post-mortem covering:

1. Timeline of events
2. Root cause
3. Immediate actions taken
4. Long-term fixes deployed or planned
5. Changes to this runbook based on lessons learned

---

## Quick Reference

| Action | Command |
|--------|---------|
| Pause all transfers | `stellar contract invoke --id $CE_ID ... -- pause` |
| Unpause | `stellar contract invoke --id $CE_ID ... -- unpause` |
| Pause invoice lifecycle | `stellar contract invoke --id $INVOICE_ID ... -- pause_lifecycle` |
| Unpause invoice lifecycle | `stellar contract invoke --id $INVOICE_ID ... -- unpause_lifecycle` |
| Propose admin | `stellar contract invoke --id $CONTRACT ... -- propose_admin --new_admin <ADDR>` |
| Accept admin | `stellar contract invoke --id $CONTRACT ... -- accept_admin` |
| Bulk-revoke verifier subjects | `stellar contract invoke --id $KYC_ID ... -- revoke_all_by_verifier --caller <ADMIN> --verifier <ADDR>` |
| Remove verifier | `stellar contract invoke --id $KYC_ID ... -- remove_verifier --caller <ADMIN> --verifier <ADDR>` |
