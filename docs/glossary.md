# Glossary

Plain-language definitions of terms that are specific to Veritoken and its Soroban contracts. Each entry links to the canonical reference for the term. Where a term has no dedicated page, the entry points to the contract source.

---

## Compliance and identity

**Verifier**
An address approved by the KYC registry admin to approve, renew, reject, revoke, or update the tier of a subject. A verifier is separate from an admin: admin membership does not grant verifier rights, and a verifier cannot manage verifiers unless it also holds the admin role.
See [contract-api-reference.md — KYC Registry, Roles and authorization](contract-api-reference.md#kyc-registry) and `contracts/kyc-registry/src/lib.rs`.

**KYC (Know Your Customer) record**
The registry entry for one address. It stores the subject's status, tier, jurisdiction, verifier, and expiry.
See [contract-api-reference.md — KYC Registry, Data structures](contract-api-reference.md#kyc-registry).

**Tier**
A numeric KYC level assigned to a holder when approved. The defined levels are `0` Basic, `1` Accredited, and `2` Institutional. Compliance rules can require a minimum tier for a sender, a recipient, or a property token shareholder.
See [tier-based-compliance.md — Overview](tier-based-compliance.md#overview).

**Jurisdiction**
The country code recorded on a KYC record, in ISO-3166-1 alpha-2 format (for example `US` or `GB`). The compliance engine can block transfers by jurisdiction and can require that both parties share one.
See [contract-api-reference.md — KYC Registry, Data structures](contract-api-reference.md#kyc-registry) and `contracts/kyc-registry/src/test.rs` for the accepted input.

#### Jurisdiction input examples

Jurisdiction values must be uppercase ISO 3166-1 alpha-2 codes. The contract's `validate_jurisdiction` in `contracts/kyc-registry/src/lib.rs` enforces this, so the accepted set is defined by the contract, not by a frontend-only dropdown. Any client or script that writes a KYC record is subject to the same check.

| Input | Accepted? | Why |
| --- | --- | --- |
| `US` | Yes | Uppercase two-letter code |
| `GB` | Yes | Uppercase two-letter code |
| `DE` | Yes | Uppercase two-letter code |
| `United States` | No | Country name, not a code |
| `USA` | No | Three-letter code, not alpha-2 |
| `us` | No | Lowercase, not uppercase |

Invalid input raises `InvalidJurisdiction` (error code `5`). See [contract-api-reference.md — KYC Registry, Errors](contract-api-reference.md#kyc-registry) for the error description.

These examples are illustrative and are not a complete list of accepted countries. For the full set, follow the contract's validation.

**Blocklist**
A set of addresses the compliance engine refuses to send to or receive from. Blocklisted addresses cannot be added to the allowlist.
See [contract-api-reference.md — Compliance Engine](contract-api-reference.md#compliance-engine).

**Allowlist**
The set of addresses cleared to transfer. An allowlisted address cannot also be on the blocklist.
See [contract-api-reference.md — Compliance Engine](contract-api-reference.md#compliance-engine).

**Tier policy**
A rule that limits transfers by the sender's and recipient's tiers, keyed by `(from_tier, to_tier)`. The most restrictive limit between the tier policy and the global rules applies.
See [tier-based-compliance.md — Policy Model](tier-based-compliance.md#policy-model).

**Lockup (holding period)**
A rule that controls how long an address must hold a token before it can transfer out (`min_holding_period`), and how long it may hold before it must transfer out (`max_holding_period`). The compliance engine reports the status for an address as a `LockupStatus`. A value of `0` means the rule is disabled.
See [contract-api-reference.md — Compliance Engine, Data structures](contract-api-reference.md#compliance-engine) and `contracts/compliance-engine/src/lib.rs` (`LockupStatus`).

**Compliance engine**
The contract that applies transfer rules before any balance changes: size limits, holding periods, blocklist, pause, and tier policies. Asset tokens call it through `can_transfer`.
See [README.md — Compliance is enforced at the protocol level](../README.md#compliance-is-enforced-at-the-protocol-level).

---

## Asset lifecycle

**Asset token**
A token contract that represents a real-world asset: an invoice, a property share, or a carbon credit. Each asset token type has its own reference page.
See [contract-api-reference.md](contract-api-reference.md).

**Settlement**
For an invoice token, the payment step that closes the invoice. Settlement and redemption are different steps, and the contract treats them separately.
See [contract-api-reference.md — Invoice Token, Terminology](contract-api-reference.md#invoice-token).

**Redemption (burn)**
For an invoice token, the step that removes redeemed tokens from circulation.
See [contract-api-reference.md — Invoice Token, Terminology](contract-api-reference.md#invoice-token).

**Buyback**
An admin-initiated redemption of shares from a property-token holder.
See [contract-api-reference.md — Property Token, Methods](contract-api-reference.md#property-token).

**Forced transfer**
An admin-initiated transfer of shares between holders, used for regulatory actions such as AML or court orders. Only the admin can call it.
See [contract-api-reference.md — Property Token, Methods](contract-api-reference.md#property-token).

**Retirement receipt**
An on-chain record created when carbon credits are permanently retired. It stores the amount, the retirement reason, and the optional beneficiary. Retired credits leave circulation.
See [carbon-credit-token.md](carbon-credit-token.md) and `contracts/carbon-credit-token/src/lib.rs` (`RetirementReceipt`).

**Beneficiary**
The address recorded on a retirement receipt as the party the retirement is for. It is optional.
See [carbon-credit-token.md](carbon-credit-token.md).

---

## Dividends

**Dividend index**
A running per-share total, stored in fixed-point form with a scale factor of 10^7. Each deposit adds `amount × SCALE_FACTOR / total_shares` to the index. A holder's entitlement is the change in the index over the time they held their shares, so the contract does not loop over holders on each deposit.
See `contracts/property-token/src/lib.rs` (`SCALE_FACTOR`, `deposit_dividend`) and [contract-api-reference.md — Property Token](contract-api-reference.md#property-token).

**Distribution type**
The category a dividend deposit is recorded under: `Rent` (`0`), `Capital` (`1`), or `Other` (`2`). Claims can be made for all types at once or for one type.
See `contracts/property-token/src/lib.rs` (`DistributionType`).

**Distribution checkpoint**
An immutable accounting record for one dividend deposit, including the per-share amount and any rounding remainder.
See `contracts/property-token/src/lib.rs` (`DistributionCheckpoint`).

**Dust reserve**
Stroops left over from per-share rounding. It is tracked separately and can be withdrawn by the admin.
See `contracts/property-token/src/lib.rs` (`dust_reserve`, `collect_dust_reserve`).

---

## Networks

The SDK supports a fixed set of built-in Soroban networks plus custom networks. These names represent different endpoints and trust contexts; they are not interchangeable environments.

**Testnet**
The Stellar test network, used for development and testing against throwaway funds and contracts.
See [sdk/README.md — Network configuration](sdk/README.md#network-configuration).

**Mainnet**
The Stellar public network, used for production deployments and real assets.
See [sdk/README.md — Network configuration](sdk/README.md#network-configuration).

**Futurenet**
The Stellar futurenet, used to preview upcoming protocol changes before they reach mainnet.
See [sdk/README.md — Network configuration](sdk/README.md#network-configuration).

**Standalone**
A local Stellar node started with `--standalone`, used for local development. It is the default network for the Docker environment.
See [Standalone network](#deployment-and-tooling) below and [docker-environment.md](docker-environment.md).

**Custom network**
Any network name other than the built-in ones. Because there is no built-in default, a custom network requires an explicit RPC URL (`rpcUrl`) and network passphrase (`networkPassphrase`).
See [sdk/README.md — Network configuration](sdk/README.md#network-configuration).

> **Caution:** Verify the selected network before signing transactions. A transaction signed for one network is not valid on another, and the built-in names point at different endpoints and trust contexts.

---

## Deployment and tooling

**Canonical manifest**
The `deploy-manifest.json` file written by a deployment. It records the deployed contracts and is the input for the verification step, which checks deployed code hashes against it.
See [deployment-automation.md](deployment-automation.md).

**Standalone network**
A local Stellar node started with `--standalone`. It is the default network for the Docker environment.
See [docker-environment.md](docker-environment.md).

**SEP-41**
The Stellar token interface that the base `rwa-token` contract implements.
See [contract-api-reference.md — RWA Token](contract-api-reference.md#rwa-token).
