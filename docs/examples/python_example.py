"""
Veritoken — Python integration examples
========================================
Demonstrates three common workflows against deployed Veritoken contracts:

  1. Read compliance rules and token metadata (simulation — no signing needed)
  2. Check KYC state for an address
  3. Build, sign, and submit a token transfer

Prerequisites
-------------
    pip install stellar-sdk>=10.0.0

Set the contract IDs before running:

    export VITE_KYC_REGISTRY_ID=C...
    export VITE_COMPLIANCE_ENGINE_ID=C...
    export VITE_INVOICE_TOKEN_ID=C...
    export VITE_RWA_TOKEN_ID=C...
    export STELLAR_SECRET_KEY=S...   # required for workflow 3 only

TypeScript SDK equivalents are noted in inline comments so you can find the
corresponding method in sdk/src/clients/ for each call.
"""

import json
import os
import sys

# stellar-sdk >= 10 ships soroban support as a first-class feature.
from stellar_sdk import Keypair, Network, SorobanServer, TransactionBuilder
from stellar_sdk.soroban_rpc import SendTransactionStatus
from stellar_sdk.xdr import SCVal
from stellar_sdk import xdr as stellar_xdr

# ── Configuration ─────────────────────────────────────────────────────────────

NETWORK = os.getenv("STELLAR_NETWORK", "testnet")

if NETWORK == "mainnet":
    RPC_URL = "https://mainnet.sorobanrpc.com"
    NETWORK_PASSPHRASE = Network.PUBLIC_NETWORK_PASSPHRASE
else:
    RPC_URL = "https://soroban-testnet.stellar.org"
    NETWORK_PASSPHRASE = Network.TESTNET_NETWORK_PASSPHRASE

KYC_REGISTRY_ID = os.environ["VITE_KYC_REGISTRY_ID"]
COMPLIANCE_ENGINE_ID = os.environ["VITE_COMPLIANCE_ENGINE_ID"]
INVOICE_TOKEN_ID = os.environ["VITE_INVOICE_TOKEN_ID"]
RWA_TOKEN_ID = os.environ.get("VITE_RWA_TOKEN_ID", "")

# Address to inspect in the KYC workflow (replace with a real address)
EXAMPLE_ADDRESS = os.getenv("EXAMPLE_ADDRESS", "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN")

server = SorobanServer(RPC_URL)


# ── Helper: simulate a contract call and return the result SCVal ──────────────

def simulate_call(contract_id: str, function_name: str, args: list) -> SCVal:
    """
    Simulate a read-only contract call without submitting a transaction.

    TypeScript SDK equivalent:
        BaseContractClient.simulate(method, args)
    """
    from stellar_sdk import Address, scval as sv
    from stellar_sdk.contract import AssembledTransaction

    # Use a throwaway keypair for simulation — the source is not checked for reads.
    sim_keypair = Keypair.random()
    sim_account = server.load_account(sim_keypair.public_key)

    tx = (
        TransactionBuilder(sim_account, NETWORK_PASSPHRASE, base_fee=100)
        .add_text_memo("veritoken-sim")
        .append_invoke_contract_function_op(
            contract_id=contract_id,
            function_name=function_name,
            parameters=args,
        )
        .set_timeout(30)
        .build()
    )

    response = server.simulate_transaction(tx)
    if response.error:
        raise RuntimeError(f"Simulation error in {function_name}: {response.error}")

    return response.results[0].xdr


