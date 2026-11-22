"""Read an on-chain carbon retirement receipt without signing or submitting.

Requires Python 3.10+ and stellar-sdk>=10.0.0, as in python_example.py.
Set VITE_CARBON_TOKEN_ID to your deployed contract ID (C...).
Usage from the repository root: python docs/examples/carbon_receipt.py 0

On-chain data is not a substitute for external project/registry verification.
"""

import argparse
import json
import os

from stellar_sdk import Account, Keypair, Network, SorobanServer, TransactionBuilder
from stellar_sdk import scval, xdr


def lookup_receipt(server, contract_id, network_passphrase, index):
    """Return one decoded receipt, or None for an empty get_receipts page."""
    if not 0 <= index <= 0xFFFF_FFFE:
        # get_receipts computes start + limit in u32; leave room for limit=1.
        raise ValueError("index must be between 0 and 4294967294")

    # A synthetic source avoids loading/funding an account. No secret is read,
    # persisted, or printed; this envelope is only sent to simulation.
    source = Account(Keypair.random().public_key, sequence=0)
    transaction = (
        TransactionBuilder(source, network_passphrase, base_fee=100)
        .append_invoke_contract_function_op(
            contract_id=contract_id,
            function_name="get_receipts",
            parameters=[scval.to_uint32(index), scval.to_uint32(1)],
        )
        .set_timeout(30)
        .build()
    )
    response = server.simulate_transaction(transaction)
    if response.error:
        raise RuntimeError("Receipt simulation failed: " + response.error)
    if not response.results:
        raise RuntimeError("Receipt simulation returned no result")

    # Use the SDK's native XDR decoder for structs, addresses, and i128 amounts.
    receipts = scval.to_native(xdr.SCVal.from_xdr(response.results[0].xdr))
    if not isinstance(receipts, list):
        raise RuntimeError("Expected a receipt vector from get_receipts")
    return receipts[0] if receipts else None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("index", type=int, help="Zero-based global receipt index")
    args = parser.parse_args()
    if not 0 <= args.index <= 0xFFFF_FFFE:
        parser.error("index must be between 0 and 4294967294")
    contract_id = os.environ.get("VITE_CARBON_TOKEN_ID", "")
    if not contract_id:
        parser.error("Set VITE_CARBON_TOKEN_ID to your deployed carbon contract ID")

    network = os.environ.get("STELLAR_NETWORK", "testnet")
    networks = {
        "testnet": ("https://soroban-testnet.stellar.org",
                    Network.TESTNET_NETWORK_PASSPHRASE),
        "mainnet": ("https://mainnet.sorobanrpc.com",
                    Network.PUBLIC_NETWORK_PASSPHRASE),
        "standalone": ("http://localhost:8000/soroban/rpc",
                       "Standalone Network ; February 2017"),
    }
    if network not in networks:
        parser.error("STELLAR_NETWORK must be testnet, mainnet, or standalone")
    default_rpc, passphrase = networks[network]
    rpc_url = os.environ.get("STELLAR_RPC_URL") or default_rpc
    server = SorobanServer(rpc_url, allow_http=rpc_url.startswith("http://"))
    receipt = lookup_receipt(server, contract_id, passphrase, args.index)
    if receipt is None:
        print(f"No retirement receipt found at index {args.index} (empty page).")
    else:
        print(json.dumps(receipt, indent=2, default=str))
    print("On-chain data does not replace external project/registry verification.")


if __name__ == "__main__":
    main()
