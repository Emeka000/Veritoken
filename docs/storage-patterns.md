# Storage Patterns in Veritoken

This document explains how Veritoken contracts use Soroban's three storage tiers,
why each `DataKey` variant is placed in its tier, and where TTL bumps occur.  It
is the authoritative reference for anyone forking Veritoken to build a new asset
type.

---

## General Principles

Soroban provides three storage tiers, each with different cost and durability
characteristics.

| Tier | Survives ledger close? | Default TTL | Cost | Typical use |
|---|---|---|---|---|
| **Instance** | Yes — shared TTL with the contract instance | Extended on every `extend_ttl` call | Low | Small, frequently-read config values that should live as long as the contract |
| **Persistent** | Yes — independent TTL per key | Must be bumped explicitly per key | Medium | Large or per-address data that needs long-term survival |
| **Temporary** | No — expires automatically | Set at write time; never survives archival | Lowest | Short-lived allowances and ephemeral data |

### The TTL model

Every entry in Soroban storage has a *time-to-live* expressed in ledgers.  When a
ledger entry's TTL reaches zero the entry is **archived** (made inaccessible)
and may later be **evicted** (deleted permanently).  To prevent data loss,
contracts must call `extend_ttl` before an entry expires.

Veritoken follows two conventions:

1. **Instance bump on every public entry-point** — the contract instance TTL is
   extended at the top of almost every `pub fn`, ensuring the instance stays live
   as long as anyone calls the contract.
2. **Persistent bump at write time** — whenever a persistent key is written, its
   TTL is also extended in the same operation so freshly-written data is never at
   immediate risk of expiry.

Each contract declares three constants for this purpose:

```rust
const DAY_IN_LEDGERS: u32 = 17280;   // ~1 day at 5-second ledger close
const BUMP: u32 = N * DAY_IN_LEDGERS; // desired TTL after a bump
const THRESHOLD: u32 = BUMP - DAY_IN_LEDGERS; // bump when TTL drops below this
```

The `THRESHOLD` / `BUMP` pair is passed to `extend_ttl(THRESHOLD, BUMP)`.
Soroban only extends if the current TTL is below `THRESHOLD`, preventing
redundant writes.

### Risk of storage expiry

If a key is never bumped — because no transaction reads or writes it for long
enough — it will be archived.  Reading an archived key panics with a host error.
The mitigations Veritoken uses are:

- Instance bump on every entry-point covers all instance keys automatically.
- Persistent keys are bumped at write time; they must also be bumped on reads for
  keys that are read far more often than they are written (e.g. `Balance`).
  Several contracts currently only bump on write — this is noted in the tables
  below and tracked by Issues 8, 9, 15, 16, 17.

---

## kyc-registry

TTL constants: `BUMP = 30 × DAY_IN_LEDGERS`, `THRESHOLD = BUMP − DAY_IN_LEDGERS`

| DataKey | Storage tier | Data type | Rationale | TTL bump location |
|---|---|---|---|---|
| `AdminList` | Instance | `Vec<Address>` | Tiny, read on nearly every call; instance bump covers it. | Every public entry-point via `extend_ttl(THRESHOLD, BUMP)` |
| `PendingAdmin` | Instance | `Address` | Transient handover value; lives only during a two-step transfer. Instance is appropriate — it disappears with the contract if unused. | Every public entry-point |
| `VerifierList` | Instance | `Vec<Address>` | Read on every approve/revoke; must survive as long as the contract. | Every public entry-point |
| `VerifierCount` | Instance | `u32` | Scalar counter co-located with `VerifierList`. | Every public entry-point |
| `ExpiryIndexCount` | Instance | `u32` | Counter for the expiry-index append log; co-located with instance for cheap reads. | Every public entry-point |
| `VerifierLogCount` | Instance | `u32` | Counter for the global verifier-action log; same reasoning. | Every public entry-point |
| `KycStatus(Address)` | Persistent | `KycRecord` | One record per subject address; potentially millions of entries — must each have an independent TTL. | `write_record` (at write); **not bumped on read** — see Issues 8, 9 |
| `VerifierLog(u32)` | Persistent | `VerifierLogEntry` | Append-only audit log; each entry is large and infrequently read. | `append_log` (at write) |
| `ExpiryIndex(u32)` | Persistent | `ExpiryEntry` | Append-only expiry index; large, infrequently read per entry. | `write_record` (at write) |
| `VerifierSubjects(Address)` | Persistent | `Vec<Address>` | Per-verifier subject list; can grow large; needs independent lifetime from the contract instance. | `write_record` (at write) |
| `LifecycleEntry(HistoryKey)` | Persistent | `KycTransition` | Immutable audit history; one entry per state change per subject; must survive independently. | `record_transition` (at write) |
| `LifecycleCount(Address)` | Persistent | `u32` | Sequence counter for lifecycle entries; co-located with `LifecycleEntry` in persistent so it shares the subject's lifetime. | `record_transition` (at write) |

