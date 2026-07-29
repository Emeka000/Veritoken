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
```

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

`deploy-manifest.json` includes:

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

The manifest deliberately excludes secret material. Contract IDs, public
account addresses, WASM hashes, and transaction-independent metadata are
public deployment evidence.

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
