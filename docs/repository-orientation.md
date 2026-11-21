# Repository Orientation

A one-page map of the repository for new contributors. Use it to find where
things live and to pick safe first commands. It does not replace the setup
instructions in [`README.md`](../README.md) or
[`CONTRIBUTING.md`](../CONTRIBUTING.md) — read those for full environment
setup.

## Folder map

| Path | Purpose |
| --- | --- |
| `contracts/` | Rust smart contracts (Soroban). Core on-chain logic and contract tests. |
| `frontend/` | Web application (TypeScript/React). UI that talks to the contracts and SDK. |
| `sdk/` | Client SDK (TypeScript) for interacting with the contracts. |
| `tests/` | Integration and end-to-end tests spanning contracts, SDK, and frontend. |
| `scripts/` | Developer and CI helper scripts (build, deploy, codegen, lint). |
| `deployment/` | Deployment tooling and configuration for networks and environments. |
| `docs/` | Documentation, including this guide and the area-specific guides below. |
| `.github/` | CI workflows, issue/PR templates, and repository automation. |

## Where to go next

- **Contracts:** see the contract guide in [`docs/`](./) and the contract
  sources under [`contracts/`](../contracts/).
- **Frontend:** see the frontend guide in [`docs/`](./) and the app under
  [`frontend/`](../frontend/).
- **SDK:** see the SDK guide in [`docs/`](./) and the sources under
  [`sdk/`](../sdk/).
- **Deployment:** see the deployment guide in [`docs/`](./) and the tooling
  under [`deployment/`](../deployment/).
- **Testing:** see the testing guide in [`docs/`](./) and the suites under
  [`tests/`](../tests/).

## First commands

Start with the offline commands; they need no external services. Run the
service-dependent commands only after you have a local node or Docker
available.

### Offline (no node or Docker required)

```sh
# Rust contract tests
cargo test --features testutils

# Frontend unit tests
cd frontend && npm test

# SDK unit tests
cd sdk && npm test
```

### Requires a local node or Docker

```sh
# Integration / end-to-end tests (need a running local node)
# See the testing guide in docs/ for the exact invocation.

# Deployment tooling (needs a target network or local Docker environment)
# See the deployment guide in docs/ for the exact invocation.
```

If a command fails because a service is missing, check the testing or
deployment guide before assuming a setup problem.