---

## compliance-engine

TTL constants: `BUMP = 30 × DAY_IN_LEDGERS`, `THRESHOLD = BUMP − DAY_IN_LEDGERS`

| DataKey | Storage tier | Data type | Rationale | TTL bump location |
|---|---|---|---|---|
| `Admin` | Instance | `Address` | Single scalar; read on every admin-only call. | Every public entry-point |
| `PendingAdmin` | Instance | `Address` | Transient two-step handover value. | Every public entry-point |
| `KycRegistry` | Instance | `Address` | Foreign contract address; small and read on every transfer check. | Every public entry-point |
| `Rules` | Instance | `ComplianceRules` | Active rules are read on every `can_transfer` call; keeping them in instance avoids a persistent read on the hot path. | Every public entry-point |
| `PendingRules` | Instance | `ComplianceRules` | Pending rules live only between `propose_rules` and `activate_rules`; transient, instance is appropriate. | Every public entry-point |
| `PendingRulesActivateAt` | Instance | `u64` | Timestamp scalar for the time-lock; same lifetime as `PendingRules`. | Every public entry-point |
| `RuleChangeDelay` | Instance | `u64` | Immutable after init; small scalar. | Every public entry-point |
| `Blocklist` | Instance | `Vec<Address>` | Read on every `can_transfer`; must be fast. Bounded in practice by governance. | Every public entry-point |
| `BlocklistCount` | Instance | `u32` | Counter co-located with `Blocklist`. | Every public entry-point |
| `BlockedJurisdictions` | Instance | `Vec<String>` | Read on every transfer when jurisdiction checking is active; same hot-path reasoning as `Blocklist`. | Every public entry-point |
| `MaxTransfer` | Instance | `i128` | Superseded by the `Rules` struct — kept as a key variant for ABI compatibility but not actively used. | Every public entry-point |
| `MinHoldingPeriod` | Instance | `u64` | Same as `MaxTransfer`. | Every public entry-point |
| `MaxHolders` | Instance | `u32` | Same as `MaxTransfer`. | Every public entry-point |
| `HolderCount` | Instance | `u32` | Global holder count; read on every new-holder admission check; scalar, cheap in instance. | Every public entry-point |
| `HolderSince(Address)` | Persistent | `u64` | One entry per holder; can grow to thousands of entries — each needs an independent TTL so holders' records survive without an active contract bump. | `register_holder` (at write); **not bumped on read** — see Issue 15 |
| `Allowlist` | Instance | `Vec<Address>` | Read on every transfer when `allowlist_mode` is active; same reasoning as `Blocklist`. | Every public entry-point |

---

## rwa-token

TTL constants: `INSTANCE_BUMP_AMOUNT = 7 × DAY_IN_LEDGERS`, `BALANCE_BUMP_AMOUNT = 30 × DAY_IN_LEDGERS`

Note: rwa-token uses separate constants for instance vs. balance keys, giving
balances a longer independent lifetime than the instance.

