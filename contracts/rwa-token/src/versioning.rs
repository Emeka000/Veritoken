#![cfg_attr(not(test), deny(clippy::unwrap_used))]

use soroban_sdk::{Env, String};

use crate::storage_types::{DataKey, INSTANCE_BUMP_AMOUNT, INSTANCE_LIFETIME_THRESHOLD};
use crate::MigrationRecord;

pub fn write_initial_version(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    let v = String::from_str(env, env!("CARGO_PKG_VERSION"));
    env.storage().instance().set(&DataKey::ContractSemver, &v);
    env.storage()
        .instance()
        .set(&DataKey::MigrationCount, &0u32);
    // Numeric schema version — new deployments start at 1.
    env.storage().instance().set(&DataKey::SchemaVersion, &1u32);
    env.storage()
        .instance()
        .set(&DataKey::SchemaMigrationCount, &0u32);
}

pub fn read_schema_version(env: &Env) -> u32 {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    env.storage()
        .instance()
        .get(&DataKey::SchemaVersion)
        .unwrap_or(0)
}

pub fn read_version(env: &Env) -> String {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    env.storage()
        .instance()
        .get(&DataKey::ContractSemver)
        .unwrap_or_else(|| String::from_str(env, env!("CARGO_PKG_VERSION")))
}

pub fn read_migration_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    env.storage()
        .instance()
        .get(&DataKey::MigrationCount)
        .unwrap_or(0)
}

pub fn apply_migration(env: &Env, new_version: String, description: String) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    let from_version = read_version(env);
    let count = read_migration_count(env);
    let record = MigrationRecord {
        from_version,
        to_version: new_version.clone(),
        timestamp: env.ledger().timestamp(),
        description,
    };
    env.storage()
        .instance()
        .set(&DataKey::Migration(count), &record);
    env.storage()
        .instance()
        .set(&DataKey::MigrationCount, &(count + 1));
    env.storage()
        .instance()
        .set(&DataKey::ContractSemver, &new_version);
}

pub fn get_migration_record(env: &Env, index: u32) -> Option<MigrationRecord> {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    env.storage().instance().get(&DataKey::Migration(index))
}
