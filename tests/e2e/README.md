# Veritoken E2E test suite

Playwright browser tests for the frontend, running against a real, freshly
deployed set of contracts on a local Stellar standalone node — not against
mocked RPC responses.

## Prerequisites

- Docker running locally (or in CI).
- Contract WASMs built:
  ```
  cargo build --target wasm32v1-none --release \
    -p kyc-registry -p compliance-engine -p rwa-token \
    -p invoice-token -p property-token -p carbon-credit-token
  ```
- Dependencies installed in **three** packages (they're independent installs,
  matching the existing `tests/integration` convention — see "Why a separate
  stellar-sdk import" below):
  ```
  (cd frontend && npm ci)
  (cd tests/integration && npm ci)
  (cd tests/e2e && npm ci && npx playwright install --with-deps chromium)
  ```

## Running

```
cd tests/e2e
npm test                 # headless, all specs
npm run test:headed      # headed, for debugging
npm run test:ui          # Playwright's UI mode
npm run report           # open the last HTML report
```

`playwright.config.ts`'s `globalSetup` (`global-setup.ts`) does the heavy
lifting before any spec runs: checks Docker is reachable, starts a
`stellar/quickstart:latest --standalone` container, waits for its RPC to
report healthy, deploys all six contracts via
`tests/integration/fixtures/fixture-plans.ts`'s `fullDeploymentPlan()`
(reusing the exact deploy plans/transport the integration suite uses),
writes the resulting contract IDs to `fixtures/contract-ids.json` and
`frontend/.env.e2e.local`, and only then starts the Vite dev server
(`--mode e2e`) itself and waits for it to answer.

There's no `webServer` entry in `playwright.config.ts` — `global-setup.ts`
starts the dev server directly, as its own last step, instead. Playwright
runs a configured `webServer`'s setup *before* `globalSetup`, not after (see
the comment at the top of `global-setup.ts`), so a `webServer` block can't
be made to wait for contracts that don't exist yet without deadlocking.
`global-teardown.ts` stops both the dev server and the container afterward
(set `E2E_KEEP_STANDALONE=true` to leave the container running for
debugging).

## Visual regression baselines

`specs/visual-regression.spec.ts`'s screenshots need baseline PNGs committed
under `__screenshots__/` before `toHaveScreenshot()` can pass. Generate them
once, on a machine with Docker and Playwright's browsers installed:

```
npm run update-snapshots
git add __screenshots__
```

Nothing in this repo can generate these without a real browser + a live
standalone node, so they aren't included yet. Until they are,
`visual-regression.spec.ts` **skips itself** (checks whether
`__screenshots__/` has any `.png` in it) rather than fail every CI run for a
reason this suite can't fix on its own — the Playwright report will show
those 3 tests as skipped, not passed, until someone runs
`update-snapshots` and commits the baselines. That's a real gap in the
acceptance criteria ("visual regression snapshots are committed and checked
on every PR") until it's done — it isn't optional, just deferred to
whoever has Docker + a browser to run this on next.

## Test independence

Every spec deploys nothing itself — all six contracts are deployed **once**
per run in `global-setup.ts`, not per test. Redeploying them per test (each
deploy uploads WASM + waits for ledger close) would blow the 15-minute CI
budget many times over. Instead:

- Every spec uses its own fresh, never-reused keypair (see
  `fixtures/accounts.ts`'s per-spec labels) for anything address-scoped —
  KYC records, token balances, blocklist entries — so no spec's outcome
  depends on another spec's side effects.
- Two actions mutate genuinely global contract state and are each touched by
  exactly one spec: `invoice-lifecycle.spec.ts` is the only spec that calls
  `settle()` (the single deployed invoice's settlement flag has no
  "unsettle"), and `admin-roles.spec.ts` never mutates compliance rules or
  pause state at all (see "Known frontend gaps" below) — it only reads the
  role-gate, so nothing there needs cleanup.
- `playwright.config.ts` runs fully serially (`workers: 1`) rather than
  relying on test-level locking around that shared state.

## Known frontend gaps

Investigating this suite surfaced a few places where the app doesn't yet do
what a first read of the ticket implies. Each is called out at the top of
the affected spec file too:

- **KYC "Approve KYC" button** (`KycPage.tsx`) is a stub — it only shows a
  toast, it never calls `kyc.approve`. `kyc.spec.ts` approves on-chain
  directly (`fixtures/chain-helpers.ts`'s `approveKyc`) and asserts on the
  dashboard's read-only KYC panel, which *is* wired to `kyc.getRecord`.
- **Batch page execution** (`BatchPage.tsx`) builds a
  `placeholder-xdr:${op.type}:${op.target}` string instead of a real
  transaction (explicit `// TODO` at `BatchPage.tsx:136-138`) — clicking
  Execute can only ever fail. `batch-transfer.spec.ts` covers the part
  that's real: building the operation queue.
- **No "assign compliance role" UI.** `roleStore.ts` derives role
  client-side only (verifier-list membership → `"verifier"`, else KYC tier
  ≥ 2 → `"admin"`), and this heuristic doesn't line up with on-chain
  authorization — the actual contract admin is also enrolled as a KYC
  verifier, so it always resolves to `"verifier"` and can never pass
  `/admin`'s `<AdminOnly>` gate itself. `admin-roles.spec.ts` tests the
  view-level role gate, which is the part of this that's real and
  self-consistent; see the comment at the top of that file.
- **No "create invoice" UI.** The one invoice's metadata is set once, in the
  invoice-token contract's constructor (see the `invoice` fixture step),
  not through any interactive flow — `invoice-lifecycle.spec.ts` starts from
  that pre-existing invoice.
- Contract error messages reaching toasts are **not** decoded to
  human-readable text on every path — e.g. `CarbonPage.tsx`'s transfer
  handler surfaces the SDK's raw `Simulation error calling transfer:
  Error(Contract, #N)` as-is. `compliance-gate.spec.ts` asserts on that raw
  shape rather than a friendly message that doesn't exist yet.

## Why a separate `@stellar/stellar-sdk` import (`fixtures/stellar-sdk.ts`)

`global-setup.ts` and `fixtures/chain-helpers.ts` call directly into
`tests/integration/fixtures/*.ts` and pass its functions `Keypair`/
`rpc.Server`/`xdr.ScVal` values. If this package also had its own
`@stellar/stellar-sdk` install, TypeScript would treat the two
independently-installed copies as distinct nominal types (private class
fields don't structurally match across separate installs) and every one of
those calls would fail to typecheck despite being runtime-identical.

Instead, `npm install`'s `postinstall` (`scripts/link-stellar-sdk.mjs`)
symlinks `node_modules/@stellar/stellar-sdk` to `tests/integration`'s
install — run `npm ci` there first, or this postinstall fails fast with that
instruction. Every file in this package that needs the SDK imports it from
`fixtures/stellar-sdk.ts`, a one-line re-export, so the whole package stays
on tests/integration's one physical install both for `tsc` and at runtime.

## Freighter wallet mocking

See the comment at the top of `fixtures/freighter-shim.ts` — in short, the
frontend imports named functions from `@stellar/freighter-api` rather than
calling a `window.freighter` API surface, and that package talks to the real
extension over an undocumented `postMessage` protocol. `vite.config.ts`
aliases `@stellar/freighter-api` to `frontend/src/testing/freighterApiMock.ts`
only in `--mode e2e`; that mock signs locally with whatever keypair
`installFreighterWallet()` injected via `window.__VERITOKEN_E2E_WALLET__`.