| DataKey | Storage tier | Data type | Rationale | TTL bump location |
|---|---|---|---|---|
| `Admin` | Instance | `Address` | Single scalar; read on admin-only calls. | Entry-points that call `extend_ttl` |
| `PendingAdmin` | Instance | `Address` | Transient two-step handover. | Entry-points that call `extend_ttl` |
| `TotalSupply` | Instance | `i128` | Global scalar; cheap to keep in instance. | Entry-points that call `extend_ttl` |
| `MaxSupply` | Instance | `i128` | Immutable after init; scalar. | Entry-points that call `extend_ttl` |
| `Metadata` | Instance | `TokenMetadata` | Token name/symbol/decimal — small and read on every metadata call. | Entry-points that call `extend_ttl` |
| `AssetType` | Instance | `Symbol` | Single symbol; scalar. | Entry-points that call `extend_ttl` |
| `KycRegistry` | Instance | `Address` | Foreign contract address; read on every transfer. | Entry-points that call `extend_ttl` |
| `ComplianceEngine` | Instance | `Address` | Foreign contract address; read on every transfer. | Entry-points that call `extend_ttl` |
| `Balance(Address)` | Persistent | `i128` | Per-address balance; potentially millions of entries — each must have an independent TTL. | `write_balance` (at write) using `BALANCE_BUMP_AMOUNT` |
| `Allowance(AllowanceKey)` | Persistent | `AllowanceValue` | Per-(owner, spender) allowance with its own expiry ledger; persistent gives it an independent lifetime. | At write; **not bumped on read** — see Issue 16 |
| `ComplianceMeta(Symbol)` | Persistent | *(varies)* | Asset-type-specific compliance metadata keyed by symbol; can be multiple entries with independent lifetimes. | At write |
| `Frozen(Address)` | Persistent | `bool` | Per-address freeze flag; independent lifetime needed. | At write; **not bumped on read** — see Issue 16 |
| `ContractSemver` | Instance | `String` | Version string; small scalar. | Entry-points that call `extend_ttl` |
| `MigrationCount` | Instance | `u32` | Migration counter; scalar. | Entry-points that call `extend_ttl` |
| `Migration(u32)` | Persistent | *(migration data)* | Per-migration payload; needs independent lifetime. | At write |
| `RecoveryMembers` | Instance | `Vec<Address>` | Recovery quorum; read during recovery flows; bounded list. | Entry-points that call `extend_ttl` |
| `RecoveryThreshold` | Instance | `u32` | Recovery threshold scalar. | Entry-points that call `extend_ttl` |
| `ActiveRecovery` | Instance | *(recovery state)* | Transient recovery-in-progress state. | Entry-points that call `extend_ttl` |
| `TransferLock` | Instance | `bool` | Reentrancy guard; must be readable in the same transaction it is set — instance is the only viable tier. | Cleared at end of guarded operation |

---

## carbon-credit-token

TTL constants: `BUMP = 365 × DAY_IN_LEDGERS`, `THRESHOLD = BUMP − DAY_IN_LEDGERS`

The 365-day TTL reflects the long operational lifetime of carbon-credit projects.

| DataKey | Storage tier | Data type | Rationale | TTL bump location |
|---|---|---|---|---|
| `Admin` | Instance | `Address` | Scalar; read on admin-only calls. | Every public entry-point via `extend_ttl` |
| `PendingAdmin` | Instance | `Address` | Transient two-step handover. | Every public entry-point |
| `KycRegistry` | Instance | `Address` | Foreign contract address; hot-path read. | Every public entry-point |
| `ComplianceEngine` | Instance | `Address` | Foreign contract address; hot-path read. | Every public entry-point |
| `ProjectMeta` | Instance | `ProjectMeta` | Single project per deployed contract; small struct read on metadata queries and certificate generation. | Every public entry-point |
| `TotalSupply` | Instance | `i128` | Global scalar; updated on every mint/retire. | Every public entry-point |
| `TotalRetired` | Instance | `i128` | Running total of retired credits; scalar. | Every public entry-point |
| `RetirementCount` | Instance | `u32` | Index counter for the receipt log; scalar. | Every public entry-point |
| `Balance(Address)` | Persistent | `i128` | Per-address balance; independent TTL required. | `write_balance` (at write); **not bumped on read** — see Issue 17 |
| `Receipt(u32)` | Persistent | `RetirementReceipt` | Immutable audit receipt per retirement; append-only; independent TTL per receipt. | `retire` / `retire_on_behalf` / `batch_retire` (at write) |

---

## invoice-token

TTL constants: `BUMP = 90 × DAY_IN_LEDGERS`, `THRESHOLD = BUMP − DAY_IN_LEDGERS`

The 90-day TTL matches typical invoice maturity windows.

