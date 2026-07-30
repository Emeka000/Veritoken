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
| [`python_example.py`](python_example.py) | Python 3.10+ | `python python_example.py` |
| [`javascript_example.js`](javascript_example.js) | JavaScript (Node.js) | `node javascript_example.js` |
| [`sdk_client_factory_example.ts`](sdk_client_factory_example.ts) | TypeScript (`@veritoken/sdk`) | `npx tsx docs/examples/sdk_client_factory_example.ts` |

The TypeScript example additionally shows the SDK's client factory and
dependency-injection pattern (`createClients` / `ClientFactory`) — composing
several contract clients from one config object, and swapping in a mock
client for tests without touching a real or simulated RPC endpoint.

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
