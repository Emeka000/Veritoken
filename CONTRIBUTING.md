# Contributing to Veritoken

Thanks for your interest in contributing. Veritoken is a Soroban smart contract toolkit for RWA tokenization on Stellar — contributions of all kinds are welcome.

---

## Prerequisites

- Rust (stable)
- `wasm32v1-none` target: `rustup target add wasm32v1-none` (pinned in
  `rust-toolchain.toml`, so `rustup` usually installs it automatically)
- [Stellar CLI](https://developers.stellar.org/docs/tools/developer-tools/cli/stellar-cli)
- Node.js ≥ 20 (for frontend work)

---

## Setup

```bash
git clone https://github.com/abore9769/Veritoken
cd Veritoken
```

### Contracts

```bash
# Check all contracts compile
cargo check --target wasm32v1-none

# Run tests
cargo test --features testutils

# Build WASM artifacts (output: target/wasm32v1-none/release/)
cargo build --release --target wasm32v1-none
```

> **Which wasm target?** Local builds and CI both use `wasm32v1-none`, the
> target pinned in `rust-toolchain.toml`. Older guides that mention
> `wasm32-unknown-unknown` are out of date — artifacts built with that target
> land in a different directory and are not picked up by the size or
> deployment scripts. See
> [docs/troubleshooting.md](docs/troubleshooting.md#wasm-target-name-mismatch-wasm32v1-none-vs-wasm32-unknown-unknown).

### Frontend

```bash
cd frontend
cp .env.example .env   # fill in your deployed contract IDs
npm install
npm run dev
```

### Test commands by area

Run the narrowest suite that covers your change. Cargo commands run from the
repository root; npm commands run from the directory in the **Working dir**
column. Contract crates expose Soroban test helpers behind the `testutils`
feature, so pass `--features testutils` where shown (the smoke crate has no
such feature and must be run without it). None of these commands need
credentials or a funded account.

| Area | Kind | Working dir | Command |
| --- | --- | --- | --- |
| Single contract (e.g. `rwa-token`, `kyc-registry`, `compliance-engine`, `invoice-token`, `property-token`, `carbon-credit-token`, `token-helpers`) | Unit | repo root | `cargo test -p rwa-token --features testutils` |
| All contracts and Rust test crates | Unit + integration | repo root | `cargo test --features testutils` |
| Cross-contract integration suite | Integration | repo root | `cargo test -p integration-tests --features testutils` |
| Smoke tests | Integration | repo root | `cargo test -p smoke-tests` |
| Property-based fuzz tests | Integration | repo root | `cargo test -p fuzz-tests --features testutils` |
| Dividend regression tests | Integration | repo root | `cargo test -p dividend-regression-tests --features testutils` |
| SDK | Unit | `sdk/` | `npm test` |
| SDK (from repo root) | Unit | repo root | `npm run test:sdk` |
| Frontend (all) | Unit | `frontend/` | `npm test` |
| Frontend (one file) | Unit | `frontend/` | `npx vitest run src/lib/__tests__/drafts.test.ts` |
| Integration fixtures (no network) | Unit | `tests/integration/` | `npm run test:unit` |
| Lifecycle against local quickstart | Integration | `tests/integration/` | `npm run test:lifecycle` (requires `cargo build --release --target wasm32-unknown-unknown` and `docker compose up -d` first) |
| Browser end-to-end | Integration | `tests/e2e/` | `npm test` (requires Docker and built WASMs; see `tests/e2e/README.md`) |

Install dependencies once with `npm install` from the repository root (covers
the `frontend` and `sdk` workspaces); `tests/integration` and `tests/e2e` are
separate installs inside their own directories.

---

## Making Changes

All incoming issues and pull requests must conform to the new template files. See our [Issue Triage Workflow](.github/triage-workflow.md) for more details.

1. Fork the repo and create a feature branch: `git checkout -b feat/your-feature`
2. Make your changes
3. Ensure the following pass before opening a PR:
   ```bash
   cargo fmt --check
   cargo clippy --target wasm32v1-none
   cargo test --features testutils
   ```
4. For frontend changes: `npm run build` and `npm run lint` must pass
5. For shell script changes, syntax-check every changed script (see
   [Shell script checks](#shell-script-checks))
6. Open a pull request against `main` with a clear description of what and why

---

## Shell script checks

Shell scripts under `scripts/` and `deployment/` drive deployment and admin
workflows, so syntax errors should be caught before review rather than during
a deploy. `bash -n` parses a script without executing it — it needs no
secrets, network access, or Stellar identity.

Check the scripts you changed:

```bash
git diff --name-only --diff-filter=d origin/main -- '*.sh' | xargs -r -n1 bash -n
```

Or check every tracked script (the same command CI runs in the
`Deployment automation suite` workflow):

```bash
git ls-files -z '*.sh' | xargs -0 -r -n1 bash -n
```

No output means every script parsed successfully. `bash -n` catches syntax
errors only; it does not run the script or validate its logic.

---

## Checking Documentation Links

The repository does not run an automated Markdown link checker in CI. When you
change a Markdown file, check the relative links it contains by hand, using
this procedure (no extra tools required).

1. List the Markdown files you changed:

   ```bash
   git diff --name-only --diff-filter=d origin/main -- '*.md'
   ```

2. For each file, list its relative links. External `http(s)://` and
   `mailto:` links and bare `#anchor` links are skipped:

   ```bash
   file=docs/troubleshooting.md   # replace with a changed file
   grep -oE '\]\([^)]+\)' "$file" \
     | sed -E 's/^\]\(//; s/\)$//' \
     | grep -vE '^(https?:|mailto:|#)' \
     | sed -E 's/#.*$//' \
     | sort -u
   ```

3. Confirm each target exists, resolved relative to the file's directory.
   Paths that begin with `/` are relative to the repository root:

   ```bash
   dir=$(dirname "$file")
   grep -oE '\]\([^)]+\)' "$file" | sed -E 's/^\]\(//; s/\)$//' \
     | grep -vE '^(https?:|mailto:|#)' | sed -E 's/#.*$//' | sort -u \
     | while read -r target; do
         [ -z "$target" ] && continue
         case "$target" in /*) path=".${target}" ;; *) path="$dir/$target" ;; esac
         [ -e "$path" ] || echo "broken: $file -> $target"
       done
   ```

   No output means every relative link in that file resolves. Anchors
   (`#section`) are not verified; check them by hand when you rename a heading.

Only check the links in pages you touched. Do not fix unrelated broken links
in the same pull request unless you were asked to.

## Contract Size Budget

Every contract in this repository has a documented maximum WASM binary size.
CI enforces these limits automatically after every release build.

Before adding a new feature to an existing contract, check the current binary
size:

```bash
cargo build --release --target wasm32v1-none
bash scripts/check-wasm-size.sh --print-sizes
```

If your change causes a contract to exceed its budget, you must either reduce
the size (remove unused code/deps, rely on workspace profile settings) or
explicitly raise the budget by updating `scripts/check-wasm-size.sh` and
`docs/contract-size-budget.md` in the same PR with a justification.

See [docs/contract-size-budget.md](docs/contract-size-budget.md) for the full
policy, current limits, and reduction techniques.

---

## Documentation Maintenance Checklist

When your change touches the items below, update only the documents listed
next to it. Do not edit unrelated pages just because they mention the same
area.

| If you change… | Check these canonical documents |
| --- | --- |
| Contract public functions, signatures, or errors | [docs/contract-api-reference.md](docs/contract-api-reference.md), [CHANGELOG.md](CHANGELOG.md) |
| Contract storage keys or layout | [docs/storage-layout.md](docs/storage-layout.md), [docs/storage-patterns.md](docs/storage-patterns.md) |
| Contract WASM size or budgets | [docs/contract-size-budget.md](docs/contract-size-budget.md) |
| SDK API or usage | [sdk/README.md](sdk/README.md), [sdk/VERSIONING.md](sdk/VERSIONING.md) |
| Frontend env variables or setup | [CONTRIBUTING.md](CONTRIBUTING.md) (Frontend setup), [README.md](README.md) |
| Deployment scripts or steps | [docs/deployment-automation.md](docs/deployment-automation.md), [docs/mainnet-deployment.md](docs/mainnet-deployment.md), [deployment/scripts/README.md](deployment/scripts/README.md) |
| Test commands or test suites | [CONTRIBUTING.md](CONTRIBUTING.md) (Test commands by area), [tests/integration/README.md](tests/integration/README.md), [tests/e2e/README.md](tests/e2e/README.md) |
| Security-sensitive logic (auth, transfers, storage) | [docs/security-checklist.md](docs/security-checklist.md) |
| Common failures or fixes | [docs/troubleshooting.md](docs/troubleshooting.md) |

Update only the rows that your change affects.

### Small documentation fixes

Doc-only corrections are a good way to contribute. A few checks keep them
accurate and easy to review:

- **Verify behavior claims** against the source code or the canonical API
  docs (for example [docs/contract-api-reference.md](docs/contract-api-reference.md))
  rather than relying on memory or older guides.
- **Check relative links** in the pages you touched, following
  [Checking Documentation Links](#checking-documentation-links).
- **Check code snippets** — commands, paths, and function signatures should
  match what the code actually does.
- **Use consistent terminology** with the rest of the docs (for example
  `wasm32v1-none`, not `wasm32-unknown-unknown`).
- Doc-only changes generally do not need a full software build; run the
  checks relevant to what you edited.

## Good First Issues

Look for issues labelled [`good first issue`](https://github.com/abore9769/Veritoken/issues?q=label%3A%22good+first+issue%22) — these are scoped to be approachable without deep familiarity with the full codebase.

---

## Versioning

Veritoken uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Version numbers apply to the contract suite as a whole.

| Change type | Version bump |
|---|---|
| Breaking change to a public contract function (rename, remove, change signature) | **Major** (e.g. `0.1.0` → `1.0.0`) |
| New public function added to any contract | **Minor** (e.g. `0.1.0` → `0.2.0`) |
| Bug fix with no ABI change | **Patch** (e.g. `0.1.0` → `0.1.1`) |

When opening a PR that bumps the version:

1. Update the `version` field in every `contracts/*/Cargo.toml`
2. Add an entry to `CHANGELOG.md` under a new `[x.y.z]` section following the [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) format
3. After the PR merges, tag the commit: `git tag vx.y.z && git push origin vx.y.z`

Breaking changes (major bumps) must be discussed in an issue before implementation.

---

## Questions

Open an [issue](https://github.com/abore9769/Veritoken/issues) or start a discussion on GitHub. For significant changes, open an issue first to align on approach before writing code. Please use the appropriate [issue template](.github/ISSUE_TEMPLATE/) when creating new issues.

---

## Troubleshooting

If you run into problems with environment setup, contract deployment, wallet
connection, or CI, see [docs/troubleshooting.md](docs/troubleshooting.md) for
symptoms, causes, and concrete fixes.

---

## Security Review

Before submitting changes that touch authorization logic, storage keys, or
transfer flow, work through the [Security Review Checklist](docs/security-checklist.md).
It is specific to the current architecture and covers the most common findings
in Soroban contract reviews.
