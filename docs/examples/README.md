# Language-Specific Integration Examples

These examples show how to interact with Veritoken contracts from languages
outside the primary Rust/TypeScript stack. Each example covers the same three
workflows so you can compare them side-by-side:

1. **Read contract metadata** — fetch compliance rules and token metadata
   without signing a transaction.
2. **Check KYC state** — query whether an address is approved and at what tier.
3. **Submit a transfer** — build, sign, and submit a token transfer transaction.

## How the examples map to the TypeScript SDK

The TypeScript SDK in `sdk/src/clients/` wraps these same operations. The table
below shows the direct correspondence:

| Workflow | TypeScript SDK call | Raw contract function |
|---|---|---|
| Read compliance rules | `ComplianceEngineClient.getRules()` | `compliance-engine::get_rules` |
| Read invoice metadata | `InvoiceTokenClient.getMeta()` | `invoice-token::get_meta` |
| Check KYC approved | `KycRegistryClient.isApproved(addr)` | `kyc-registry::is_approved` |
| Get KYC record | `KycRegistryClient.getRecord(addr)` | `kyc-registry::get_record` |
| Transfer tokens | `RwaTokenClient.buildTransferXdr(...)` | `rwa-token::transfer` |

The TypeScript SDK uses simulation for reads and returns operation XDR for
writes; the examples below follow the same pattern in each language.

## Available examples

| File | Language | Runtime |
|---|---|---|
| [`carbon_receipt.py`](carbon_receipt.py) | Python 3.10+ | `python docs/examples/carbon_receipt.py 0` (repository root) |
| [`python_example.py`](python_example.py) | Python 3.10+ | `python python_example.py` |
| [`javascript_example.js`](javascript_example.js) | JavaScript (Node.js) | `node javascript_example.js` |
| [`kyc_read_example.mjs`](kyc_read_example.mjs) | JavaScript (Node.js, `@veritoken/sdk`) | `node docs/examples/kyc_read_example.mjs` (repository root) |
| [`sdk_client_factory_example.ts`](sdk_client_factory_example.ts) | TypeScript (`@veritoken/sdk`) | `npx tsx docs/examples/sdk_client_factory_example.ts` |

The TypeScript example additionally shows the SDK's client factory and
dependency-injection pattern (`createClients` / `ClientFactory`) — composing
several contract clients from one config object, and swapping in a mock
client for tests without touching a real or simulated RPC endpoint.

## Minimal KYC status read (JavaScript)

[`kyc_read_example.mjs`](kyc_read_example.mjs) is the shortest path to a
KYC check: one read-only `KycRegistryClient.isApproved(addr)` call through the
SDK's `createClients` factory. It needs no wallet secret, signing, funded
account, or transaction submission, so it is a safe first step before you
build a full approval or transfer workflow. From the repository root:

```bash
npm install          # links the sdk workspace as @veritoken/sdk
npm run build:sdk    # the example imports the built sdk/dist

export VITE_KYC_REGISTRY_ID=C...    # placeholder: your kyc-registry contract ID
export KYC_SUBJECT_ADDRESS=G...     # placeholder: the address to check
export STELLAR_NETWORK=testnet      # optional; testnet is the default
node docs/examples/kyc_read_example.mjs
```

The network is resolved by the SDK's `resolveNetworkConfig`, so the usual
`VERITOKEN_NETWORK` / `STELLAR_NETWORK` and `VERITOKEN_RPC_URL` /
`SOROBAN_RPC_URL` variables apply (see the
[SDK network configuration](../../sdk/README.md#network-configuration)).

Expected output for an approved subject:

```
Network:  testnet (https://soroban-testnet.stellar.org)
Registry: C...
Subject:  G...
is_approved: true — the subject has a current, unexpired approval.
```

**A `false` result is not an error.** `is_approved: false` means the RPC call
succeeded and the registry answered: the subject was never approved, was
rejected or revoked, or its approval has expired. The script exits `0`. If the
RPC endpoint is unreachable, the contract ID is wrong, or simulation fails,
the script prints `KYC status could not be read …` and exits `1`. Treat that
as "status unknown", never as "not approved".

## Carbon retirement receipt lookup

Install the same Python dependency as the other Python example: `stellar-sdk>=10.0.0`.
The focused [carbon receipt example](carbon_receipt.py) needs only a deployed
carbon contract ID; no wallet secret, signing, funded source account, or transaction
submission is required. From the repository root:

```bash
export VITE_CARBON_TOKEN_ID=C...  # replace with your deployed contract ID
export STELLAR_NETWORK=testnet
python docs/examples/carbon_receipt.py 0
```

Optionally set `STELLAR_RPC_URL` for your RPC endpoint. The index is zero-based.
The example simulates `get_receipts(index, 1)` and decodes its XDR response. An
empty vector is represented as Python `None` and printed as
`No retirement receipt found at index 0 (empty page).` RPC and contract errors
remain errors rather than being reported as missing receipts. Amounts are whole
tonnes of CO2e, with no fractional-token scaling. On-chain receipts are audit
data, not a substitute for external project, registry, or retirement verification.
See [carbon receipt semantics](../carbon-credit-token.md#receipt-lookup-and-verification).

## Prerequisites

Both examples require deployed contract IDs. Run `bash scripts/deploy.sh` first
and copy the IDs from `frontend/.env` into the environment variables at the top
of each file.

## Contract addresses

All examples read contract IDs from environment variables:

```
VITE_KYC_REGISTRY_ID      — kyc-registry contract ID
VITE_COMPLIANCE_ENGINE_ID — compliance-engine contract ID
VITE_INVOICE_TOKEN_ID     — invoice-token contract ID
VITE_RWA_TOKEN_ID         — rwa-token contract ID
```

Export them in your shell before running:

```bash
export VITE_KYC_REGISTRY_ID=C...
export VITE_COMPLIANCE_ENGINE_ID=C...
export VITE_INVOICE_TOKEN_ID=C...
export VITE_RWA_TOKEN_ID=C...
```

Or copy `frontend/.env` values and `source` the file after prefixing with
`export`.

---

Looking for community-built integrations or more advanced usage patterns?
See [docs/community-showcase.md](../community-showcase.md).
