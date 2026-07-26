# Metadata Retention and Privacy Policy

This document defines how Veritoken stores, retains, and handles metadata across its contracts and frontend. It is intended for maintainers, auditors, and end users.

---

## Scope

This policy covers all data persisted by:

- **Smart contracts** deployed on the Stellar network (KYC Registry, Compliance Engine, RWA Token, Property Token, Invoice Token, Carbon Credit Token)
- **Frontend application** (local browser state, environment configuration)
- **SDK** (client-side, no server-side persistence)

---

## Data Categories and Retention

### 1. KYC Records (`kyc-registry`)

| Data | Storage | Retention |
|------|---------|-----------|
| KYC status (`Approved`, `Rejected`, `Revoked`, `Pending`) | Soroban persistent storage | Retained for the TTL window (30 days, auto-renewed on access); purged by the network after TTL expiry with no further access |
| Per-subject lifecycle history (transition journal) | Soroban persistent storage | Same 30-day TTL per entry, renewed on each lifecycle access |
| Verifier log entries | Soroban persistent storage | Same 30-day TTL |
| Expiry index entries | Soroban persistent storage | Same 30-day TTL |
| Verifier list and count | Soroban instance storage | Retained for 30 days; renewed on any contract call |
| Admin list | Soroban instance storage | Same instance TTL |

**What is stored per KYC record:** KYC status, verifier address, tier (0/1/2), expiry timestamp (0 = no expiry), ISO-3166-1 alpha-2 jurisdiction code. No personally identifiable information (PII) such as names, documents, or national ID numbers is stored on-chain.

### 2. Compliance Engine (`compliance-engine`)

| Data | Storage | Retention |
|------|---------|-----------|
| Compliance rules (current and pending) | Soroban instance storage | 30-day TTL, renewed on access |
| Blocklist and allowlist | Soroban instance storage | 30-day TTL |
| Blocked jurisdictions | Soroban instance storage | 30-day TTL |
| Holder timestamps (`HolderSince`) | Soroban persistent storage | 30-day TTL per holder, renewed on access |
| Holder count | Soroban instance storage | 30-day TTL |

### 3. RWA Token (`rwa-token`)

| Data | Storage | Retention |
|------|---------|-----------|
| Token metadata (name, symbol, decimals, asset type) | Soroban instance storage | Instance TTL (renewed by any call) |
| Per-holder balances | Soroban persistent storage | Retained while non-zero; entries that reach zero and are not accessed will expire after the ledger TTL window |
| Allowances | Soroban temporary storage | Expires at `expiration_ledger`; automatically purged by the network after ledger passes |
| Compliance metadata (`legal_entity`, `governing_law`, `isin`, `prospectus_hash`) | Soroban instance storage | Instance TTL |
| Migration records | Soroban persistent storage | 30-day TTL |

### 4. Property Token (`property-token`)

| Data | Storage | Retention |
|------|---------|-----------|
| Property metadata (`PropertyMeta`) | Soroban instance storage | 365-day TTL, renewed on access |
| Per-holder share balances | Soroban persistent storage | 365-day TTL per entry |
| Dividend deposit history | Soroban persistent storage | 365-day TTL per entry |
| Allowances | Soroban temporary storage | Expires at `expiration_ledger` |
| Holder list | Soroban persistent storage | 365-day TTL |
| Forced transfer log | Soroban persistent storage | 365-day TTL per entry |

**What is stored in `PropertyMeta`:** property ID, legal entity name, jurisdiction code, street address, total valuation (USD), share count, property type, and an IPFS hash pointing to the off-chain title document. The actual title document is stored off-chain (IPFS); the hash anchors its integrity on-chain.

### 5. Invoice Token (`invoice-token`)

| Data | Storage | Retention |
|------|---------|-----------|
| Invoice metadata (`InvoiceMeta`) | Soroban persistent storage | 90-day TTL; renewed on any invoice access |
| Per-invoice lifecycle journal | Soroban persistent storage | 90-day TTL |
| Per-holder per-invoice balances | Soroban persistent storage | 90-day TTL |
| Invoice status | Soroban persistent storage | 90-day TTL |
| Invoice list | Soroban instance storage | Instance TTL |
| Allowances | Soroban persistent storage | 90-day TTL |

