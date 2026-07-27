/// Structured event emission for the RWA Token contract.
///
/// ## Event schema
///
/// Every event is published as `env.events().publish(topics, data)`.
/// Topics are `(Symbol, ...)` tuples; data carries the payload.
///
/// | Function              | Topics                          | Data                         |
/// |---------------------- |---------------------------------|------------------------------|
/// | emit_transfer         | ("transfer", from, to)          | (amount: i128, ts: u64)      |
/// | emit_mint             | ("mint", to)                    | (amount: i128, ts: u64)      |
/// | emit_burn             | ("burn", from)                  | (amount: i128, ts: u64)      |
/// | emit_approve          | ("approve", from, spender)      | (amount: i128, exp: u32)     |
/// | emit_freeze           | ("freeze", addr)                | ()                           |
/// | emit_unfreeze         | ("unfreeze", addr)              | ()                           |
/// | emit_admin_proposed   | ("adm_prp",)                    | new_admin: Address           |
/// | emit_admin_set        | ("adm_set",)                    | (old: Address, new: Address) |
/// | emit_kyc_updated      | ("kyc_upd",)                    | new_registry: Address        |
/// | emit_ce_updated       | ("ce_upd",)                     | new_engine: Address          |
///
/// All timestamps (`ts`) are Soroban ledger timestamps (Unix epoch, seconds).
///
/// ## Indexing with Stellar RPC
///
/// Use `getEvents` with a `ContractId` filter and topic filters:
/// ```json
/// { "type": "contract", "contractIds": ["<id>"],
///   "topics": [["AAAADwAAAAh0cmFuc2Zlcg=="]] }
/// ```
/// (The base64 value encodes the `Symbol` "transfer".)
///
/// Iterate returned events; each entry's `value.xdr` decodes to the data tuple.

use soroban_sdk::{symbol_short, Address, Env};

pub fn emit_transfer(env: &Env, from: Address, to: Address, amount: i128) {
    env.events().publish(
        (symbol_short!("transfer"), from, to),
        (amount, env.ledger().timestamp()),
    );
}

pub fn emit_mint(env: &Env, to: Address, amount: i128) {
    env.events().publish(
        (symbol_short!("mint"), to),
        (amount, env.ledger().timestamp()),
    );
}

pub fn emit_burn(env: &Env, from: Address, amount: i128) {
    env.events().publish(
        (symbol_short!("burn"), from),
        (amount, env.ledger().timestamp()),
    );
}

pub fn emit_approve(env: &Env, from: Address, spender: Address, amount: i128, expiration_ledger: u32) {
    env.events().publish(
        (symbol_short!("approve"), from, spender),
        (amount, expiration_ledger),
    );
}

pub fn emit_freeze(env: &Env, addr: Address) {
    env.events().publish((symbol_short!("freeze"), addr), ());
}

pub fn emit_unfreeze(env: &Env, addr: Address) {
    env.events().publish((symbol_short!("unfreeze"), addr), ());
}

pub fn emit_admin_proposed(env: &Env, new_admin: Address) {
    env.events().publish((symbol_short!("adm_prp"),), new_admin);
}

pub fn emit_admin_set(env: &Env, old_admin: Address, new_admin: Address) {
    env.events()
        .publish((symbol_short!("adm_set"),), (old_admin, new_admin));
}

pub fn emit_kyc_updated(env: &Env, new_registry: Address) {
    env.events()
        .publish((symbol_short!("kyc_upd"),), new_registry);
}

pub fn emit_ce_updated(env: &Env, new_engine: Address) {
    env.events()
        .publish((symbol_short!("ce_upd"),), new_engine);
}
