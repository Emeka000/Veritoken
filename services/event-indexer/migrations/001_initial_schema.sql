-- Migration 001: initial schema for the Veritoken event indexer
-- Creates the four core tables used by ContractPoller and the REST API.

BEGIN;

-- ── cursors ──────────────────────────────────────────────────────────────────
-- One row per indexed contract. Stores the last Soroban RPC paging token
-- successfully committed to the events table so the poller resumes correctly
-- after a restart without replaying already-indexed events.

CREATE TABLE IF NOT EXISTS cursors (
  contract_id  TEXT        PRIMARY KEY,
  last_cursor  TEXT        NOT NULL DEFAULT '',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── events ───────────────────────────────────────────────────────────────────
-- One row per raw Soroban contract event. `paging_token` is the unique
-- identifier the RPC server assigns; the UNIQUE constraint is the idempotency
-- guard that makes upserts safe.

CREATE TABLE IF NOT EXISTS events (
  id               BIGSERIAL   PRIMARY KEY,
  contract_id      TEXT        NOT NULL,
  event_type       TEXT        NOT NULL,
  ledger_sequence  BIGINT      NOT NULL,
  timestamp        TIMESTAMPTZ NOT NULL,
  topics           JSONB       NOT NULL DEFAULT '[]',
  value            JSONB       NOT NULL DEFAULT 'null',
  paging_token     TEXT        NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS events_contract_id_idx    ON events (contract_id);
CREATE INDEX IF NOT EXISTS events_event_type_idx     ON events (event_type);
CREATE INDEX IF NOT EXISTS events_ledger_sequence_idx ON events (ledger_sequence);
CREATE INDEX IF NOT EXISTS events_timestamp_idx      ON events (timestamp);

-- ── compliance_violations ────────────────────────────────────────────────────
-- Extracted from `compliance_violation` topic events. Enables the
-- GET /compliance/violations endpoint without a full table scan of events.

CREATE TABLE IF NOT EXISTS compliance_violations (
  id               BIGSERIAL   PRIMARY KEY,
  contract_id      TEXT        NOT NULL,
  from_addr        TEXT        NOT NULL DEFAULT '',
  to_addr          TEXT        NOT NULL DEFAULT '',
  deny_reason      TEXT        NOT NULL DEFAULT '',
  ledger_sequence  BIGINT      NOT NULL,
  timestamp        TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS violations_contract_id_idx ON compliance_violations (contract_id);
CREATE INDEX IF NOT EXISTS violations_timestamp_idx   ON compliance_violations (timestamp);

-- ── kyc_changes ──────────────────────────────────────────────────────────────
-- Extracted from KYC approve / revoke / reject / tier_update events.
-- Enables the GET /kyc/pending-expiry endpoint efficiently.

CREATE TABLE IF NOT EXISTS kyc_changes (
  id               BIGSERIAL   PRIMARY KEY,
  subject          TEXT        NOT NULL,
  verifier         TEXT        NOT NULL DEFAULT '',
  new_status       TEXT        NOT NULL DEFAULT '',
  tier             INT         NOT NULL DEFAULT 0,
  jurisdiction     TEXT        NOT NULL DEFAULT '',
  expiry           BIGINT      NOT NULL DEFAULT 0,
  ledger_sequence  BIGINT      NOT NULL,
  timestamp        TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS kyc_changes_subject_idx   ON kyc_changes (subject);
CREATE INDEX IF NOT EXISTS kyc_changes_expiry_idx    ON kyc_changes (expiry);
CREATE INDEX IF NOT EXISTS kyc_changes_timestamp_idx ON kyc_changes (timestamp);

COMMIT;
