# Soroban integration fixtures

The lifecycle suite runs against a local Stellar quickstart node, but contract
deployment is managed by reusable fixture plans rather than being repeated in
each test file.

## Run

From this directory:

```bash
npm install
npm run typecheck
npm run test:unit
```

For the live lifecycle suite, first build the contracts and start quickstart:

```bash
# From the repository root
cargo build --release --target wasm32-unknown-unknown
docker compose up -d

# From tests/integration
npm run test:lifecycle
```

`STELLAR_RPC_URL`, `STELLAR_POLL_INTERVAL_MS`, and
`STELLAR_TRANSACTION_TIMEOUT_MS` can override the local defaults.

## Add a fixture

1. Add a dependency-ordered plan to `fixtures/fixture-plans.ts`.
2. Declare every earlier contract needed by a step in `dependsOn`.
3. Build constructor arguments from the `FixtureContext`; deployed contract IDs
   are available through `context.contract(name)`.
4. Put one-time initialization in `afterDeploy`.
5. Use `beforeEach` and `runner.setup(plan)` so every test receives fresh
   contract state, then call `runner.teardown` from `afterEach`.

WASM uploads are cached only within the process. Contract deployments always
use a new deterministic salt derived from the fixture run ID and step name.
Failed setup releases all in-memory fixture state, and the next setup run uses a
new ID, so a deployment or RPC error does not poison later tests.