| DataKey | Storage tier | Data type | Rationale | TTL bump location |
|---|---|---|---|---|
| `Admin` | Instance | `Address` | Scalar; admin-only calls. | Every public entry-point |
| `PendingAdmin` | Instance | `Address` | Transient two-step handover. | Every public entry-point |
| `KycRegistry` | Instance | `Address` | Foreign contract address; hot-path read. | Every public entry-point |
| `ComplianceEngine` | Instance | `Address` | Foreign contract address; hot-path read. | Every public entry-point |
| `InvoicesList` | Instance | `Vec<String>` | Small list of invoice IDs; read on every `list_invoices` call; bounded by governance. | Every public entry-point |
| `LifecyclePaused` | Instance | `bool` | Global pause flag; must be checked on every lifecycle-sensitive call; scalar. | Every public entry-point |
| `InvoiceMeta(String)` | Persistent | `InvoiceMeta` | Per-invoice metadata; each invoice has independent lifetime. | `do_create_invoice` (at write); `update_meta` does not re-bump — see Issue 9 |
| `Balance(Address, String)` | Persistent | `i128` | Per-(holder, invoice) balance; one entry per holder per invoice; independent TTL. | `issue`, `transfer`, `transfer_from` (at write) |
| `Allowance(Address, Address, String)` | Persistent | `AllowanceValue` | Per-(owner, spender, invoice) allowance; independent TTL. | `approve` (at write); **not bumped on read** |
| `TotalSupply(String)` | Persistent | `i128` | Per-invoice total supply; independent lifetime from other invoices. | `issue`, `redeem`, `burn`, `burn_from` (at write) |
| `InvoiceStatus(String)` | Persistent | `InvoiceStatus` | Per-invoice lifecycle state; updated on every transition. | `transition_status` (at write) |
| `SettlementAmount(String)` | Persistent | `i128` | Per-invoice settlement amount; written on settle/partial_settle. | `settle`, `partial_settle` (at write) |
| `Journal(String)` | Persistent | `Vec<JournalEntry>` | Append-only audit journal per invoice; grows over the invoice's life. | `transition_status` (at write) |
| `HolderList` | Persistent | `Vec<Address>` | Global holder address list used for compliance queries; needs independent lifetime from the instance. | `register_holder` → compliance engine; **not bumped locally** |

---

## property-token

TTL constants: `BUMP = 365 × DAY_IN_LEDGERS`, `THRESHOLD = BUMP − DAY_IN_LEDGERS`

The 365-day TTL reflects the long operational lifetime of real-estate assets and
their dividend history.

