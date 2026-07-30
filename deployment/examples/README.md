# Example Deployment Bundles

This directory contains **runnable, single-asset-type deployment bundles** that
contributors can copy and adapt as a starting point for a real deployment.
Unlike [`deployment/config.testnet.json`](../config.testnet.json) (which
deploys every asset type at once as a shared testnet fixture), each bundle
here deploys only the infrastructure a single asset type needs:

| Bundle | Deploys | Contract entries |
| --- | --- | --- |
| [`invoice/config.json`](invoice/config.json) | Invoice-backed RWA token | `kyc_registry` → `compliance_engine` → `invoice_token` |
| [`property/config.json`](property/config.json) | Fractionalized real-estate token | `kyc_registry` → `compliance_engine` → `property_token` |
| [`carbon-credit/config.json`](carbon-credit/config.json) | Carbon credit token | `kyc_registry` → `compliance_engine` → `carbon_credit_token` |

Each file is a complete, schema-valid `DeploymentConfig` (see
[`docs/deployment-automation.md`](../../docs/deployment-automation.md) for the
full config reference) — you can deploy one directly:

```bash
# From the repository root, after building the WASM artifacts:
python3 -m scripts.deployment.cli deploy \
  --config deployment/examples/invoice/config.json \
  --network testnet \
  --identity alice
```

## What's common across every bundle

Every bundle follows the same shape, because every asset token contract
depends on the same two policy contracts:

1. **`kyc_registry`** — deployed with `deployment_mode: "initialize"` and no
   constructor dependencies. Provides identity/verification state to the rest
   of the stack.
2. **`compliance_engine`** — also `"initialize"` mode, depends on
   `kyc_registry` (referenced via the `${contract.kyc_registry}` template) and
   takes `rule_change_delay` (seconds a proposed rule change must wait before
   it activates; `0` in these examples for fast local iteration).
3. **The asset token** — deployed with `deployment_mode: "constructor"`,
   depends on both policy contracts, and takes a `meta` object whose shape is
   specific to the asset type (see below). Every asset token also declares a
   `health_check` that reads back a value from the freshly deployed contract
   to confirm it initialized correctly.

Placeholders you'll see throughout (resolved automatically by the
orchestrator — see `resolve_value` in
[`scripts/deployment/orchestrator.py`](../../scripts/deployment/orchestrator.py)):

- `${wasm_dir}` — resolved to `--wasm-dir` (defaults to
  `target/wasm32-unknown-unknown/release`).
- `${admin}` — resolved to the public address of `--identity`.
- `${contract.<name>}` — resolved to the deployed contract ID of a dependency
  once it's live.

## Adapting a bundle to a real environment

1. **Copy the bundle** rather than editing it in place, e.g.
   `cp -r deployment/examples/invoice deployment/my-invoice-deployment`.
2. **Replace every asset-specific `meta` field.** The `EXAMPLE-*` IDs,
   fictitious issuer/debtor/property/project names, and placeholder hashes
   must be replaced with real values before this is anything other than a
   throwaway fixture:
   - Invoice (`invoice_token.constructor_args.meta`): `invoice_id`, `issuer`,
     `debtor`, `face_value_usd`, `discount_rate_bps`, `due_date` (unix
     timestamp), `currency`, `ipfs_doc_hash`, `transfer_fee_bps`,
     `fee_recipient`, `notification_webhook`.
   - Property (`property_token.constructor_args.meta`): `property_id`,
     `legal_name`, `jurisdiction`, `address`, `total_valuation_usd`,
     `total_shares`, `property_type` (`residential`|`commercial`|`land`),
     `ipfs_title_hash`, `kyc_tier_required`.
   - Carbon credit (`carbon_credit_token.constructor_args.meta`):
     `project_id`, `standard` (`VCS`|`Gold Standard`|`CDM`|`ACR`),
     `vintage_year` (1990–2050), `project_name`, `project_type`, `country`,
     `verifier`, `ipfs_cert_hash`, `registry_url`, `registry_project_id`.
3. **Set the matching `health_check.args`** if the asset identifier used in
   the `meta` block changes (the invoice bundle's health check passes
   `invoice_id` explicitly; keep it in sync with `meta.invoice_id`).
4. **Choose a `profile`.** These examples use `"development"`. For a
   production deployment, set `"profile": "production"` and follow
   [`docs/mainnet-deployment.md`](../../docs/mainnet-deployment.md) — the
   loader rejects placeholder-looking values (`<...>`, `todo`, `changeme`,
   etc.) on any network named `mainnet`/`public`, so you can't accidentally
   ship one of these examples unmodified.
5. **Pick a contract ID set.** Point `env_key` values (`VITE_*`) at whichever
   frontend environment file you intend to populate — the orchestrator writes
   the resolved contract IDs into `--frontend-env` (defaults to
   `frontend/.env`) once deployment and verification succeed. If you're
   deploying more than one asset type into the same environment, merge the
   `contracts` arrays from multiple bundles into one config (topological
   dependency ordering is handled automatically) rather than running each
   bundle separately against the same identity/network — otherwise you'll
   deploy duplicate `kyc_registry`/`compliance_engine` instances.

## Validating a bundle before deploying

Every bundle can be structurally validated **offline** — no Soroban CLI,
network access, or built WASM required — with the `plan` command, which loads
and validates the config (schema, dependency graph, template references) and
prints the dependency-ordered operation plan:

```bash
python3 -m scripts.deployment.cli plan \
  --config deployment/examples/property/config.json \
  --network testnet
```

A non-zero exit / `DeploymentError` means the bundle's structure or templates
don't match what the current contract interfaces expect (e.g. a renamed
constructor field or a missing dependency) — re-run `plan` after adapting a
bundle to catch mistakes before spending a real transaction fee. To confirm
the `meta` fields still match a contract's constructor after a contract
change, cross-check against the corresponding `__constructor`/`meta` struct
in `contracts/<asset>/src/lib.rs`.
