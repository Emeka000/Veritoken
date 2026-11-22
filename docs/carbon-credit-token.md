# Carbon credit token units and retirement semantics

The `carbon-credit-token` contract represents verified carbon credits as integer token units. **One token unit represents one metric tonne of CO2 equivalent (tCO2e)**. The contract reports `decimals() == 0`, so there are no fractional on-chain token units: amounts such as `1`, `25`, and `100` represent 1, 25, and 100 tCO2e respectively.

This unit convention describes the token's accounting unit. It does not, by itself, assert the validity of an off-chain project, registry record, verification claim, or legal retirement. Those claims must be supported by the project's metadata and external verification processes.

## Unit examples

Because `decimals() == 0`, every on-chain amount is a whole number of token units, and each unit is one tonne of CO2e. The examples below use the same terminology as the contract:

| Token units (`amount`) | Credits | Tonnes of CO2e |
| --- | --- | --- |
| `0` | 0 credits | 0 tCO2e |
| `1` | 1 credit | 1 tCO2e |
| `25` | 25 credits | 25 tCO2e |
| `100` | 100 credits | 100 tCO2e |

Fractional credit units are not supported by this convention: `decimals() == 0` means there is no on-chain representation for amounts such as `0.5` credits, and no such value can be minted, transferred, or retired. An amount displayed by a UI or returned by a contract call is always a whole number of credits, never a fraction of a credit. Display precision (for example, formatting with thousands separators or a trailing `.0`) is a presentation choice only and does not change the underlying integer amount; do not apply fractional-token assumptions from assets that use non-zero decimals.

To follow a credit through to its permanent retirement record, see [Receipt lookup and verification](#receipt-lookup-and-verification).

## Supply lifecycle

- `mint(to, amount)` creates `amount` token units for a KYC-approved holder and increases `total_supply`.
- `transfer(from, to, amount)` moves existing units between KYC-approved holders. It does not change `total_supply` or `total_retired`.
- `retire(retiree, amount, beneficiary, reason)` permanently removes units from the retiree's balance and decreases `total_supply` by `amount`. It increases `total_retired` and appends an immutable receipt. The string `beneficiary` identifies the beneficiary in the receipt metadata.
- `retire_on_behalf(retiree, on_behalf_of, amount, reason)` has the same permanent-burn behavior, but records `on_behalf_of` as the on-chain `beneficiary_address` and indexes the receipt for beneficiary queries.
- `batch_retire` and `batch_retire_on_behalf` apply the same retirement rules to multiple receipt entries in one transaction.

A retirement therefore does not merely transfer credits or mark a balance as reserved: the retired units can no longer be transferred or minted back by the token contract. `total_retired` is the cumulative amount retired, while `total_supply` is the amount that remains outstanding after retirements.

## Receipt lookup and verification

Receipts use zero-based global indices. `retirement_count()` is the number of receipts written so far. Use `get_receipt(index)` for one known index, or `get_receipts(start, limit)` for ordered pagination. A page that begins at or beyond `retirement_count()` returns an empty vector; a final page may contain fewer entries than requested.

For a beneficiary-address lookup, use `get_receipts_by_beneficiary(beneficiary, start, count)`. This returns the same stored receipt, including `retiree`, `amount`, `retirement_reason`, timestamp, and `beneficiary_address`, without requiring callers to scan the global receipt list.

`verify_receipt(index)` returns a structured verification result rather than throwing for an unknown index. For an existing receipt it reports the receipt index, amount, retiree, timestamp, project ID, and a serial in the form `<project_id>-<index>`. A missing or out-of-range index returns `valid: false` with an empty serial and zero amount/timestamp.

Example flow:

```text
mint(alice, 10)
retire_on_behalf(alice, acme_foundation, 10, "2026 annual offset")
get_receipt(0)                         # receipt with beneficiary_address = acme_foundation
get_receipts_by_beneficiary(acme_foundation, 0, 100)
verify_receipt(0)                       # valid = true, serial = "<project_id>-0"
verify_receipt(1)                       # valid = false: no receipt at index 1
```

For a read-only Python lookup with explicit missing-receipt handling, see
[`examples/carbon_receipt.py`](examples/carbon_receipt.py) and its
[usage instructions](examples/README.md#carbon-retirement-receipt-lookup).
