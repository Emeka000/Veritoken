# Contract Size Budget

Every Soroban contract in this repository has an enforced maximum WASM binary
size. The budget is checked automatically in CI on every push and pull request,
and can also be run locally.

---

## Why a size budget?

- Soroban charges per byte of uploaded WASM. Smaller contracts cost less to
  deploy and upgrade.
- A hard limit forces early detection of accidental size regressions (unused
  dependencies, bloated constants, etc.) before they reach production.
- A documented budget makes the trade-off explicit when a new feature genuinely
  needs more space.

---

## Current budgets

| Contract WASM | Budget |
|---|---|
| `kyc_registry.wasm` | 200 KB |
| `compliance_engine.wasm` | 200 KB |
| `rwa_token.wasm` | 256 KB |
| `invoice_token.wasm` | 256 KB |
| `property_token.wasm` | 256 KB |
| `carbon_credit_token.wasm` | 200 KB |
| `token_helpers.wasm` | 64 KB |
| _(any other .wasm)_ | 256 KB (default) |

Budgets include ~20 % headroom above the baseline measured binary size.

---

## Checking sizes locally

Build first, then run the check script:

```bash
cargo build --release --target wasm32-unknown-unknown
bash scripts/check-wasm-size.sh
```

To print sizes without enforcing limits (useful when measuring a new baseline):

```bash
bash scripts/check-wasm-size.sh --print-sizes
```

---

## CI integration

The `rust` job in `.github/workflows/ci.yml` runs the check script after every
release WASM build. A contract that exceeds its budget fails CI immediately,
preventing the oversized binary from being merged.

---

## Reducing binary size

If a contract grows beyond its budget, try the following in order:

1. **Remove unused dependencies** — audit `Cargo.toml` for crates that are no
   longer needed.
2. **Profile release settings** — confirm `Cargo.toml` (workspace root) has:
   ```toml
   [profile.release]
   opt-level = "z"
   lto = true
   codegen-units = 1
   strip = "symbols"
   ```
3. **`wasm-opt`** — run `wasm-opt -Oz <file>.wasm -o <file>.wasm` from the
   [binaryen](https://github.com/WebAssembly/binaryen) toolchain.
4. **Review data** — large string literals and look-up tables are a common
   source of bloat in no-std WASM.
5. **Split the contract** — if the feature genuinely requires more code,
   consider whether it belongs in a helper library or a separate contract.

---

## Raising a budget

If the growth is intentional and unavoidable:

1. Update the `BUDGETS` table in `scripts/check-wasm-size.sh`.
2. Update the table in this file.
3. Add a dated entry to the *Budget history* section below explaining why.
4. Open a PR — the change will be reviewed alongside the feature that caused it.

---

## Budget history

| Date | Contract | Old budget | New budget | Reason |
|---|---|---|---|---|
| 2026-07-28 | all | — | initial | Initial size budget established |