| DataKey | Storage tier | Data type | Rationale | TTL bump location |
|---|---|---|---|---|
| `Admin` | Instance | `Address` | Scalar; admin-only calls. | Every public entry-point |
| `PendingAdmin` | Instance | `Address` | Transient two-step handover. | Every public entry-point |
| `KycRegistry` | Instance | `Address` | Foreign contract address; hot-path read. | Every public entry-point |
| `ComplianceEngine` | Instance | `Address` | Foreign contract address; hot-path read. | Every public entry-point |
| `PropertyMeta` | Instance | `PropertyMeta` | Single property per deployed contract; small struct. | Every public entry-point |
| `TotalShares` | Instance | `i128` | Authorized share count; read on every mint and dividend deposit. | Every public entry-point |
| `DividendPool` | Instance | `i128` | Running dividend pool total; updated on deposit and claim; scalar. | Every public entry-point |
| `DividendPerShare` | Instance | `i128` | Global dividend-per-share accumulator; read on every accrue/claim; must be fast. | Every public entry-point |
| `DividendPerShareRent` | Instance | `i128` | Rent-type DPS accumulator; same reasoning. | Every public entry-point |
| `DividendPerShareCapital` | Instance | `i128` | Capital-return DPS accumulator; same reasoning. | Every public entry-point |
| `DividendDepositCount` | Instance | `u32` | Index counter for the deposit log; scalar. | `deposit_dividend` |
| `ForcedTransferCount` | Instance | `u32` | Index counter for the forced-transfer log; scalar. | `forced_transfer` |
| `HolderCount` | Instance | `u32` | Local copy of holder count; scalar updated on mint/transfer. | `add_holder_local`, `remove_holder_local` |
| `MintedShares` | Instance | `i128` | Running total of minted shares; scalar. | `mint`, `buyback` |
| `ClaimedDividend(Address)` | Instance | `i128` | Per-holder "debt" tracker for the global DPS accumulator; read and written on every accrue; keeping in instance avoids a persistent read on the accrue hot-path. | `reset_debt`, `accrue` |
| `ClaimedDividendRent(Address)` | Instance | `i128` | Per-holder rent-type debt tracker; same reasoning. | `accrue_typed`, `reset_debt` |
| `ClaimedDividendCapital(Address)` | Instance | `i128` | Per-holder capital-type debt tracker; same reasoning. | `accrue_typed`, `reset_debt` |
| `Unclaimed(Address)` | Instance | `i128` | Per-holder unclaimed dividend bucket; read and zeroed on claim; same hot-path reasoning. | `accrue`, `claim_dividend` |
| `UnclaimedRent(Address)` | Instance | `i128` | Per-holder unclaimed rent bucket. | `accrue_typed`, `claim_rent_yield` |
| `UnclaimedCapital(Address)` | Instance | `i128` | Per-holder unclaimed capital bucket. | `accrue_typed`, `claim_capital_return` |
| `Balance(Address)` | Persistent | `i128` | Per-holder share balance; independent TTL; potentially many holders. | `write_balance` (at write); **not bumped on read** — see Issue 17 |
| `HolderList` | Persistent | `Vec<Address>` | Full holder address list; can grow large; needs independent lifetime. | `add_holder_local`, `remove_holder_local` (at write) |
| `DividendDeposit(u32)` | Persistent | `DividendEvent` | Append-only dividend history; one entry per deposit; independent TTL. | `deposit_dividend` (at write) |
| `ForcedTransferLog(u32)` | Persistent | `ForcedTransferEntry` | Append-only forced-transfer audit log; independent TTL per entry. | `forced_transfer` (at write) |
| `Allowance(AllowanceKey)` | **Temporary** | `AllowanceValue` | SEP-41 delegated-transfer allowance. Property-token allowances have a caller-specified `expiration_ledger`; using temporary storage maps naturally onto this model — the entry self-expires when the allowance expires, with no manual cleanup required. | `approve` sets TTL = `expiration_ledger − current_ledger`; `spend_allowance` rewrites without bumping |

---

## Missing TTL bumps (known issues)

The following persistent keys are bumped at write time but **not on read**.  This
means a key that is read many times without being written will eventually expire
if the contract is dormant.  Each is tracked by a GitHub issue.

| Contract | Key | Issue |
|---|---|---|
| kyc-registry | `KycStatus(Address)` | Issues 8, 9 |
| compliance-engine | `HolderSince(Address)` | Issue 15 |
| rwa-token | `Allowance(AllowanceKey)`, `Frozen(Address)` | Issue 16 |
| carbon-credit-token | `Balance(Address)` | Issue 17 |
| property-token | `Balance(Address)` | Issue 17 |

Until these issues are resolved, operators should monitor ledger expiry for
high-value keys and call any state-mutating function (e.g. a zero-amount
transfer) to force a bump if needed.

---

## Choosing a storage tier for a new asset type

When forking Veritoken to build a new asset type, apply these rules:

1. **Use instance** for any value that is: (a) a single scalar or small struct,
   (b) read on nearly every transaction, and (c) should live exactly as long as
   the contract itself.  The instance bump on every entry-point covers these for
   free.

2. **Use persistent** for any value that is: (a) keyed by a variable (address,
   integer index, string ID), (b) one of potentially many entries with
   independent lifetimes, or (c) large enough that storing it in instance would
   make every instance read expensive.  Always call `extend_ttl` immediately
   after every `set` on a persistent key.

3. **Use temporary** only for data that is inherently short-lived and can be
   safely lost — such as allowances tied to a specific expiry ledger.  Never
   store anything in temporary storage that would cause data loss or security
   issues if it expired silently.

4. **Bump persistent keys on read** for keys on the critical path (e.g. balances
   read during every transfer).  The pattern is:

   ```rust
   let val = env.storage().persistent().get(&key).unwrap_or_default();
   env.storage().persistent().extend_ttl(&key, THRESHOLD, BUMP);
   val
   ```

See [docs/mainnet-deployment.md](mainnet-deployment.md) for production deployment
guidance, including the pre-deployment checklist that covers storage configuration.
