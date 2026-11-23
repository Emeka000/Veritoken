# @veritoken/sdk

TypeScript SDK for the Veritoken smart contract suite on Stellar Soroban. It
wraps every contract in a typed client, resolves network configuration
(testnet / mainnet / futurenet / a local standalone node) from one place, and
gives you a typed error model and event parser instead of raw Soroban XDR.

This document is the getting-started guide and usage reference. For the full
public method / data-structure / error-code reference across all six
contracts, see [../docs/contract-api-reference.md](../docs/contract-api-reference.md).
For runnable, end-to-end examples (including this SDK vs. raw JS/Python), see
[../docs/examples/](../docs/examples/).

## Contents

- [Install](#install)
- [Getting started](#getting-started)
- [Network configuration](#network-configuration)
- [Building clients: `createClients` / `ClientFactory`](#building-clients-createclients--clientfactory)
- [Contract-by-contract reference](#contract-by-contract-reference)
- [Error handling](#error-handling)
- [Retries and timeouts](#retries-and-timeouts)
- [Event parsing](#event-parsing)
- [Auth helpers](#auth-helpers)
- [Running the SDK tests](#running-the-sdk-tests)
- [Testing your integration](#testing-your-integration)
- [Adding a new contract client](#adding-a-new-contract-client)

## Install

The SDK lives in this monorepo as the `sdk/` workspace and isn't published to
a registry. Consume it via a workspace/path dependency, or `npm run
build:sdk` (root `package.json`) and reference `sdk/dist`.

```bash
npm install # from the repo root — installs all workspaces, including sdk
```

`@stellar/stellar-sdk` is a peer dependency — install it (`^12.0.0`) in the
consuming app.

## Getting started

The fastest path from zero to a read: pick a network, build the client(s) you
need, call a method.

```ts
import { createClients } from "@veritoken/sdk";

const { kycRegistry, rwaToken } = createClients({
  network: "testnet",
  contractIds: {
    kycRegistry: process.env.VITE_KYC_REGISTRY_ID,
    rwaToken: process.env.VITE_RWA_TOKEN_ID,
  },
});

const isApproved = await kycRegistry?.isApproved(address);
const balance = await rwaToken?.balance(address);
```

Writes take a `signTx: (xdr: string) => Promise<string>` callback — plug in
Freighter, another wallet, or a `Keypair.sign` helper for scripts:

```ts
import type { SignTx } from "@veritoken/sdk";

const signTx: SignTx = async (xdr) => {
  const { signedTxXdr } = await signTransaction(xdr, { networkPassphrase });
  return signedTxXdr;
};

await rwaToken?.transfer(fromAddress, toAddress, 100n, signTx);
```

Every write follows the same internal pipeline: build → simulate → assemble →
sign (via your `signTx`) → submit → poll for confirmation. You get back the
confirmed `GetSuccessfulTransactionResponse`, or the call throws. See
[Retries and timeouts](#retries-and-timeouts) for which stages are retried and
how long confirmation can take.

### Using a custom RPC endpoint

`createClients` also accepts an explicit `rpcUrl` and `networkPassphrase`, so
you can point at a custom or private Soroban RPC instead of a built-in network:

```ts
import { createClients } from "@veritoken/sdk";

const { rwaToken } = createClients({
  network: "my-custom-network", // any name; no built-in default to fall back to
  rpcUrl: "https://rpc.example.invalid", // placeholder — use your own endpoint
  networkPassphrase: "My Custom Network ; 2026", // placeholder passphrase
  contractIds: { rwaToken: process.env.VITE_RWA_TOKEN_ID },
});
```

Custom networks default `allowHttp` to `false`, so the RPC URL must use HTTPS.
For a plaintext local endpoint (the same exception `standalone` gets), pass
`allowHttp: true` or set `VERITOKEN_RPC_ALLOW_HTTP=true`. See
[Custom networks and RPC endpoints](#custom-networks-and-rpc-endpoints-451)
for the full rules.

## Network configuration

_Issue #394 — Multi-Network SDK Configuration Support_

The SDK ships defaults for four networks — `testnet`, `mainnet`, `futurenet`,
and `standalone` (a local quickstart node) — and resolves the network to use
from three layers, in priority order:

1. **Explicit overrides** passed to `resolveNetworkConfig` / `createClients`
2. **Environment variables** (Node `process.env`, including Vite's
   `VITE_`-prefixed equivalents so the same code works in the frontend build)
3. **Built-in defaults** for the four known networks

```ts
import { resolveNetworkConfig, createServer } from "@veritoken/sdk";

// Defaults to testnet unless VERITOKEN_NETWORK / STELLAR_NETWORK /
// VITE_STELLAR_NETWORK is set.
const config = resolveNetworkConfig();
const server = createServer(config);
```

Switch networks with no code changes by setting an env var, or by passing an
override explicitly:

```ts
// Explicit override — e.g. a script that always targets mainnet.
const server = createServer({ network: "mainnet" });

// Full control — e.g. a local standalone node with a custom RPC port.
const server = createServer({
  network: "standalone",
  rpcUrl: "http://localhost:8000/soroban/rpc",
});
```

| Field                | Overrides via `resolveNetworkConfig({...})` | Env vars consulted (first match wins) |
|-----------------------|----------------------------------------------|----------------------------------------|
| `network`             | `network`                                    | `VERITOKEN_NETWORK`, `STELLAR_NETWORK`, `VITE_STELLAR_NETWORK` |
| `rpcUrl`               | `rpcUrl`                                     | `VERITOKEN_RPC_URL`, `SOROBAN_RPC_URL`, `VITE_SOROBAN_RPC_URL` |
| `networkPassphrase`    | `networkPassphrase`                          | `VERITOKEN_NETWORK_PASSPHRASE`, `STELLAR_NETWORK_PASSPHRASE`, `VITE_STELLAR_NETWORK_PASSPHRASE` |
| `allowHttp`            | `allowHttp`                                  | `VERITOKEN_RPC_ALLOW_HTTP` (`"true"`/`"false"`) |

Validation runs on every call: an unknown network name without an explicit
`rpcUrl` + `networkPassphrase` pair, an empty `rpcUrl` / `networkPassphrase`,
or a plaintext-`http://` RPC URL on a network that doesn't expect one
(anything but `standalone`, unless `allowHttp: true` is set explicitly) all
throw `InvalidNetworkConfigError` with a message that says exactly what's
wrong — instead of failing later as an opaque RPC error.

```ts
import { isValidNetwork, KNOWN_NETWORKS } from "@veritoken/sdk";

isValidNetwork("testnet"); // true
isValidNetwork("devnet"); // false
KNOWN_NETWORKS; // ["testnet", "mainnet", "futurenet", "standalone"]
```

`createClients` / `ClientFactory` (below) accept the same `network` /
`rpcUrl` / `networkPassphrase` / `allowHttp` fields directly, so most
applications never need to call `resolveNetworkConfig` themselves.

### Custom networks and RPC endpoints (#451)

`network` isn't limited to the four built-in names — any string works, as
long as you supply both `rpcUrl` and `networkPassphrase` (there's no
built-in default to fall back to for a name the SDK doesn't recognize).
This covers a private Soroban node, a forked testnet, or per-environment CI
infrastructure without editing SDK call sites:

```ts
const server = createServer({
  network: "my-private-devnet",
  rpcUrl: "https://rpc.my-devnet.internal",
  networkPassphrase: "My Private Devnet ; 2026",
});
```

Custom networks default `allowHttp` to `false` (same safe-by-default rule
built-in networks other than `standalone` use) — pass `allowHttp: true` (or
set `VERITOKEN_RPC_ALLOW_HTTP=true`) for a plaintext local endpoint.
Env-var overrides work identically to built-in networks — set
`VERITOKEN_NETWORK=my-private-devnet` alongside `VERITOKEN_RPC_URL` and
`VERITOKEN_NETWORK_PASSPHRASE` (or the `SOROBAN_RPC_URL`/`STELLAR_NETWORK_PASSPHRASE`/
`VITE_`-prefixed equivalents) to switch entirely via environment, no code
changes required.

## Building clients: `createClients` / `ClientFactory`

_Issue #395 — Client factory and dependency-injection pattern_ (the
foundation the network config and generator below build on)

`createClients` builds every configured client from one config object,
sharing a single RPC server and network passphrase:

```ts
import { createClients } from "@veritoken/sdk";

const clients = createClients({
  network: "testnet",
  contractIds: { rwaToken: "C...", kycRegistry: "C..." },
});
// clients.rwaToken / clients.kycRegistry are set; the other four are
// `undefined` because no contract ID was given for them.
```

An entirely empty `contractIds: {}` (with no `overrides`) is accepted: it
returns `{}`, every client is `undefined`, and no RPC call is made.

`ClientFactory` wraps the same thing with typed, fail-fast accessors — useful
when a missing client should be a loud error instead of `undefined`. Its
constructor throws on an empty configuration, and `get()` throws
synchronously with an error naming the missing client:

```ts
import { ClientFactory } from "@veritoken/sdk";

const factory = new ClientFactory({ network: "testnet", contractIds: { rwaToken: "C..." } });
const rwa = factory.get("rwaToken"); // throws a clear error if not configured
factory.has("kycRegistry"); // false
```

Both accept `overrides` — the dependency-injection escape hatch for tests or
custom client subclasses:

```ts
const fakeKyc = { isApproved: async () => true } as unknown as KycRegistryClient;
const clients = createClients({
  contractIds: { kycRegistry: "C..." },
  overrides: { kycRegistry: fakeKyc },
});
```

### `createClients` vs `ClientFactory` — which to use

`createClients` is the direct path: call it, destructure the result, and you
have your clients. Missing clients come back as `undefined`, so the caller
decides what to do when a contract ID wasn't supplied.

`ClientFactory` wraps the same construction logic but enforces that every
client you ask for was actually configured. Its `get()` throws synchronously
with a clear error naming the missing key; `has()` checks without throwing.
Use it when an unconfigured client is a programming mistake that should fail
loudly at startup rather than silently produce `undefined` at the call site.

| | `createClients` | `ClientFactory` |
|---|---|---|
| **Returns** | Plain object — missing clients are `undefined` | Class with `get()` / `has()` accessors |
| **Empty `contractIds: {}`** | Accepted — returns `{}` | Rejected — throws at construction |
| **Unknown client key** | N/A (TypeScript catches it) | Throws at construction |
| **Unconfigured client access** | Returns `undefined` | `get()` throws synchronously |
| **Typical use** | One-off script, single-page app, destructure once | Service class, shared module, inject into DI container |

```ts
// createClients — straightforward one-off setup
const { kycRegistry, rwaToken } = createClients({
  network: "testnet",
  contractIds: { kycRegistry: "C...", rwaToken: "C..." },
});
// kycRegistry and rwaToken are set; complianceEngine etc. are undefined.

// ClientFactory — fail-fast shared setup
const factory = new ClientFactory({
  network: "testnet",
  contractIds: { kycRegistry: "C...", rwaToken: "C..." },
});
const kyc = factory.get("kycRegistry"); // typed KycRegistryClient, never undefined
factory.get("complianceEngine"); // throws: "complianceEngine was not configured"
```

See [docs/examples/sdk_client_factory_example.ts](../docs/examples/sdk_client_factory_example.ts)
for a complete runnable version of both patterns.

## Contract-by-contract reference

Every client extends `BaseContractClient` and takes the same constructor
shape: `new XClient(contractId, server, networkPassphrase)`. Reads simulate
and decode without touching a wallet; writes build → simulate → sign (via
your `signTx` callback) → submit → confirm. Full method signatures live in
the source files linked below — this table is the map, not the territory.

| Client | Contract | Source | Highlights |
|---|---|---|---|
| `KycRegistryClient` | `kyc-registry` | [src/clients/KycRegistryClient.ts](src/clients/KycRegistryClient.ts) | `isApproved`, `getRecord`, `getTier`, `approve`/`reject`/`revoke`, verifier & admin management |
| `ComplianceEngineClient` | `compliance-engine` | [src/clients/ComplianceEngineClient.ts](src/clients/ComplianceEngineClient.ts) | `getRules`, `setRules`/`proposeRules`/`activateRules` (time-locked governance), blocklist, pause/unpause |
| `RwaTokenClient` | `rwa-token` | [src/clients/RwaTokenClient.ts](src/clients/RwaTokenClient.ts) | SEP-41 balance/transfer/allowance, `getTokenExport`, `checkKycStatus` |
| `InvoiceTokenClient` | `invoice-token` | [src/clients/InvoiceTokenClient.ts](src/clients/InvoiceTokenClient.ts) | `issue`, `settle`, `redeem`, invoice metadata |
| `PropertyTokenClient` | `property-token` | [src/clients/PropertyTokenClient.ts](src/clients/PropertyTokenClient.ts) | Fractional shares, `depositDividend`/`claimDividend`/`pendingDividend` |
| `CarbonTokenClient` | `carbon-credit-token` | [src/clients/CarbonTokenClient.ts](src/clients/CarbonTokenClient.ts) | `mint`, `retire` (returns a `RetirementReceipt`), retirement history |

### Signing requirements by method

The rule across all six clients is the same: **reads never need a wallet;
writes always do**. Reads call `server.simulateTransaction` using a stable
dummy source account and return the decoded value directly. Writes require a
`signTx: (xdr: string) => Promise<string>` callback — the wallet integration
point. Never pass a `signTx` callback to a read method; none of them accept
one.

The clearest signal in the TypeScript signatures: if `signTx` does not appear
in the parameter list, the method is a read.

#### `KycRegistryClient`

| Method | Signing? | Notes |
|---|---|---|
| `isApproved(addr)` | No | Simulated read |
| `getRecord(addr)` | No | Simulated read |
| `getTier(addr)` | No | Simulated read |
| `verifierCount()` | No | Simulated read |
| `getVerifiers(start, limit)` | No | Simulated read |
| `verifierListPub()` | No | Simulated read |
| `getAdmins()` | No | Simulated read |
| `health(opts?)` | No | Simulated read |
| `approve(verifier, subject, tier, expiry, jurisdiction, signTx)` | **Yes** | Verifier-signed; local pre-check runs first |
| `reject(verifier, subject, signTx)` | **Yes** | Verifier-signed |
| `revoke(verifier, subject, signTx)` | **Yes** | Verifier-signed |
| `updateTier(verifier, subject, newTier, signTx)` | **Yes** | Verifier-signed |
| `addVerifier(adminAddress, verifier, signTx)` | **Yes** | Admin-signed |
| `removeVerifier(adminAddress, verifier, signTx)` | **Yes** | Admin-signed |
| `addAdmin(callerAddress, newAdmin, signTx)` | **Yes** | Admin-signed |
| `removeAdmin(callerAddress, adminToRemove, signTx)` | **Yes** | Admin-signed |

#### `ComplianceEngineClient`

| Method | Signing? | Notes |
|---|---|---|
| `getRules()` | No | Simulated read |
| `isBlocklisted(addr)` | No | Simulated read |
| `isAllowlisted(addr)` | No | Simulated read |
| `canTransfer(from, to, amount)` | No | Simulated read |
| `evaluateTransfer(from, to, amount)` | No | Simulated read; returns typed `TransferDecision` |
| `holderCount()` | No | Simulated read |
| `getLockupStatus(addr)` | No | Simulated read |
| `blocklistCount()` | No | Simulated read |
| `getBlocklist(start, limit)` | No | Simulated read |
| `getTierPolicy(fromTier, toTier)` | No | Simulated read |
| `tierPolicyCount()` | No | Simulated read |
| `getRiskConfig()` | No | Simulated read |
| `getJurisdictionRiskScore(jurisdiction)` | No | Simulated read |
| `evaluateTransferRisk(fromJurisdiction, toJurisdiction)` | No | Simulated read |
| `health(opts?)` | No | Simulated read |
| `setRules(adminAddress, rules, signTx)` | **Yes** | Admin-signed |
| `addToBlocklist(adminAddress, addr, signTx)` | **Yes** | Admin-signed |
| `removeFromBlocklist(adminAddress, addr, signTx)` | **Yes** | Admin-signed |
| `addToAllowlist(adminAddress, addr, signTx)` | **Yes** | Admin-signed |
| `removeFromAllowlist(adminAddress, addr, signTx)` | **Yes** | Admin-signed |
| `pause(adminAddress, signTx)` | **Yes** | Admin-signed |
| `unpause(adminAddress, signTx)` | **Yes** | Admin-signed |
| `registerHolder(callerAddress, addr, signTx)` | **Yes** | Caller-signed |
| `unregisterHolder(callerAddress, addr, signTx)` | **Yes** | Caller-signed |
| `setTierPolicy(adminAddress, fromTier, toTier, policy, signTx)` | **Yes** | Admin-signed |
| `clearTierPolicy(adminAddress, fromTier, toTier, signTx)` | **Yes** | Admin-signed |
| `setRiskConfig(adminAddress, config, signTx)` | **Yes** | Admin-signed |
| `setJurisdictionRiskScore(adminAddress, jurisdiction, score, signTx)` | **Yes** | Admin-signed |
| `clearJurisdictionRiskScore(adminAddress, jurisdiction, signTx)` | **Yes** | Admin-signed |

#### `RwaTokenClient`

| Method | Signing? | Notes |
|---|---|---|
| `balance(addr)` | No | Simulated read |
| `totalSupply()` | No | Simulated read |
| `allowance(from, spender)` | No | Simulated read |
| `name()` | No | Simulated read |
| `symbol()` | No | Simulated read |
| `decimals()` | No | Simulated read |
| `assetType()` | No | Simulated read |
| `kycRegistry()` | No | Simulated read |
| `complianceEngine()` | No | Simulated read |
| `getComplianceMetadata(key)` | No | Simulated read |
| `getTokenExport()` | No | Simulated read |
| `getExternalUri()` | No | Simulated read |
| `checkKycStatus(addr)` | No | Simulated read |
| `health(opts?)` | No | Simulated read |
| `mint(adminAddress, to, amount, signTx)` | **Yes** | Admin-signed |
| `transfer(fromAddress, to, amount, signTx)` | **Yes** | Sender-signed |
| `transferFrom(spenderAddress, from, to, amount, signTx)` | **Yes** | Spender-signed |
| `approve(fromAddress, spender, amount, expirationLedger, signTx)` | **Yes** | Owner-signed |
| `burn(fromAddress, amount, signTx)` | **Yes** | Holder-signed |
| `burnFrom(spenderAddress, from, amount, signTx)` | **Yes** | Spender-signed |
| `setAdmin(callerAddress, newAdmin, signTx)` | **Yes** | Admin-signed |
| `setComplianceMetadata(adminAddress, key, value, signTx)` | **Yes** | Admin-signed |
| `setExternalUri(adminAddress, uri, signTx)` | **Yes** | Admin-signed |
| `syncKycStatus(callerAddress, addr, signTx)` | **Yes** | Caller-signed |

#### `InvoiceTokenClient`

| Method | Signing? | Notes |
|---|---|---|
| `getMeta()` | No | Simulated read |
| `balance(addr)` | No | Simulated read |
| `totalSupply()` | No | Simulated read |
| `isSettled()` | No | Simulated read |
| `allowance(from, spender)` | No | Simulated read |
| `name()` | No | Simulated read |
| `symbol()` | No | Simulated read |
| `decimals()` | No | Simulated read |
| `issue(adminAddress, to, amount, signTx)` | **Yes** | Admin-signed |
| `settle(adminAddress, signTx)` | **Yes** | Admin-signed |
| `redeem(fromAddress, amount, signTx)` | **Yes** | Holder-signed |
| `transfer(fromAddress, to, amount, signTx)` | **Yes** | Sender-signed |
| `transferFrom(spenderAddress, from, to, amount, signTx)` | **Yes** | Spender-signed |
| `approve(fromAddress, spender, amount, expirationLedger, signTx)` | **Yes** | Owner-signed |
| `updateMeta(adminAddress, meta, signTx)` | **Yes** | Admin-signed |

#### `PropertyTokenClient`

| Method | Signing? | Notes |
|---|---|---|
| `getMeta()` | No | Simulated read |
| `balance(addr)` | No | Simulated read |
| `totalShares()` | No | Simulated read |
| `pendingDividend(holder)` | No | Simulated read |
| `name()` | No | Simulated read |
| `symbol()` | No | Simulated read |
| `decimals()` | No | Simulated read |
| `mint(adminAddress, to, shares, signTx)` | **Yes** | Admin-signed |
| `transfer(fromAddress, to, shares, signTx)` | **Yes** | Sender-signed |
| `depositDividend(adminAddress, amount, distributionType, signTx)` | **Yes** | Admin-signed |
| `claimDividend(holderAddress, signTx)` | **Yes** | Holder-signed |

#### `CarbonTokenClient`

| Method | Signing? | Notes |
|---|---|---|
| `getMeta()` | No | Simulated read |
| `balance(addr)` | No | Simulated read |
| `totalSupply()` | No | Simulated read |
| `totalRetired()` | No | Simulated read |
| `retirementCount()` | No | Simulated read |
| `getReceipt(index)` | No | Simulated read |
| `getReceipts(start, limit)` | No | Simulated read |
| `name()` | No | Simulated read |
| `symbol()` | No | Simulated read |
| `decimals()` | No | Simulated read |
| `mint(adminAddress, to, amount, signTx)` | **Yes** | Admin-signed |
| `transfer(fromAddress, to, amount, signTx)` | **Yes** | Sender-signed |
| `retire(retireeAddress, amount, beneficiary, reason, signTx)` | **Yes** | Holder-signed; returns `RetirementReceipt` |
| `updateMeta(adminAddress, meta, signTx)` | **Yes** | Admin-signed |

### Smallest read-only call per client

Each row is one representative read. All complete without a wallet.

| Client | Read call | Returns | Method reference |
|---|---|---|---|
| `KycRegistryClient` | `kyc.isApproved(address)` | `Promise<boolean>` | [isApproved](src/clients/KycRegistryClient.ts) |
| `ComplianceEngineClient` | `engine.isBlocklisted(address)` | `Promise<boolean>` | [isBlocklisted](src/clients/ComplianceEngineClient.ts) |
| `RwaTokenClient` | `rwa.balance(address)` | `Promise<bigint>` | [balance](src/clients/RwaTokenClient.ts) |
| `InvoiceTokenClient` | `invoice.isSettled()` | `Promise<boolean>` | [isSettled](src/clients/InvoiceTokenClient.ts) |
| `PropertyTokenClient` | `property.pendingDividend(holder)` | `Promise<bigint>` | [pendingDividend](src/clients/PropertyTokenClient.ts) |
| `CarbonTokenClient` | `carbon.totalRetired()` | `Promise<bigint>` | [totalRetired](src/clients/CarbonTokenClient.ts) |

```ts
import { KycRegistryClient, createServer, NETWORK_PASSPHRASES } from "@veritoken/sdk";

const server = createServer("testnet");
const kyc = new KycRegistryClient(contractId, server, NETWORK_PASSPHRASES.testnet);

await kyc.isApproved(address);                                              // no wallet needed
await kyc.approve(verifierAddress, subjectAddress, 1, 0n, "US", signTx);   // wallet required
```

In most applications you won't construct clients directly — use
`createClients` / `ClientFactory` above instead.

## Working with token amounts (`bigint`)

Token amounts, balances, supplies and dividends are typed as JavaScript
`bigint` (for example `balance()`, `totalSupply()`, `pendingDividend()` and the
`amount` fields in `types.ts`). Keep them as `bigint` until the last step.
Converting them to `number` silently loses precision above
`Number.MAX_SAFE_INTEGER` (about 9e15).

- **Arithmetic:** use `bigint` operators and `n` literals (`100n`). Do not mix
  them with `number` values; that throws a `TypeError`.
- **Display:** convert with `toString()` for raw smallest units. For a value
  with decimals, use the frontend helper
  [`formatTokenAmount`](../frontend/src/lib/numericFormat.ts), or format it
  yourself from the string without going through `Number`.
- **JSON:** `JSON.stringify` throws on `bigint` by default. Export amounts as
  strings with a replacer, and restore them with `BigInt(...)` on import:

```ts
const replacer = (_key: string, value: unknown) =>
  typeof value === "bigint" ? value.toString() : value;

const json = JSON.stringify({ balance: await rwa.balance(address) }, replacer);
// {"balance":"1000000000"}

const restored = BigInt(JSON.parse(json).balance); // 1000000000n
```

Avoid `Number(amount)`, `parseFloat(amount)` and `amount * 1.0` for amounts.
They can round silently.

## Error handling

Every contract emits numeric `#[contracterror]` codes. `errors.ts` gives you
a lookup table and two ways to turn a thrown error into something readable:

```ts
import { formatContractError, parseContractError } from "@veritoken/sdk";

try {
  await kyc.approve(verifier, subject, 1, 0n, "US", signTx);
} catch (err) {
  // "KYC tier is too low (KycTierInsufficient #5)" instead of "Error(Contract, #5)"
  console.error(formatContractError("kyc", err));
}
```

`parseContractError(contract, rawMessage)` returns the structured
`ContractError` (`{ code, name, message }`) or `null` if the message doesn't
match a known Soroban contract-error pattern. `ContractName` is one of
`"rwa" | "carbon" | "invoice" | "property" | "kyc" | "compliance"` — pass the
same short name a client was constructed with.

## Retries and timeouts

Every client read and write goes through `TxPipeline`
([src/pipeline.ts](src/pipeline.ts)). Its behaviour is controlled by
`PipelineOptions`:

| Option | Default | Meaning |
|---|---|---|
| `maxRetries` | `3` | Extra attempts after a transient RPC failure (so up to 4 attempts in total) |
| `initialBackoffMs` | `400` | Delay before the first retry; doubles each retry, capped at 8 s |
| `confirmTimeoutMs` | `60_000` | How long to poll `getTransaction` after a successful submit |
| `pollIntervalMs` | `1_500` | Delay between confirmation polls |
| `timeoutSeconds` | `30` | Transaction validity window set on the transaction (`TransactionBuilder.setTimeout`); unrelated to polling |

The six built-in clients (and `createClients` / `ClientFactory`) always use
these defaults. To change them, construct a `TxPipeline` yourself
(`new TxPipeline(server, networkPassphrase, { confirmTimeoutMs: 120_000 })`)
or pass `PipelineOptions` as the fifth constructor argument of a
`BaseContractClient` subclass.

**What is retried.** A write attempt runs sequence → build → simulate →
assemble → sign → submit → poll. When an attempt fails, the pipeline retries
the **whole attempt** (re-simulating and calling your `signTx` again) only if
the error is not one of the typed errors below and its message matches
`isTransientError` (timeouts, `ECONNRESET`, `ECONNREFUSED`, `ETIMEDOUT`,
`ENOTFOUND`, socket hang-ups, `network`, `429`, `502`, `503`,
`TRY_AGAIN_LATER`). Any other error is thrown immediately. Reads retry only
the `simulateTransaction` call, using the same rules.

| Stage | Failure | Retried? | Surfaced as |
|---|---|---|---|
| Sequence fetch | `getAccount` fails | No | `SequenceError` |
| Simulation | RPC transport error | Yes, if transient | `TransientError` once retries run out |
| Simulation | Contract rejected the call | No | `SimulationError` |
| Signing | `signTx` throws or returns empty | No | `SigningError` |
| **Submission** | `sendTransaction` throws (transport) | Yes, if transient; the cached sequence is refreshed first | `TransientError` once retries run out |
| **Submission** | Network returns `status: "ERROR"` | No | `SubmissionError` |
| **Confirmation** | Still `NOT_FOUND` at the deadline | No | `TimeoutError` (`txHash`, `elapsedMs`) |
| **Confirmation** | Final status other than `SUCCESS` | No | `ConfirmError` (`txHash`, `finalStatus`) |
| **Confirmation** | `getTransaction` throws (transport) | Yes, if transient: the **entire write** is rebuilt, re-signed and resubmitted | `TransientError` once retries run out |

Things the SDK does **not** guarantee:

- **Submission and confirmation are separate steps.** Once `sendTransaction`
  accepts the transaction, the SDK only polls for its result. A
  `TimeoutError` means the SDK stopped waiting, not that the transaction
  failed: it may still have landed.
- **No de-duplication.** A retry after a transport error during submission
  or confirmation sends a *new* signed transaction. If the original actually
  reached the network, a non-idempotent call (for example `issue` or
  `transfer`) can be applied twice. Your `signTx` callback also runs again,
  so wallet users may be prompted more than once.
- **No overall time bound.** Polling checks the deadline before each sleep, so
  confirmation can take up to about `confirmTimeoutMs + pollIntervalMs` plus
  RPC latency. Each retry adds backoff plus a full new attempt, so the total
  duration of a `write` has no fixed upper limit.
- `TimeoutError` is not on the explicit no-retry list. It goes through the same
  message check, so a hash or elapsed time containing `429`, `502` or `503`
  can trigger a retry of the whole write.

**Handling errors.** The pipeline errors all extend `TxError` and carry a
machine-readable `kind` (`"sequence" | "simulation" | "signing" |
"submission" | "confirm" | "timeout" | "transient"`) plus the original
`cause`. When the message contains a Soroban contract error code
(`Error(Contract, #N)`), client methods rethrow it as a plain `Error` with a
readable message prepended (see [Error handling](#error-handling)). Other
errors keep their `TxError` subclass. Example: a confirmation timeout on
`redeem`:

```ts
import { TimeoutError, TransientError, TxError } from "@veritoken/sdk";

try {
  await invoice.redeem(holder, 1_000n, signTx);
} catch (err) {
  if (err instanceof TimeoutError) {
    // Submitted but unconfirmed after ~60 s. Check before resubmitting.
    const status = await server.getTransaction(err.txHash);
    if (status.status === "NOT_FOUND") showPending(err.txHash);
    else if (status.status === "SUCCESS") markRedeemed(err.txHash);
    else showFailed(err.txHash, status.status);
  } else if (err instanceof TransientError) {
    showRetryLater(err.message); // RPC still unreachable after maxRetries
  } else if (err instanceof TxError) {
    showError(err.kind, err.message);
  } else {
    // e.g. "Insufficient token balance (InsufficientBalance #9)"
    showError("contract", invoice.formatError(err));
  }
}
```

Typed error reference: the `TxError` hierarchy in
[src/pipeline.ts](src/pipeline.ts), contract error codes in
[src/errors.ts](src/errors.ts), and the per-contract **Errors** tables in
[../docs/contract-api-reference.md](../docs/contract-api-reference.md).

## Event parsing

_Issue #393 — Typed event parsing_

`parseEvents` decodes a batch of `rpc.Api.EventResponse` into `ParsedEvent`s
whose `data` is typed per event name (transfer, mint, burn, approve, freeze,
admin-transfer, KYC/compliance updates, ...). Unknown event names still
decode — `data` is just untyped.

```ts
import { parseEvents, filterByName } from "@veritoken/sdk";

const events = await server.getEvents({ ...opts });
const parsed = parseEvents(events.events);
const transfers = filterByName(parsed, "transfer"); // narrows to KnownParsedEvent<"transfer">
```

Every client also exposes a convenience `getEvents` — see
[src/clients/base.ts](src/clients/base.ts) (`GetContractEventsOptions`).

## Health and analytics

_Issue #400 — SDK health helpers_

Three clients expose a `health()` method that collects operational signals
without a wallet or write access. All reads are simulated and safe to call
from monitoring scripts or dashboards.

```ts
import { createClients } from "@veritoken/sdk";

const { complianceEngine, kycRegistry, rwaToken } = createClients({
  network: "testnet",
  contractIds: {
    complianceEngine: process.env.VITE_COMPLIANCE_ENGINE_ID,
    kycRegistry: process.env.VITE_KYC_REGISTRY_ID,
    rwaToken: process.env.VITE_RWA_TOKEN_ID,
  },
});

const ceHealth = await complianceEngine?.health();
// {
//   reachable: true,
//   latestLedger: 12345,
//   recentEventCount: 7,
//   checkedAt: "2025-01-01T00:00:00.000Z",
//   paused: false,
//   holderCount: 42
// }

const kycHealth = await kycRegistry?.health();
// { ...base, verifierCount: 3 }

const tokenHealth = await rwaToken?.health();
// { ...base, totalSupply: 1000000n }
```

The base `ContractHealth` shape (from `checkHealth` in `health.ts`) is also
exported for use in custom monitoring scripts:

```ts
import { checkHealth } from "@veritoken/sdk";

const health = await checkHealth(server, contractId, { lookbackLedgers: 500 });
if (!health.reachable) console.error("Contract unreachable:", health.error);
```

Signals collected:
- `reachable` — RPC responded without a network error
- `latestLedger` — current ledger sequence
- `recentEventCount` — events emitted in the last `lookbackLedgers` ledgers (default 1000)
- `checkedAt` — ISO timestamp of the check
- `error` — error message if `reachable` is false

Per-contract extensions: `paused` + `holderCount` (compliance), `verifierCount` (KYC), `totalSupply` (RWA token).

## Auth helpers

_Issue #397 — Local pre-flight role checks_

Admin- and verifier-gated writes (`KycRegistryClient.approve`, `addVerifier`,
...) already run a local pre-check against the on-chain roster before
building a transaction, so a wrong-caller mistake fails immediately with a
clear `AuthError` instead of a slow simulate-then-fail round trip. On-chain
`require_auth()` enforcement is unchanged either way — this only saves a
round trip. See [src/auth.ts](src/auth.ts) if you're wiring up a similar
pattern for a new gated method.

## Running the SDK tests

The SDK test suite (`vitest run`) can be invoked two ways — both run the
same tests, so pick the one matching your working directory:

```bash
# From the repository root (npm workspace selector)
npm run test:sdk

# From inside the sdk/ directory (package-local command)
npm test
```

`npm run test:sdk` is the root-level convenience script in the repo-root
`package.json` — it runs `npm --workspace sdk run test`, mirroring the
existing `build:sdk` script. Run it from the repository root.
`npm test` is the package-local command, run from `sdk/`.

## Testing your integration

[src/testing/mockRpc.ts](src/testing/mockRpc.ts) is a reusable mock
`rpc.Server` — `simulateTransaction` / `sendTransaction` / `getTransaction` /
`getAccount` / `getEvents` — so you can exercise a client's happy paths,
contract failures, and confirmation timeouts without a live network:

```ts
import { mockServer, simSuccess, simFailure } from "@veritoken/sdk/dist/testing/mockRpc.js";
// (imported directly from source — see the note below)

const server = mockServer({ simulateByMethod: { balance: simSuccess(encodeI128(100n)) } });
const client = new RwaTokenClient(contractId, server, passphrase);
expect(await client.balance(address)).toBe(100n);
```

`mockRpc.ts` is **not** re-exported from the package's main entry point — it
imports `vi` from vitest (a devDependency), and the main entry point is the
production runtime surface. Import it via a relative/subpath path from your
own test suite instead. See any `src/clients/*.test.ts` for the established
pattern (happy path, simulation error, malformed payload, network
rejection).

## Versioning and breaking changes

_Issue #399 — SemVer strategy_

`@veritoken/sdk` follows [Semantic Versioning 2.0.0](https://semver.org). The
full policy — what counts as a breaking change, how breaking changes are
communicated, and migration guides — is in [VERSIONING.md](VERSIONING.md).

In short:
- `PATCH` — bug fixes, no API change
- `MINOR` — new exports or methods, backward-compatible
- `MAJOR` — removed/renamed exports, changed signatures, dropped peer versions

Breaking changes are announced in `CHANGELOG.md` under a `### Breaking Changes`
section and documented with a migration note in `VERSIONING.md`.

## Adding a new contract client

_Issue #392 — Contract-specific client generators_

Every client (`KycRegistryClient`, `RwaTokenClient`, ...) follows the same
convention: extend `BaseContractClient`, take
`(contractId, server, networkPassphrase)` in the constructor, and call
`this.read()` / `this.write()` for every contract method — never
`buildContractTx` / `simulateRead` / `submitContractTx` directly (those stay
internal to `base.ts` so error enrichment and the tx pipeline are applied
consistently).

Scaffold a new client instead of copy-pasting an existing one:

```bash
npm run generate:client -- --name Escrow
# or: node scripts/generate-client.mjs --name Escrow
```

> **Generated output — don't hand-edit it.** `scripts/generate-client.mjs`
> (run via the `generate:client` script in `sdk/package.json`) generates
> `src/clients/<Name>Client.ts` and `src/clients/<Name>Client.test.ts`. If you
> need to change either file's scaffolded structure, update the generator and
> re-run `npm run generate:client -- --name <PascalCaseName>` rather than
> editing the generated files by hand. Before opening a PR, review the
> generated changes in your diff (`git diff`) to confirm they're what you
> intended.

This creates `src/clients/EscrowClient.ts` and `src/clients/EscrowClient.test.ts`
following the shared convention, and prints the remaining steps:

1. Add `"escrow"` to `ContractName` in [src/errors.ts](src/errors.ts) and give
   it an `ERROR_MAPS` entry (copy the shape of an existing contract's error
   list). The generated client's `super(...)` call intentionally doesn't
   type-check until this is done — that's the reminder.
2. Fill in the Read/Write API methods to match the contract's public
   functions, following the pattern of the other `*Client.ts` files.
3. Register the client in [src/factory.ts](src/factory.ts): add it to
   `ClientMap` and `CTORS`.
4. Export it from [src/index.ts](src/index.ts).
5. Replace the placeholder test with real coverage using
   [src/testing/mockRpc.ts](src/testing/mockRpc.ts) — see
   `PropertyTokenClient.test.ts` for the established pattern (read decode,
   write happy path, contract-error enrichment, malformed payload, network
   rejection).

The generator only scaffolds the two new files — it deliberately doesn't
edit `errors.ts` / `factory.ts` / `index.ts` for you. Those are small,
deliberate edits (a new error table, a new map entry, a new export) that are
easy to get wrong via text-insertion and easy to get right by hand with the
checklist above.

Run `npm run --workspace sdk generate:client -- --help` for the full CLI
reference (`--name`, `--key`, `--force`).