def scval_to_python(xdr_string: str):
    """Decode an XDR SCVal string to a Python-native value."""
    val = stellar_xdr.SCVal.from_xdr(xdr_string)
    # Map common SCVal types to Python primitives
    switch = val.sc_val_type
    SCValType = stellar_xdr.SCValType
    if switch == SCValType.SCV_BOOL:
        return val.b
    if switch == SCValType.SCV_U32:
        return val.u32.uint32
    if switch == SCValType.SCV_I32:
        return val.i32.int32
    if switch == SCValType.SCV_U64:
        return val.u64.uint64
    if switch == SCValType.SCV_I64:
        return val.i64.int64
    if switch == SCValType.SCV_U128:
        hi = val.u128.hi.uint64
        lo = val.u128.lo.uint64
        return (hi << 64) | lo
    if switch == SCValType.SCV_I128:
        hi = val.i128.hi.int64
        lo = val.i128.lo.uint64
        return (hi << 64) | lo
    if switch == SCValType.SCV_STRING:
        return val.str.sc_string.decode()
    if switch == SCValType.SCV_SYMBOL:
        return val.sym.sc_symbol.decode()
    if switch == SCValType.SCV_MAP:
        return {
            scval_to_python(e.key.to_xdr()): scval_to_python(e.val.to_xdr())
            for e in val.map.sc_map
        }
    if switch == SCValType.SCV_VEC:
        return [scval_to_python(v.to_xdr()) for v in val.vec.sc_vec]
    return val  # return raw for unsupported types


# ── Workflow 1: Read compliance rules and token metadata ──────────────────────

def workflow_read_metadata():
    """
    Fetch the compliance rules from the compliance engine and the invoice
    metadata from the invoice token contract.

    TypeScript SDK equivalents:
        ComplianceEngineClient.getRules()   → compliance-engine::get_rules
        InvoiceTokenClient.getMeta()        → invoice-token::get_meta
    """
    print("\n── Workflow 1: Read metadata ─────────────────────────────────────")

    # Fetch compliance rules — no arguments required
    rules_xdr = simulate_call(COMPLIANCE_ENGINE_ID, "get_rules", [])
    rules = scval_to_python(rules_xdr)
    print("Compliance rules:")
    print(json.dumps(rules, indent=2, default=str))

    # Fetch invoice token metadata
    meta_xdr = simulate_call(INVOICE_TOKEN_ID, "get_meta", [])
    meta = scval_to_python(meta_xdr)
    print("\nInvoice token metadata:")
    print(json.dumps(meta, indent=2, default=str))


# ── Workflow 2: Check KYC state for an address ────────────────────────────────

def workflow_check_kyc(address: str):
    """
    Query whether an address has an active KYC record and what tier it holds.

    TypeScript SDK equivalents:
        KycRegistryClient.isApproved(addr)  → kyc-registry::is_approved
        KycRegistryClient.getRecord(addr)   → kyc-registry::get_record
        KycRegistryClient.getTier(addr)     → kyc-registry::get_tier
    """
    print("\n── Workflow 2: KYC state check ───────────────────────────────────")
    print(f"Checking KYC state for: {address}")

    from stellar_sdk import scval as sv, Address

    addr_arg = stellar_xdr.SCVal(
        sc_val_type=stellar_xdr.SCValType.SCV_ADDRESS,
        address=stellar_xdr.SCAddress(
            type=stellar_xdr.SCAddressType.SC_ADDRESS_TYPE_ACCOUNT,
            account_id=stellar_xdr.AccountID(
                account_id=stellar_xdr.PublicKey(
                    type=stellar_xdr.PublicKeyType.PUBLIC_KEY_TYPE_ED25519,
                    ed25519=stellar_xdr.Uint256(
                        Keypair.from_public_key(address).raw_public_key()
                    ),
                )
            ),
        ),
    )

    # is_approved returns a boolean
    approved_xdr = simulate_call(KYC_REGISTRY_ID, "is_approved", [addr_arg])
    is_approved = scval_to_python(approved_xdr)
    print(f"  is_approved: {is_approved}")

    # get_tier returns u32 (0=Basic, 1=Accredited, 2=Institutional)
    tier_xdr = simulate_call(KYC_REGISTRY_ID, "get_tier", [addr_arg])
    tier = scval_to_python(tier_xdr)
    tier_names = {0: "Basic", 1: "Accredited", 2: "Institutional"}
    print(f"  tier: {tier} ({tier_names.get(tier, 'unknown')})")

    # get_record returns the full KYC record struct
    record_xdr = simulate_call(KYC_REGISTRY_ID, "get_record", [addr_arg])
    record = scval_to_python(record_xdr)
    print("  full record:")
    print(json.dumps(record, indent=4, default=str))


# ── Workflow 3: Build, sign, and submit a token transfer ──────────────────────

