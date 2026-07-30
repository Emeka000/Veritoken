"""Upgrade simulation (#445).

Soroban contracts in this repo are immutable — there is no in-place upgrade
path (see `docs/incident-response.md` §4). An "upgrade" is a full
snapshot-and-redeploy: build new WASM, deploy it as a new contract instance,
run `migrate_schema`, then cut the frontend/registry over to the new
contract ID. That procedure is risky to get wrong, and today nothing checks
a proposed upgrade *before* it's executed.

`simulate_upgrade()` models that outcome ahead of time, entirely offline by
default:

  * Diffs the new WASM artifact's exported function interface against the
    currently-deployed artifact (recorded in the deployment manifest) using
    `wasm_interface.extract_function_exports` — flags removed functions as a
    breaking-change risk for existing callers (frontend, SDK, other
    contracts).
  * Validates a proposed `to_schema_version` against the contract's own
    sequential-migration rule (`to_version == current + 1`), so an operator
    catches a `MigrationVersionNotSequential`/`AlreadyAtSchemaVersion`
    failure before spending a real transaction.
  * Optionally performs a *read-only* on-chain check (a `schema_version`
    invoke) to confirm the migration would apply against live state, when a
    client/identity/network are supplied.

Nothing here deploys, uploads, or mutates chain state.
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

from .models import (
    DeploymentError,
    load_json_object,
    sha256_file,
    validate_artifact,
)
from .runner import StellarClient
from .wasm_interface import extract_function_exports

SIMULATION_SCHEMA_VERSION = 1


def simulate_upgrade(
    *,
    contract_name: str,
    manifest_path: Path,
    new_artifact: Path,
    repo_root: Path,
    to_schema_version: int | None = None,
    client: StellarClient | None = None,
    identity: str | None = None,
    network: Any | None = None,
    generated_at: str | None = None,
) -> dict[str, Any]:
    """Build an upgrade-simulation report for `contract_name`.

    Raises `DeploymentError` if the manifest, its record for
    `contract_name`, or either WASM artifact can't be read — those are
    setup problems, not simulation findings.
    """
    repo_root = repo_root.resolve()
    manifest = load_json_object(manifest_path)
    contracts = manifest.get("contracts")
    if not isinstance(contracts, dict):
        raise DeploymentError(f"manifest has no contracts: {manifest_path}")
    record = contracts.get(contract_name)
    if not isinstance(record, dict):
        raise DeploymentError(
            f"manifest has no record for contract {contract_name!r}: {manifest_path}"
        )

    old_artifact = _current_artifact_path(record, repo_root)
    validate_artifact(old_artifact)
    validate_artifact(new_artifact)

    old_hash = sha256_file(old_artifact)
    new_hash = sha256_file(new_artifact)
    wasm_changed = old_hash != new_hash

    old_exports = set(extract_function_exports(old_artifact))
    new_exports = set(extract_function_exports(new_artifact))
    removed_functions = sorted(old_exports - new_exports)
    added_functions = sorted(new_exports - old_exports)

    risks: list[dict[str, str]] = []
    for name in removed_functions:
        risks.append(
            {
                "level": "critical",
                "message": (
                    f"Function '{name}' is exported by the currently deployed "
                    f"contract but missing from the new artifact — existing "
                    f"callers (frontend, SDK, other contracts) referencing it "
                    f"will break after cutover."
                ),
            }
        )

    schema_migration: dict[str, Any] | None = None
    if to_schema_version is not None:
        current_schema_version = _read_live_schema_version(
            record=record,
            client=client,
            identity=identity,
            network=network,
        )
        sequential = (
            current_schema_version is not None
            and to_schema_version == current_schema_version + 1
        )
        schema_migration = {
            "current_schema_version": current_schema_version,
            "requested_to_version": to_schema_version,
            "sequential": sequential if current_schema_version is not None else None,
        }
        if current_schema_version is None:
            risks.append(
                {
                    "level": "warning",
                    "message": (
                        "Could not read the live schema_version (no client/identity/"
                        "network supplied, or the read failed) — schema-version "
                        "sequencing was not validated."
                    ),
                }
            )
        elif to_schema_version <= current_schema_version:
            risks.append(
                {
                    "level": "critical",
                    "message": (
                        f"Requested schema version {to_schema_version} is not "
                        f"greater than the live version {current_schema_version} "
                        f"— migrate_schema will reject this as AlreadyAtSchemaVersion "
                        f"or MigrationVersionNotSequential."
                    ),
                }
            )
        elif not sequential:
            risks.append(
                {
                    "level": "critical",
                    "message": (
                        f"Requested schema version {to_schema_version} is not the "
                        f"next sequential version after {current_schema_version} "
                        f"(expected {current_schema_version + 1}) — migrate_schema "
                        f"requires to_version == current + 1 and will reject this call."
                    ),
                }
            )

    if not wasm_changed and not removed_functions and not added_functions:
        risks.append(
            {
                "level": "info",
                "message": (
                    "The new artifact is byte-identical to the currently "
                    "deployed WASM — there is nothing to upgrade."
                ),
            }
        )

    timestamp = generated_at or datetime.now(timezone.utc).isoformat().replace(
        "+00:00", "Z"
    )
    critical_count = sum(1 for r in risks if r["level"] == "critical")
    return {
        "schema_version": SIMULATION_SCHEMA_VERSION,
        "status": "attention" if critical_count else "ok",
        "generated_at": timestamp,
        "contract": contract_name,
        "old_artifact": {"path": str(old_artifact), "sha256": old_hash},
        "new_artifact": {"path": str(new_artifact), "sha256": new_hash},
        "wasm_changed": wasm_changed,
        "interface": {
            "added_functions": added_functions,
            "removed_functions": removed_functions,
            "unchanged_function_count": len(old_exports & new_exports),
        },
        "schema_migration": schema_migration,
        "risks": risks,
        "summary": {
            "risk_count": len(risks),
            "critical_risk_count": critical_count,
            "removed_function_count": len(removed_functions),
            "added_function_count": len(added_functions),
        },
    }


def _current_artifact_path(record: Mapping[str, Any], repo_root: Path) -> Path:
    artifact = record.get("artifact")
    if not isinstance(artifact, dict):
        raise DeploymentError("manifest contract record is missing artifact metadata")
    path_value = artifact.get("path")
    if not isinstance(path_value, str) or not path_value:
        raise DeploymentError("manifest contract record has no artifact path")
    path = Path(path_value)
    return path if path.is_absolute() else (repo_root / path).resolve()


def _read_live_schema_version(
    *,
    record: Mapping[str, Any],
    client: StellarClient | None,
    identity: str | None,
    network: Any | None,
) -> int | None:
    if client is None or identity is None or network is None:
        return None
    contract_id = record.get("contract_id")
    if not isinstance(contract_id, str) or not contract_id:
        return None
    try:
        output = client.invoke(contract_id, identity, network, "schema_version", {})
        return int(output.strip().strip('"'))
    except (DeploymentError, ValueError):
        return None