**What is stored per invoice:** invoice ID, issuer and debtor names (legal entity names, not individual names), face value, discount rate, due date, currency, and an IPFS document hash. An optional HTTPS webhook URL may be stored; this URL is treated as configuration data, not PII.

### 6. Carbon Credit Token (`carbon-credit-token`)

| Data | Storage | Retention |
|------|---------|-----------|
| Project metadata (`ProjectMeta`) | Soroban instance storage | 365-day TTL, renewed on access |
| Per-holder balances | Soroban persistent storage | 365-day TTL |
| Retirement receipts | Soroban persistent storage | 365-day TTL per receipt |
| Total supply and total retired | Soroban instance storage | 365-day TTL |

**Retirement receipts** record the retiree address, amount, timestamp, beneficiary name (a string, not an address), retirement reason, and optionally a beneficiary address. Beneficiary names are free-text strings provided by the caller and may contain personal names.

---

## Frontend State

The frontend application stores the following in the user's browser only:

| Data | Where | Retention |
|------|-------|-----------|
| Connected wallet address | React component state | Cleared on page unload |
| Selected network | `localStorage` | Persisted until the user clears browser storage |
| Address book entries | `localStorage` | Persisted until the user clears browser storage or removes entries |
| Environment variables (`.env`) | Build-time configuration | Not persisted at runtime; not sent to any server |

No user data is transmitted to any Veritoken-controlled server. The frontend communicates exclusively with the Stellar RPC endpoint configured via `VITE_STELLAR_RPC_URL`.

---

## Data Not Collected

Veritoken contracts and the frontend **do not** collect or store:

- Full legal names of individual persons (only legal entity names for invoices and property)
- National identification numbers, passport details, or government-issued IDs
- Residential addresses of individuals
- Financial account numbers
- IP addresses or device identifiers

KYC verification — the process of confirming a subject's identity — is performed off-chain by authorised verifiers. Only the outcome (approved/rejected/revoked), tier, and jurisdiction code are stored on-chain.

---

## Deletion and Export

### On-chain data

Soroban ledger state is immutable once written; individual records **cannot be deleted on demand**. Records expire naturally when their TTL elapses and the network prunes them. The TTL is renewed each time the relevant contract entry point is called.

For compliance workflows that require demonstrable erasure (e.g. GDPR right-to-erasure requests):

- **KYC records** may be `revoke`d, changing their status to `Revoked`. The revoked record and its lifecycle history remain on-chain until TTL expiry, but the subject's approval status is immediately `false`.
- **Administrators** may choose not to renew TTLs for specific records by avoiding contract calls that touch those keys. The records will then expire at the network level within the TTL window.
- No PII is stored on-chain (see above), which limits the scope of erasure obligations.

### Frontend data

Users can clear all locally stored frontend data by:
1. Removing entries from the in-app address book UI.
2. Clearing `localStorage` for the Veritoken domain in their browser settings.

### Export

On-chain state is publicly readable via any Stellar RPC node. Maintainers and auditors may query contract state using `stellar contract invoke` or any compatible RPC client. No proprietary export tooling is required.

---

## Alignment with Implementation

| Policy statement | Implementation reference |
|-----------------|--------------------------|
| KYC records use 30-day TTL | `contracts/kyc-registry/src/lib.rs` — `BUMP = 30 * DAY_IN_LEDGERS` |
| Property/carbon tokens use 365-day TTL | `contracts/property-token/src/lib.rs`, `contracts/carbon-credit-token/src/lib.rs` — `BUMP = 365 * DAY_IN_LEDGERS` |
| Invoice token uses 90-day TTL | `contracts/invoice-token/src/lib.rs` — `BUMP = 90 * DAY_IN_LEDGERS` |
| Allowances use temporary storage expiring at `expiration_ledger` | `contracts/rwa-token/src/allowance.rs`, `contracts/property-token/src/lib.rs` |
| No PII on-chain | KYC contract stores only status, tier, expiry, and 2-letter jurisdiction code |
| Frontend state is local only | `frontend/src/lib/networkStore.ts`, `frontend/src/lib/addressBook.ts` |

---

## Policy Updates

This document should be reviewed and updated whenever:

- A new data field is added to any contract's storage
- TTL constants are changed
- New frontend persistence mechanisms are introduced
- A new contract is added to the platform

See `CONTRIBUTING.md` for the process for proposing changes to this document.
