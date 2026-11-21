# Deployment and Verification Automation

The deployment suite turns the repository's contract configuration into an
auditable, dependency-ordered Stellar deployment. It is the canonical path for
testnet, standalone, and mainnet deployments.

The suite:

- validates every local WASM before submitting a transaction;
- uploads each artifact explicitly and requires the returned WASM hash to equal
  the local SHA-256;
- deploys contracts in dependency order;
- distinguishes constructor contracts from contracts that require a separate
  `initialize` invocation;
- writes a resumable checkpoint after every successful remote operation;
- verifies deployed code hashes, contract metadata, registry links, and
  configured read calls;
- updates `deploy-manifest.json` and `frontend/.env` atomically only after every
  verification check passes; and
- emits a machine-readable verification report for CI and audit retention.

No secret key, seed phrase, or RPC authentication header is accepted by the
configuration schema or written to a manifest. Signing remains delegated to a
Stellar CLI identity.

## Prerequisites

- Python 3.10 or newer (standard library only)
- Stellar CLI
- Rust and the repository's configured WASM target
- A funded Stellar identity for the selected network

The current Stellar CLI command and option reference is maintained in the
[Stellar CLI manual](https://developers.stellar.org/docs/tools/cli/stellar-cli).

## Testnet quick start

Create and fund an identity, then use the existing operator entry point:

```bash
bash scripts/setup-identity.sh veritoken-dev
bash scripts/deploy.sh veritoken-dev
```

`scripts/deploy.sh` still builds and validates the release artifacts first. It
then delegates upload, deployment, registration, and verification to the Python
orchestrator.

The default development config is
`deployment/config.testnet.json`. Its metadata values are valid contract
fixtures rather than rejected zero-value or empty placeholders.

## Example deployment bundles

[`deployment/examples/`](../deployment/examples/) contains a runnable,
single-asset-type bundle for each asset type (invoice, property, carbon
credit) — a smaller starting point than the combined testnet config above
when you only need one asset type. See
[`deployment/examples/README.md`](../deployment/examples/README.md) for the
common configuration points across bundles and how to adapt one to a real
environment and contract ID set.

## Commands

Print and validate the operation plan without contacting Stellar:

```bash
python3 scripts/deployment_cli.py plan \
  --config deployment/config.testnet.json \
  --network testnet
```

Deploy prebuilt artifacts:

```bash
DEPLOY_SKIP_BUILD=1 bash scripts/deploy.sh veritoken-dev
```

Resume an interrupted deployment:

```bash
DEPLOY_RESUME=1 bash scripts/deploy.sh veritoken-dev
```

Re-run verification without redeploying:

```bash
bash scripts/verify-deployment.sh veritoken-dev
```

The Python entry point exposes the same operations directly:

```bash
python3 scripts/deployment_cli.py deploy --help
python3 scripts/deployment_cli.py verify --help
python3 scripts/deployment_cli.py validate-manifest --help
python3 scripts/deployment_cli.py simulate-upgrade --help
```

## Command side effects

Each command below is classified from its implementation in
`scripts/deployment/cli.py`, `scripts/deployment/runner.py`, and the shell
wrappers. Only **read-only** commands are safe dry runs: they never submit a
transaction.

| Command | Effect | Network access | Identity needed | Files written |
|---|---|---|---|---|
| `deployment_cli.py plan` | Read-only | None | No | None (prints JSON to stdout) |
| `deployment_cli.py validate-manifest` | Read-only | None | No | None |
| `deployment_cli.py simulate-upgrade` (no `--identity`) | Read-only | None | No | Upgrade simulation report |
| `deployment_cli.py simulate-upgrade --identity <name>` | Read-only | Simulated `schema_version` call | Yes, as source account | Upgrade simulation report |
| `deployment_cli.py verify` / `verify-deployment.sh` | Read-only | `contract info hash`, `contract info meta`, configured health calls | Optional; defaults to the manifest's source account | Verification report |
| `scripts/check-drift.sh` | Read-only | None | No | None |
| `scripts/verify-artifacts.sh` | Build-only | None | No | None (checks existing WASM) |
| `deploy.sh` build step (`cargo build`, skipped with `DEPLOY_SKIP_BUILD=1`) | Build-only | None | No | `target/wasm32v1-none/release/*.wasm` |
| `deployment_cli.py deploy` / `deploy.sh` | **Submits transactions** | Upload, deploy, and `initialize` invokes | Yes, signs every transaction | Partial checkpoint, manifest, verification report, `frontend/.env` |
| `DEPLOY_RESUME=1 deploy.sh` | **Submits transactions** | Remaining upload, deploy, and `initialize` operations | Yes, must match the checkpoint | Same as `deploy` |
| `scripts/setup-identity.sh` | **Creates and funds a testnet account** | Friendbot (`testnet` only) | Generates a new local key | Stellar CLI key store |

Notes:

- `plan` performs every config, dependency-graph, and mainnet placeholder check
  that `deploy` does, but stops before any artifact preflight or Stellar CLI
  call. It does not check that WASM files exist.
- `verify` and live `simulate-upgrade` use `stellar contract invoke` without
  `--send`. With the Stellar CLI default, a call is only submitted when
  simulation shows it writes state or needs authorization. Configured
  `health_check` functions and `schema_version` are read-only getters, so these
  commands stay simulation-only. Do not point a `health_check` at a function
  that writes state.
- `deploy.sh` always runs the build-only steps (build unless
  `DEPLOY_SKIP_BUILD=1`, then `verify-artifacts.sh`) before the first
  transaction. A failure there stops the run with no network mutation.
- There is no dry-run flag for `deploy`. Use `plan` to review operations first.

### Identity and network selection

- **Identity:** pass a Stellar CLI identity name (never a secret key) as the
  first argument to `deploy.sh` / `verify-deployment.sh`, or with `--identity`.
  If neither is set, `deploy` falls back to `STELLAR_IDENTITY`, then `alice`.
  Confirm the identity before deploying with
  `stellar keys address <identity>`.
- **Network:** `--network`, or `STELLAR_NETWORK`, defaults to `testnet`. Set it
  explicitly for every transaction-submitting command. `mainnet` and `public`
  require a `production` profile config.
- **Custom RPC:** `--rpc-url` / `STELLAR_RPC_URL` is used only together with
  `--network-passphrase` / `STELLAR_NETWORK_PASSPHRASE`. If only one is set, the
  named network alias is used.
- `verify` reads the network from the manifest, not from `STELLAR_NETWORK`.

Example of a safe review before a testnet deployment:

```bash
export STELLAR_NETWORK=testnet

python3 scripts/deployment_cli.py plan \
  --config deployment/config.testnet.json \
  --network "$STELLAR_NETWORK"

stellar keys address veritoken-dev

bash scripts/deploy.sh veritoken-dev
```

## Upgrade simulation

Soroban contracts here are immutable — an "upgrade" is a full
snapshot-and-redeploy (see [`docs/incident-response.md`](incident-response.md)
§4), which is expensive to get wrong. `simulate-upgrade` models the outcome
of a candidate upgrade **offline**, before you spend a transaction on it:

```bash
python3 scripts/deployment_cli.py simulate-upgrade \
  --manifest deploy-manifest.json \
  --contract compliance_engine \
  --new-artifact target/wasm32-unknown-unknown/release/compliance_engine.wasm \
  --to-schema-version 2
```

It diffs the candidate WASM's exported function interface against the
currently deployed artifact (recorded in `--manifest`) and flags any
function that's present today but missing from the new build as a critical
risk — that's a breaking change for the frontend, SDK, or any other
contract that calls it. If `--to-schema-version` is given, it also checks
that value against the contract's own sequential-migration rule
(`to_version == current + 1`, enforced by `migrate_schema` on-chain).

By default the schema-version check is skipped (there's no live state to
compare against without a network call). Pass `--identity` to additionally
perform a **read-only** `schema_version` invoke against the deployed
contract and validate sequencing against live state — this never mutates
anything on-chain:

```bash
python3 scripts/deployment_cli.py simulate-upgrade \
  --manifest deploy-manifest.json \
  --contract compliance_engine \
  --new-artifact target/wasm32-unknown-unknown/release/compliance_engine.wasm \
  --to-schema-version 2 \
  --identity veritoken-dev --network testnet
```

The command exits non-zero and writes a JSON report (default
`upgrade-simulation-report.json`, override with `--report`) whenever a
critical risk is found — wire it into a pre-upgrade checklist or CI step
the same way `verify` is used after a deploy.

## Configuration model

A deployment config has a profile and a set of contract declarations:

```json
{
  "schema_version": 1,
  "profile": "development",
  "contracts": [
    {
      "name": "kyc_registry",
      "artifact": "${wasm_dir}/kyc_registry.wasm",
      "env_key": "VITE_KYC_REGISTRY_ID",
      "dependencies": [],
      "deployment_mode": "initialize",
      "initialize_function": "initialize",
      "initialize_args": {
        "admin": "${admin}"
      },
      "declared_metadata": {
        "package": "kyc-registry"
      },
      "health_check": {
        "function": "verifier_count",
        "expectation": "integer"
      }
    }
  ]
}
```

Supported templates are:

- `${admin}` and `${source_account}`: the public address resolved from the
  selected Stellar identity;
- `${contract.NAME}`: the contract ID produced for a named dependency; and
- `${wasm_dir}`: the artifact directory passed to the CLI.

Templates can appear in nested constructor or initializer metadata. Unknown
templates fail before the affected operation is submitted.

### Constructor and initializer modes

`deployment_mode: "constructor"` passes `constructor_args` after the Stellar
CLI `--` separator. A successful deploy is immediately considered initialized.

`deployment_mode: "initialize"` deploys the WASM instance with no constructor
arguments and then invokes `initialize_function` with `initialize_args`.
Checkpoints distinguish `uploaded`, `deployed`, and `initialized` stages, so an
initializer failure can be resumed without deploying another instance.

This distinction is required by the current suite: the KYC registry and
compliance engine expose initializer functions, while the asset contracts use
deploy-time constructors.

### Dependency ordering

The orchestrator topologically sorts contract declarations. Unknown
dependencies, self-dependencies, and cycles are rejected before a deployment
transaction. Resolved dependency IDs are stored in each contract record and
checked again during verification.

### Network-specific configuration fields

The table below lists every field in the deployment config schema and whether
its value should differ between testnet and mainnet. Fields marked
**environment-dependent** must be reviewed before promoting a config from one
environment to the other. Fields marked **shared** may be reused verbatim.

Secret values (private keys, seed phrases, funded account addresses) must
never appear in a config file — keep them in environment variables or the
Stellar CLI key store. See [docs/secret-safe-deployment.md](secret-safe-deployment.md)
and the [mainnet checklist](mainnet-deployment.md) before deploying to production.

| Field | Scope | Environment-dependent? | Notes |
|---|---|---|---|
| `schema_version` | root | Shared | Must equal `1`; rejected if mismatched |
| `profile` | root | **Yes** | `"development"` for testnet; `"production"` required for mainnet/public |
| `contracts[].name` | contract | Shared | Stable contract identifier used in dependency references |
| `contracts[].artifact` | contract | Shared | Template path; resolved at deploy time via `${wasm_dir}` |
| `contracts[].env_key` | contract | Shared | Frontend env variable written to `frontend/.env` |
| `contracts[].dependencies` | contract | Shared | Dependency names within the same config; order is derived automatically |
| `contracts[].deployment_mode` | contract | Shared | `"constructor"` or `"initialize"`; fixed per contract type |
| `contracts[].enabled` | contract | **Yes** | Omit or set `true` for production; use `false` only to skip a contract in one environment |
| `contracts[].constructor_args` / `initialize_args` | contract | **Yes** | Contain environment-specific addresses (`${admin}`, `${contract.NAME}`) and tunable parameters (see below) |
| `contracts[].declared_metadata` | contract | **Yes** | `"role"` is shared; `"fixture_*"` keys are testnet-only; `"release"` tag is mainnet-only |
| `contracts[].health_check` | contract | Shared | Function name and expectation are shared; args using `${contract.NAME}` resolve per environment |
| `initialize_args.rule_change_delay` | compliance_engine | **Yes** | `0` on testnet (instant rule changes for testing); `86400` (24 h) on mainnet |
| `initialize_args.admin` | any `initialize` contract | **Yes** | Resolves to the deploying identity's public address via `${admin}`; differs per environment |
| `constructor_args.admin` | any `constructor` contract | **Yes** | Same as above |
| `constructor_args.meta.*` (invoice, property, carbon) | asset contracts | **Yes** | Testnet uses fixture values (`"VERITOKEN-TEST-…"`); mainnet requires real legal/project data with no placeholders |
| `declared_metadata.release` | any contract (mainnet) | **Yes** | Set to the release tag (e.g. `"v1.0.0"`); mainnet placeholder gate rejects `<release-tag>` |
| `declared_metadata.fixture_*` | asset contracts (testnet) | Testnet only | Drop entirely from mainnet configs |

**Quick checklist when promoting testnet → mainnet:**

1. Set `profile` to `"production"`.
2. Replace every `"fixture_*"` metadata key with real values or remove it.
3. Replace `<release-tag>` in `declared_metadata.release` with the actual release tag.
4. Set `rule_change_delay` in compliance_engine `initialize_args` to `86400` (or your governance-approved value).
5. Set `enabled: false` (or remove) any contracts that are not part of this release.
6. Run `python3 scripts/deployment_cli.py plan --config … --network mainnet` to catch remaining placeholders before submitting any transaction.

### Mainnet profile

Mainnet aliases (`mainnet` and `public`) require a configuration whose
`profile` is `production`. Placeholder markers such as `<release-tag>`,
`PLACEHOLDER`, `TBD`, and `replace-me` are rejected before Stellar CLI is
called.

Start from `deployment/config.mainnet.example.json`, expand it with the asset
contracts required for the release, replace every placeholder, review the
result, and print the plan:

```bash
cp deployment/config.mainnet.example.json deployment/config.mainnet.json

python3 scripts/deployment_cli.py plan \
  --config deployment/config.mainnet.json \
  --network mainnet
```

The unedited example intentionally fails the mainnet placeholder gate.

## Transaction and commit phases

A deployment proceeds through these phases:

1. Parse the config and validate the dependency graph.
2. Preflight every artifact's path, WASM magic, SHA-256, and local contract
   metadata before the first network mutation.
3. Resolve the public source account.
4. Upload each WASM and compare the network-returned hash with the local hash.
5. Deploy and initialize contracts in dependency order.
6. Verify each local artifact, deployed code hash, local/deployed contract
   metadata, dependency registry link, and configured health call.
7. Atomically publish the canonical manifest and merge contract IDs into
   `frontend/.env`.

The previous canonical manifest and frontend environment remain untouched
until phase 6 passes in full.

## Checkpoints and recovery

The in-progress checkpoint is `deploy-manifest.partial.json` by default. It is
rewritten atomically after each successful upload, deployment, or initializer.

On failure:

- the previous `deploy-manifest.json` remains canonical;
- `frontend/.env` remains unchanged;
- the verification report is retained when verification ran; and
- the partial checkpoint records exactly how far the new run progressed.

Resume only with the same identity, public source address, network, config
hash, and local artifacts:

```bash
DEPLOY_RESUME=1 bash scripts/deploy.sh veritoken-dev
```

Before reusing a deployed checkpoint record, the orchestrator queries its
on-chain WASM hash. A changed identity, config, artifact, metadata hash,
network, or deployed code hash aborts the resume instead of mixing runs.

## Canonical manifest

`deploy-manifest.json` is a **generated verification and audit artifact**, not
an input configuration file. It is produced by the deployment orchestrator
after a run passes verification, and it is consumed by the
[manifest verifier](../deployment/scripts/verify-manifest.ts) and the
`verify` command. Do not hand-edit it, and do not treat it as a place to
configure a deployment — deployment inputs live in the config files described
under [Configuration model](#configuration-model).

`deploy-manifest.json` records these public deployment facts:

- schema version, deployment ID, generation, and timestamps;
- previous manifest SHA-256 for registry lineage;
- network selector and public source account;
- config path, profile, and hash;
- local artifact path, size, SHA-256, and contract metadata hash;
- uploaded WASM hash and deployed contract ID;
- constructor or initializer mode and resolved dependency IDs;
- completed lifecycle stage and operation timestamps;
- canonical contract-name-to-ID registry; and
- compatibility keys consumed by the existing drift checker.

Verification consumes these recorded facts to compare local artifacts against
on-chain state: it checks each local artifact's SHA-256 and metadata hash
against the manifest, then queries the deployed code hash and contract
metadata on-chain and compares them to the recorded values. A manifest that
does not match the artifacts or the chain fails verification rather than
being silently trusted.

The manifest deliberately excludes secret material. Signing secrets, seed
phrases, and secret keys must **never** appear in a generated manifest — the
manifest is public deployment evidence, not a secret store. Contract IDs,
public account addresses, WASM hashes, and transaction-independent metadata
are the only deployment facts it records. Keep signing material in the Stellar
CLI key store or environment variables as described in
[docs/secret-safe-deployment.md](secret-safe-deployment.md).

## Verification report

`deployment-verification-report.json` records one result per check with the
expected value, actual value, pass/fail status, deployment ID, manifest hash,
network, and aggregate totals.

Verification fails if any of these diverge:

- local artifact SHA-256 versus the manifest;
- uploaded/deployed WASM hash versus the local artifact;
- local versus deployed contract metadata hash;
- a dependency's recorded ID versus the canonical registry;
- a configured health call's output contract; or
- the existence and format of a referenced artifact.

The verifier uses `stellar contract info hash` for deployed code identity and
`stellar contract info meta` for declared contract metadata. It does not infer
success from a responsive contract ID alone.

### Post-deployment verification example

Verification is a separate, read-only step from deployment: it does not upload
WASM, deploy contracts, or rewrite `deploy-manifest.json` or `frontend/.env`.
Run it against a fresh deployment before handing contract IDs to anyone else.

The wrapper takes an optional identity as its only positional argument. The
manifest and report paths come from `DEPLOY_MANIFEST` and
`DEPLOY_VERIFICATION_REPORT`:

```bash
DEPLOY_MANIFEST=deploy-manifest.json \
DEPLOY_VERIFICATION_REPORT=deployment-verification-report.json \
  bash scripts/verify-deployment.sh veritoken-dev
```

The equivalent direct invocation:

```bash
python3 scripts/deployment_cli.py verify \
  --manifest deploy-manifest.json \
  --report deployment-verification-report.json \
  --identity veritoken-dev
```

`verify` has no `--network` flag. The network (name, and RPC URL/passphrase
for custom networks) is read from the manifest, so point `--manifest` at the
manifest produced for the network you intend to check. `--identity` only
overrides the source-account identity recorded in the manifest and is used for
read-only calls; it never needs a secret key in the command line.

The command writes the report, then prints a one-line summary and the report
path. Illustrative output from a passing run:

```text
Deployment verification passed: 42 passed, 0 failed.
Verification report: /path/to/repo/deployment-verification-report.json
Deployment verified.
```

The final `Deployment verified.` line is printed by the shell wrapper only. On
any failed check the command exits `1` and prints
`Deployment verification failed: <n> passed, <m> failed.` instead.

An abridged, illustrative report is shown below. Contract IDs, hashes, and
counts are placeholders, not values from a real deployment:

```json
{
  "schema_version": 1,
  "status": "passed",
  "generated_at": "2025-01-01T00:00:00Z",
  "deployment_id": "<deployment-id>",
  "manifest_sha256": "<sha256-of-manifest>",
  "network": { "name": "testnet" },
  "checks": [
    {
      "contract": "kyc_registry",
      "check": "deployed_wasm_hash",
      "status": "passed",
      "expected": "<local-wasm-sha256>",
      "actual": "<local-wasm-sha256>"
    },
    {
      "contract": "compliance_engine",
      "check": "dependency_registry",
      "status": "passed",
      "expected": "<kyc-registry-contract-id>",
      "actual": "<kyc-registry-contract-id>"
    }
  ],
  "summary": { "total": 42, "passed": 42, "failed": 0 }
}
```

Hand over contract IDs only when `status` is `passed` and `summary.failed` is
`0`. A failed check carries a `detail` field where available; fix the cause and
re-run `verify` rather than redeploying blindly.

## Environment variables

| Variable | Purpose |
|---|---|
| `STELLAR_NETWORK` | Stellar CLI network alias; default `testnet` |
| `STELLAR_RPC_URL` | Custom RPC URL; requires `STELLAR_NETWORK_PASSPHRASE` |
| `STELLAR_NETWORK_PASSPHRASE` | Passphrase paired with a custom RPC URL |
| `STELLAR_BIN` | Alternate Stellar CLI executable |
| `PYTHON_BIN` | Alternate Python 3 executable |
| `WASM_DIR` | Release artifact directory |
| `DEPLOY_CONFIG` | Deployment config path |
| `DEPLOY_MANIFEST` | Canonical manifest path |
| `DEPLOY_VERIFICATION_REPORT` | Verification report path |
| `FRONTEND_ENV_FILE` | Frontend environment file to merge |
| `DEPLOY_SKIP_BUILD=1` | Reuse already-built artifacts |
| `DEPLOY_RESUME=1` | Resume the matching partial checkpoint |

## Tests

The suite uses only Python's standard library:

```bash
PYTHONPATH=scripts python3 -m unittest discover \
  -s scripts/deployment/tests -v
```

Fixture tests cover dependency ordering, constructor and initializer paths,
atomic registry publication, interrupted-run recovery, missing artifacts,
remote code-hash drift, metadata mismatch, mainnet gating, template
resolution, and CLI argument encoding.
