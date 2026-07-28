# Gas and Performance Report

> **Note:** This is a template report. Run `bash scripts/gas-report.sh veritoken-dev`
> after deploying contracts to generate real measurements from your deployment.

Generated: (not yet run)  
Network: testnet  

Regenerate this report at any time:
```bash
bash scripts/gas-report.sh veritoken-dev testnet
```

---

## What these numbers mean

Soroban charges for two resources on every transaction:

- **cpu_insns** — CPU instructions consumed by the WASM execution. The network
  ledger limit is 100,000,000 instructions per transaction. Operations that stay
  below 1,000,000 are considered inexpensive.
- **mem_bytes** — WASM linear memory allocated during execution. The per-transaction
  limit is 41,943,040 bytes (40 MB). Most contract calls use well under 1 MB.

These measurements are captured using `stellar contract invoke --cost` against
live contracts on the target network. They reflect the read path only — write
operations (transfer, approve, set_rules) will be higher because they also pay
for storage I/O and event emission.

---

## Baseline measurements

| Contract | Function | cpu_insns | mem_bytes | Notes |
|---|---|---|---|---|
| compliance-engine | `get_rules` | — | — | Read global rules struct |
| compliance-engine | `is_blocklisted` | — | — | Single address lookup |
| compliance-engine | `holder_count` | — | — | Read counter |
| compliance-engine | `can_transfer` | — | — | Cross-contract: calls KYC registry |
| kyc-registry | `is_approved` | — | — | Single address lookup |
| kyc-registry | `get_record` | — | — | Full KycRecord struct |
| kyc-registry | `get_tier` | — | — | Single u32 lookup |
| invoice-token | `is_settled` | — | — | Boolean flag read |
| invoice-token | `get_meta` | — | — | Full InvoiceMeta struct |

Run the script above to populate this table with real values.

---

## Key observations

**Most expensive read: `can_transfer`**  
`can_transfer` on the compliance engine is the costliest read operation because
it makes a cross-contract call into the KYC registry to validate both parties.
Every token `transfer` call invokes `can_transfer` as part of its compliance
check, so optimizing this path has the highest leverage on overall transaction cost.

**Cheapest operations**  
Single-key reads (`is_approved`, `is_settled`, `holder_count`) are the
cheapest because they resolve a single persistent storage entry with no
cross-contract overhead.

**Struct reads**  
`get_rules`, `get_record`, and `get_meta` are more expensive than scalar reads
because they deserialize larger structs, but they remain well within the
per-transaction resource limits.

---

## Comparing over time

Commit this file after each report run. To see how costs changed:

```bash
git diff HEAD docs/gas-report.md
```

To compare two branches:
```bash
git diff main..feat/my-branch -- docs/gas-report.md
```

If `cpu_insns` grows significantly after a code change, examine whether new
cross-contract calls or additional storage reads were introduced.

---

## Running locally

```bash
# After deploying to testnet
bash scripts/gas-report.sh veritoken-dev testnet

# With a specific probe address (must have KYC approval)
PROBE_ADDRESS=G... bash scripts/gas-report.sh veritoken-dev testnet
```