def workflow_transfer(secret_key: str, to_address: str, amount: int):
    """
    Build a transfer transaction, sign it with the provided keypair, and
    submit it to the network.

    amount is in stroops — 7 decimal places.
    For example, to transfer 1.0 token pass amount=10_000_000.

    TypeScript SDK equivalent:
        RwaTokenClient.buildTransferXdr(from, to, amount)
        — then sign and submit via Freighter or stellar-sdk TransactionBuilder
    """
    print("\n── Workflow 3: Token transfer ────────────────────────────────────")

    keypair = Keypair.from_secret(secret_key)
    source_address = keypair.public_key
    print(f"  from: {source_address}")
    print(f"  to:   {to_address}")
    print(f"  amount: {amount} stroops ({amount / 10_000_000:.7f} tokens)")

    account = server.load_account(source_address)

    def make_address_scval(pub: str) -> stellar_xdr.SCVal:
        return stellar_xdr.SCVal(
            sc_val_type=stellar_xdr.SCValType.SCV_ADDRESS,
            address=stellar_xdr.SCAddress(
                type=stellar_xdr.SCAddressType.SC_ADDRESS_TYPE_ACCOUNT,
                account_id=stellar_xdr.AccountID(
                    account_id=stellar_xdr.PublicKey(
                        type=stellar_xdr.PublicKeyType.PUBLIC_KEY_TYPE_ED25519,
                        ed25519=stellar_xdr.Uint256(
                            Keypair.from_public_key(pub).raw_public_key()
                        ),
                    )
                ),
            ),
        )

    def make_i128_scval(value: int) -> stellar_xdr.SCVal:
        hi = value >> 64
        lo = value & 0xFFFF_FFFF_FFFF_FFFF
        return stellar_xdr.SCVal(
            sc_val_type=stellar_xdr.SCValType.SCV_I128,
            i128=stellar_xdr.Int128Parts(
                hi=stellar_xdr.Int64(hi),
                lo=stellar_xdr.Uint64(lo),
            ),
        )

    tx = (
        TransactionBuilder(account, NETWORK_PASSPHRASE, base_fee=100)
        .append_invoke_contract_function_op(
            contract_id=RWA_TOKEN_ID,
            function_name="transfer",
            parameters=[
                make_address_scval(source_address),
                make_address_scval(to_address),
                make_i128_scval(amount),
            ],
        )
        .set_timeout(30)
        .build()
    )

    # Simulate first to get the resource footprint and updated fee
    sim_resp = server.simulate_transaction(tx)
    if sim_resp.error:
        print(f"  Simulation failed: {sim_resp.error}")
        return

    tx = server.prepare_transaction(tx, sim_resp)
    tx.sign(keypair)

    response = server.send_transaction(tx)
    print(f"  Submitted tx hash: {response.hash}")

    if response.status == SendTransactionStatus.ERROR:
        print(f"  Error: {response.error_result_xdr}")
        return

    # Poll for the result
    import time
    for _ in range(10):
        time.sleep(2)
        result = server.get_transaction(response.hash)
        from stellar_sdk.soroban_rpc import GetTransactionStatus
        if result.status == GetTransactionStatus.SUCCESS:
            print("  Transfer confirmed ✓")
            return
        if result.status == GetTransactionStatus.FAILED:
            print(f"  Transfer failed: {result.result_xdr}")
            return

    print("  Timed out waiting for confirmation — check the explorer.")


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    workflow_read_metadata()
    workflow_check_kyc(EXAMPLE_ADDRESS)

    secret = os.getenv("STELLAR_SECRET_KEY")
    to_addr = os.getenv("TRANSFER_TO_ADDRESS", EXAMPLE_ADDRESS)
    amount_str = os.getenv("TRANSFER_AMOUNT", "10000000")  # default: 1.0 token

    if secret and RWA_TOKEN_ID:
        workflow_transfer(secret, to_addr, int(amount_str))
    else:
        print(
            "\n── Workflow 3 skipped ────────────────────────────────────────────\n"
            "Set STELLAR_SECRET_KEY and VITE_RWA_TOKEN_ID to run the transfer workflow."
        )
