# Compliance Validation & Smart Contract Enhancements

## Overview

This PR adds comprehensive frontend form validation, enhanced CI testing, and a critical buyback mechanism for real estate tokenization.

---

## Issue 1: Add Frontend Address Validation for Stellar Public Keys

### Problem

All form inputs accepting Stellar addresses (public keys) had no client-side validation. Users could paste typos or non-Stellar addresses, submit transactions that failed on-chain, waste fees, and receive confusing errors.

### Solution

Implemented address validation using Stellar SDK's `StrKey.isValidEd25519PublicKey()` function:

- **Created `useAddressValidation()` hook** (`frontend/src/lib/useAddressValidation.ts`)
  - Validates Stellar ED25519 public keys on input change
  - Returns `{ isValid: boolean, error: string | null }`
  - Empty values treated as valid (optional fields)
  - Invalid addresses display: "Invalid Stellar address"

- **Added validation helper** (`frontend/src/lib/stellar.ts`)
  - `validateStellarAddress(address: string): boolean` function
  - Leverages Stellar SDK with safe error handling

- **Enhanced Field component** (`frontend/src/components/ui.tsx`)
  - New optional `error` prop for inline error display
  - Red border styling on validation error
  - Error message displayed below input

- **Applied to all address input pages**:
  - **KycPage**: Validates `lookup` and `subject` address fields
  - **CarbonPage**: Validates `mintTo` and `transferTo` addresses
  - **AdminPage**: No Stellar addresses (compliance rules only)
  - **InvoicePage**: No Stellar addresses (company names only)
  - **PropertyPage**: No Stellar addresses (physical addresses only)

- **Form submit buttons disabled** when address validation errors exist

### Acceptance Criteria Met

✅ All address inputs validate on change  
✅ Invalid addresses show inline error messages  
✅ Submit buttons disabled while errors exist  
✅ Valid addresses clear the error  
✅ Build passes with no errors

---

## Issue 2: Add Amount Input Validation to All Frontend Forms

### Problem

Amount fields (mint amount, transfer amount, dividend deposit, retirement amount) accepted any string input. Non-numeric values, negative numbers, and values exceeding JavaScript's safe integer range resulted in failed transactions or corrupted data.

### Solution

Implemented comprehensive amount validation with decimal precision and safe integer checks:

- **Created `useAmountValidation()` hook** (`frontend/src/lib/validation.ts`)
  - Validates amount string with configurable decimal places (default 7 for Stellar)
  - Checks: positive number, non-zero, valid numeric format, decimal precision, safe integer range
  - Returns `{ isValid: boolean, error: string | null }`
  - Error messages for: negative amounts, zero amounts, non-numeric input, precision overflow, safe integer exceeded

- **Applied to CarbonPage**:
  - Validates: `mintAmount`, `transferAmount`, `retireAmount`
  - Displays inline errors with specific messages
  - Disables submit buttons when errors present

- **Applied to InvoicePage**:
  - Validates: `face_value_usd`, `discount_rate_bps`
  - Inline error display and button disabling

- **Applied to PropertyPage**:
  - Validates: `total_valuation_usd`, `total_shares`
  - Consistent validation pattern across all pages

### Validation Checks

✅ Rejects negative amounts  
✅ Rejects zero amounts  
✅ Rejects non-numeric input  
✅ Enforces decimal precision (7 places for Stellar tokens)  
✅ Validates against `Number.MAX_SAFE_INTEGER`  
✅ Submit buttons disabled on validation errors  
✅ Build passes

---

## Issue 3: Add Cargo Test to CI for All Contracts Individually

### Problem

CI ran `cargo test --features testutils` at the workspace level. If one contract's test failed to compile due to a bug in shared dependencies, the error message was ambiguous. A single contract failure blocked all results.

### Solution

CI workflow already had the correct matrix-based testing strategy in place:

- **Existing Configuration** (`.github/workflows/ci.yml`):
  - Job name: `test`
  - Strategy: `fail-fast: false` ✅
  - Matrix: All 6 contracts tested independently
    - compliance-engine
    - kyc-registry
    - rwa-token
    - invoice-token
    - property-token
    - carbon-credit-token
  - Command: `cargo test --features testutils -p ${{ matrix.contract }}`
  - Per-contract caching for speed optimization

- **Benefits**:
  - Each contract test runs independently in parallel
  - Failures clearly attributed to specific contract
  - All tests run despite individual failures
  - Faster CI with parallel execution
  - Clear job naming with contract identifier

### Acceptance Criteria Met

✅ CI runs tests for each contract independently  
✅ Failures clearly attributed to specific contract  
✅ fail-fast: false configured  
✅ All six contract test jobs appear in results  
✅ Parallel execution enabled

---

## Issue 4: Add Property-Token Buyback (Admin Burn) Mechanism

### Problem

Real estate assets require issuers to buy back shares from investors (fund lifecycle, shareholder violations). The property-token had no admin-initiated burn function. Only holders could self-burn, and only if burn was implemented.

### Solution

Implemented admin-only buyback function with dividend snapshotting and compliance checks:

- **Added `buyback(env, from: Address, shares: i128)` function** (`contracts/property-token/src/lib.rs`)
  - **Admin-only**: Requires `require_admin()` authorization
  - **KYC enforcement**: Holder must have active KYC approval
  - **Validation**: Positive share amounts, sufficient balance
  - **Dividend snapshotting**: `accrue()` called before balance changes to preserve accrued dividends
  - **Balance burn**: Shares removed from holder's account
  - **Total shares decreased**: Minted shares counter updated
  - **Debt reset**: `reset_debt()` called for new dividend basis
  - **Holder removal**: Automatically removes holder if balance reaches zero
  - **Event emission**: Buyback event logged with holder and share count

- **Comprehensive test coverage** (`contracts/property-token/src/test.rs`):
  1. **Successful buyback**: Admin buys back shares, dividends preserved, total shares decreased, holder can claim accrued dividends
  2. **Insufficient shares**: Rejects buyback exceeding holder's balance
  3. **Zero balance cleanup**: Removes holder from list when balance hits zero
  4. **Non-admin rejection**: Non-admins cannot initiate buyback
  5. **KYC unapproved holder**: Buyback fails if holder's KYC is revoked

### Acceptance Criteria Met

✅ Admin can burn any holder's shares  
✅ Dividends snapshotted before burn via `accrue()`  
✅ Total minted shares decrease correctly  
✅ Holder can still claim accrued dividends after buyback  
✅ Comprehensive test coverage (5 test cases)  
✅ KYC compliance enforced  
✅ Holder list updated correctly

---

## Summary

This PR delivers:

- **Frontend**: Complete input validation for addresses and amounts across all token forms
- **CI/CD**: Verified parallel contract testing infrastructure
- **Smart Contracts**: Critical buyback mechanism for real estate tokenization lifecycle

All acceptance criteria met. All tests pass. Build successful.
