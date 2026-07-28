# Metadata Export Integration

This guide explains how external tools — block explorers, dashboards, metadata indexers, and third-party services — can discover and consume Veritoken token metadata.

---

## Overview

Every RWA token contract exposes a `get_token_export` entry point that returns a single, canonical snapshot of all metadata needed by external integrations.  No authentication or on-chain state mutation is required.

The snapshot includes:

| Field | Description |
|---|---|
| `name` | Token name (e.g. `"Veritoken RWA"`) |
| `symbol` | Token symbol (e.g. `"VTRWA"`) |
| `decimals` | Decimal precision (e.g. `7`) |
| `asset_type` | One of `"invoice"`, `"property"`, `"carbon_credit"` |
| `total_supply` | Current circulating supply (raw integer) |
| `max_supply` | Hard cap (`0` = unlimited) |
| `contract_version` | Semver string from the deployed WASM |
| `kyc_registry` | Stellar address of the linked KYC registry contract |
| `compliance_engine` | Stellar address of the linked compliance engine contract |
| `legal_entity` | Legal entity name (optional) |
| `governing_law` | Governing jurisdiction (optional) |
| `isin` | ISIN identifier (optional) |
| `prospectus_hash` | IPFS CID or hash of the offering document (optional) |
| `external_uri` | URI to an off-chain metadata document (optional) |

---

## Quick Start: CLI

Read the full metadata export in one call using the Stellar CLI:

```bash
stellar contract invoke \
  --network testnet \
  --id <RWA_TOKEN_CONTRACT_ID> \
  -- get_token_export
```

The output is an XDR-encoded struct.  Pipe through the Stellar CLI's JSON formatter:

```bash
stellar contract invoke \
  --network testnet \
  --id <RWA_TOKEN_CONTRACT_ID> \
  -- get_token_export \
  --output json
```

Example output:

```json
{
  "name": "Veritoken RWA",
  "symbol": "VTRWA",
  "decimals": 7,
  "asset_type": "property",
  "total_supply": "1000000000000",
  "max_supply": "0",
  "contract_version": "0.1.0",
  "kyc_registry": "CAAAA...KYC",
  "compliance_engine": "CAAAA...CE",
  "legal_entity": "Acme Real Estate LLC",
  "governing_law": "New York",
  "isin": null,
  "prospectus_hash": "QmYourIPFSHash",
  "external_uri": "ipfs://QmExtendedMetadataHash"
}
```

---

## SDK Integration

### TypeScript SDK

```ts
import { RwaTokenClient, createServer, NETWORK_PASSPHRASES } from "@veritoken/sdk";

const server = createServer("testnet");
const client = new RwaTokenClient(
  process.env.RWA_TOKEN_ID!,
  server,
  NETWORK_PASSPHRASES.testnet
);

// Fetch the full export snapshot
const meta = await client.getTokenExport();
console.log(meta.name, meta.asset_type, meta.total_supply);

// Fetch just the external URI
const uri = await client.getExternalUri();
```

### Frontend (React)

```ts
import { contracts } from "../lib/contracts";

// Read the export — no wallet or auth needed
const meta = await contracts.rwa.getTokenExport();
```

---

## External URI Pattern

The `external_uri` field is an optional URI pointing to a richer off-chain metadata document.  It follows a similar pattern to ERC-721 `tokenURI`.

### Setting the URI (admin-only)

```bash
stellar contract invoke \
  --source-account "$IDENTITY" \
  --network testnet \
  --id <RWA_TOKEN_CONTRACT_ID> \
  -- set_external_uri \
  --uri "ipfs://QmYourExtendedMetadataHash"
```

Or via the SDK:

```ts
const xdr = client.buildSetExternalUriXdr("ipfs://QmYourHash");
// sign and submit xdr ...
```

### Recommended off-chain metadata schema (JSON-LD)

The document at `external_uri` should be a JSON object.  Recommended shape:

```json
{
  "@context": "https://schema.org/",
  "@type": "FinancialProduct",
  "name": "Veritoken RWA",
  "description": "Fractional ownership token for 123 Main St",
  "identifier": "US1234567890",
  "issuer": {
    "@type": "Organization",
    "name": "Acme Real Estate LLC",
    "url": "https://acme.example.com"
  },
  "relatedLink": "https://acme.example.com/prospectus.pdf",
  "image": "ipfs://QmLogoHash",
  "additionalProperty": [
    { "name": "asset_type", "value": "property" },
    { "name": "governing_law", "value": "New York" },
    { "name": "kyc_registry", "value": "CAAAA...KYC" }
  ]
}
```

---

## Explorer Integration

Block explorers can discover token details by calling `get_token_export` on any deployed RWA token contract.

### Soroban RPC (simulateTransaction)

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "simulateTransaction",
  "params": {
    "transaction": "<XDR of a transaction calling get_token_export>"
  }
}
```

The `result.retval` field of the simulation response decodes to the `TokenExportMetadata` XDR struct.

### Indexer pattern

1. Subscribe to contract events for the `rwa-token` contract.
2. On any `mint`, `transfer`, or `migrated` event, call `get_token_export` to refresh the cached snapshot.
3. Store the decoded JSON in your index.

### Identifying the contract type

Check the `asset_type` field to determine what kind of RWA the token represents:

| `asset_type` | Description |
|---|---|
| `"invoice"` | Accounts-receivable / trade finance |
| `"property"` | Fractional real estate |
| `"carbon_credit"` | Verified carbon credit (retirable) |

---

## Setting Compliance Metadata (admin-only)

The `legal_entity`, `governing_law`, `isin`, and `prospectus_hash` fields are set by the admin at deploy time or via `set_compliance_metadata`:

```bash
# Set ISIN
stellar contract invoke \
  --source-account "$IDENTITY" --network testnet \
  --id <CONTRACT_ID> -- set_compliance_metadata \
  --key isin --value "US1234567890"

# Set legal entity
stellar contract invoke \
  --source-account "$IDENTITY" --network testnet \
  --id <CONTRACT_ID> -- set_compliance_metadata \
  --key legal_ent --value "Acme Real Estate LLC"
```

Key names match the on-chain symbol constants:

| Field | Key string |
|---|---|
| `legal_entity` | `legal_ent` |
| `governing_law` | `gov_law` |
| `isin` | `isin` |
| `prospectus_hash` | `pros_hash` |

---

## Deployment Output

After deploying a new token contract, record the contract ID and immediately verify the export:

```bash
export CONTRACT_ID="<deployed contract ID>"

stellar contract invoke --network testnet --id "$CONTRACT_ID" \
  -- get_token_export --output json > token-metadata.json

cat token-metadata.json
```

Include `token-metadata.json` in your deployment artifacts.  This file serves as the canonical on-chain state snapshot at deployment time for audit, compliance, and explorer registration purposes.
