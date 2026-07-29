from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping

from .models import (
    MANIFEST_SCHEMA_VERSION,
    DeploymentConfig,
    DeploymentError,
    HealthCheck,
    NetworkConfig,
    VerificationFailed,
    atomic_write_json,
    atomic_write_text,
    canonical_json,
    file_sha256_or_none,
    load_json_object,
    sha256_file,
    sha256_text,
    validate_artifact,
)
from .runner import StellarClient


TEMPLATE_RE = re.compile(r"\$\{([a-zA-Z0-9_.-]+)\}")
INTEGER_RE = re.compile(r"^-?[0-9]+$")
LEGACY_MANIFEST_KEYS = {
    "kyc_registry": "kyc_registry_id",
    "compliance_engine": "compliance_engine_id",
    "invoice_token": "invoice_token_id",
    "property_token": "property_token_id",
    "carbon_credit_token": "carbon_token_id",
    "rwa_token": "rwa_token_id",
}


class DeploymentOrchestrator:
    """Dependency-ordered, resumable deployment with an atomic registry commit."""

    def __init__(
        self,
        client: StellarClient,
        *,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self.client = client
        self._now = now or (lambda: datetime.now(timezone.utc))

    def deploy(
        self,
        *,
        config: DeploymentConfig,
        repo_root: Path,
        wasm_dir: Path,
        identity: str,
        network: NetworkConfig,
        manifest_path: Path,
        report_path: Path,
        frontend_env_path: Path,
        resume: bool = False,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        repo_root = repo_root.resolve()
        wasm_dir = _resolve_path(wasm_dir, repo_root)
        manifest_path = _resolve_path(manifest_path, repo_root)
        report_path = _resolve_path(report_path, repo_root)
        frontend_env_path = _resolve_path(frontend_env_path, repo_root)
        partial_path = partial_manifest_path(manifest_path)
        config.validate_for_network(network)

        ordered = config.ordered_contracts()
        artifact_inputs: dict[str, tuple[Path, str, str]] = {}
        for contract in ordered:
            artifact_path = _artifact_path(contract.artifact, repo_root, wasm_dir)
            validate_artifact(artifact_path)
            artifact_hash = sha256_file(artifact_path)
            local_metadata = self.client.contract_metadata(artifact=artifact_path)
            artifact_inputs[contract.name] = (
                artifact_path,
                artifact_hash,
                sha256_text(local_metadata),
            )

        admin_address = self.client.account_address(identity)
        config_hash = sha256_file(config.source_path)
        previous_hash = file_sha256_or_none(manifest_path)
        previous_generation = 0
        if manifest_path.exists():
            previous = load_json_object(manifest_path)
            try:
                previous_generation = int(previous.get("generation", 0))
            except (TypeError, ValueError) as exc:
                raise DeploymentError(
                    f"existing manifest has invalid generation: {manifest_path}"
                ) from exc

        if partial_path.exists():
            if not resume:
                raise DeploymentError(
                    f"incomplete deployment checkpoint exists: {partial_path}. "
                    "Re-run with --resume after reviewing it."
                )
            manifest = load_json_object(partial_path)
            self._validate_resume_context(
                manifest=manifest,
                identity=identity,
                admin_address=admin_address,
                network=network,
                config_hash=config_hash,
            )
        else:
            started_at = self._timestamp()
            deployment_id = sha256_text(
                canonical_json(
                    {
                        "network": network.as_public_dict(),
                        "source_account": admin_address,
                        "config_sha256": config_hash,
                        "started_at": started_at,
                    }
                )
            )
            manifest = {
                "schema_version": MANIFEST_SCHEMA_VERSION,
                "status": "in_progress",
                "deployment_id": deployment_id,
                "generation": previous_generation + 1,
                "previous_manifest_sha256": previous_hash,
                "started_at": started_at,
                "updated_at": started_at,
                "identity": identity,
                "source_account": admin_address,
                "network": network.as_public_dict(),
                "network_name": network.name,
                "config": {
                    "path": _portable_path(config.source_path, repo_root),
                    "sha256": config_hash,
                    "profile": config.profile,
                },
                "contracts": {},
            }
            self._checkpoint(partial_path, manifest)

        for contract in ordered:
            artifact_path, artifact_hash, local_metadata_hash = artifact_inputs[
                contract.name
            ]

            contracts = _require_dict(manifest, "contracts")
            existing = contracts.get(contract.name)
            if existing is None:
                record: dict[str, Any] = {
                    **contract.as_manifest_dict(),
                    "stage": "pending",
                    "artifact": {
                        "path": _portable_path(artifact_path, repo_root),
                        "size_bytes": artifact_path.stat().st_size,
                        "sha256": artifact_hash,
                        "contract_metadata_sha256": local_metadata_hash,
                    },
                    "resolved_dependencies": {},
                }
                contracts[contract.name] = record
                self._checkpoint(partial_path, manifest)
            elif isinstance(existing, dict):
                record = existing
                self._validate_resume_artifact(
                    contract.name,
                    record,
                    artifact_hash,
                    local_metadata_hash,
                )
            else:
                raise DeploymentError(
                    f"checkpoint record for {contract.name} is invalid"
                )

            context = {
                "admin": admin_address,
                "source_account": admin_address,
            }
            for dependency in contract.dependencies:
                dependency_record = contracts.get(dependency)
                if not isinstance(dependency_record, dict):
                    raise DeploymentError(
                        f"{contract.name}: dependency {dependency} has no record"
                    )
                dependency_id = dependency_record.get("contract_id")
                if not isinstance(dependency_id, str) or not dependency_id:
                    raise DeploymentError(
                        f"{contract.name}: dependency {dependency} is not deployed"
                    )
                context[f"contract.{dependency}"] = dependency_id
                record["resolved_dependencies"][dependency] = dependency_id

            stage = record.get("stage", "pending")
            wasm_hash = record.get("wasm_hash")
            if not isinstance(wasm_hash, str) or not wasm_hash:
                wasm_hash = self.client.upload_wasm(artifact_path, identity, network)
                if wasm_hash != artifact_hash:
                    raise DeploymentError(
                        f"{contract.name}: uploaded WASM hash {wasm_hash} does not "
                        f"match local SHA-256 {artifact_hash}"
                    )
                record["wasm_hash"] = wasm_hash
                record["stage"] = "uploaded"
                record["uploaded_at"] = self._timestamp()
                self._checkpoint(partial_path, manifest)
                stage = "uploaded"

            contract_id = record.get("contract_id")
            if not isinstance(contract_id, str) or not contract_id:
                constructor_args = resolve_mapping(contract.constructor_args, context)
                contract_id = self.client.deploy_contract(
                    wasm_hash,
                    identity,
                    network,
                    constructor_args,
                )
                record["contract_id"] = contract_id
                record["constructor_args"] = constructor_args
                record["stage"] = (
                    "initialized"
                    if contract.deployment_mode == "constructor"
                    else "deployed"
                )
                record["deployed_at"] = self._timestamp()
                self._checkpoint(partial_path, manifest)
                stage = record["stage"]
            elif stage in {"deployed", "initialized"}:
                remote_hash = self.client.contract_hash(contract_id, network)
                if remote_hash != wasm_hash:
                    raise DeploymentError(
                        f"{contract.name}: checkpoint contract {contract_id} resolves "
                        f"to {remote_hash}, expected {wasm_hash}"
                    )

            if contract.deployment_mode == "initialize" and stage != "initialized":
                if not contract.initialize_function:
                    raise DeploymentError(
                        f"{contract.name}: missing initialize function"
                    )
                initialize_args = resolve_mapping(contract.initialize_args, context)
                self.client.invoke(
                    contract_id,
                    identity,
                    network,
                    contract.initialize_function,
                    initialize_args,
                )
                record["initialize_function"] = contract.initialize_function
                record["initialize_args"] = initialize_args
                record["stage"] = "initialized"
                record["initialized_at"] = self._timestamp()
                self._checkpoint(partial_path, manifest)

        all_context = {
            "admin": admin_address,
            "source_account": admin_address,
        }
        for name, record in _require_dict(manifest, "contracts").items():
            if isinstance(record, dict) and isinstance(record.get("contract_id"), str):
                all_context[f"contract.{name}"] = record["contract_id"]
        for contract in ordered:
            record = _require_dict(manifest, "contracts").get(contract.name)
            if not isinstance(record, dict):
                raise DeploymentError(f"missing final record for {contract.name}")
            if contract.health_check:
                health = contract.health_check.as_dict()
                health["args"] = resolve_mapping(contract.health_check.args, all_context)
                record["resolved_health_check"] = health

        manifest["status"] = "verifying"
        manifest["updated_at"] = self._timestamp()
        self._checkpoint(partial_path, manifest)

        candidate = copy_manifest(manifest)
        candidate["status"] = "verified"
        candidate["verified_at"] = self._timestamp()
        candidate["deployed_at"] = candidate["verified_at"]
        candidate["updated_at"] = candidate["verified_at"]
        candidate["verification_report"] = _portable_path(report_path, repo_root)
        candidate["canonical_contracts"] = {
            name: record["contract_id"]
            for name, record in _require_dict(candidate, "contracts").items()
            if isinstance(record, dict) and isinstance(record.get("contract_id"), str)
        }
        for name, legacy_key in LEGACY_MANIFEST_KEYS.items():
            contract_record = _require_dict(candidate, "contracts").get(name)
            if isinstance(contract_record, dict) and isinstance(
                contract_record.get("contract_id"), str
            ):
                candidate[legacy_key] = contract_record["contract_id"]

        report = verify_manifest(
            manifest=candidate,
            repo_root=repo_root,
            client=self.client,
            identity=identity,
            generated_at=self._timestamp(),
        )
        atomic_write_json(report_path, report)
        if report["status"] != "passed":
            raise VerificationFailed(
                f"deployment verification failed; report written to {report_path}",
                report,
            )

        manifest = candidate
        atomic_write_json(manifest_path, manifest)
        write_frontend_env(
            frontend_env_path,
            network,
            {
                record["env_key"]: record["contract_id"]
                for record in _require_dict(manifest, "contracts").values()
                if isinstance(record, dict)
                and isinstance(record.get("env_key"), str)
                and isinstance(record.get("contract_id"), str)
            },
        )
        if partial_path.exists():
            partial_path.unlink()
        return manifest, report

    def _validate_resume_context(
        self,
        *,
        manifest: Mapping[str, Any],
        identity: str,
        admin_address: str,
        network: NetworkConfig,
        config_hash: str,
    ) -> None:
        if manifest.get("schema_version") != MANIFEST_SCHEMA_VERSION:
            raise DeploymentError("checkpoint manifest schema is not supported")
        if manifest.get("identity") != identity:
            raise DeploymentError(
                "checkpoint identity does not match the requested identity"
            )
        if manifest.get("source_account") != admin_address:
            raise DeploymentError(
                "checkpoint source account does not match the current identity"
            )
        manifest_network = manifest.get("network")
        if not isinstance(manifest_network, dict) or manifest_network != network.as_public_dict():
            raise DeploymentError(
                "checkpoint network does not match the requested network"
            )
        manifest_config = manifest.get("config")
        if not isinstance(manifest_config, dict) or manifest_config.get(
            "sha256"
        ) != config_hash:
            raise DeploymentError(
                "checkpoint config hash does not match the selected config"
            )

    def _validate_resume_artifact(
        self,
        name: str,
        record: Mapping[str, Any],
        artifact_hash: str,
        metadata_hash: str,
    ) -> None:
        artifact = record.get("artifact")
        if not isinstance(artifact, dict):
            raise DeploymentError(f"{name}: checkpoint is missing artifact metadata")
        if artifact.get("sha256") != artifact_hash:
            raise DeploymentError(
                f"{name}: local artifact changed since the checkpoint was written"
            )
        if artifact.get("contract_metadata_sha256") != metadata_hash:
            raise DeploymentError(
                f"{name}: contract metadata changed since the checkpoint was written"
            )

    def _checkpoint(self, path: Path, manifest: dict[str, Any]) -> None:
        manifest["updated_at"] = self._timestamp()
        atomic_write_json(path, manifest)

    def _timestamp(self) -> str:
        value = self._now()
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def verify_manifest(
    *,
    manifest: Mapping[str, Any],
    repo_root: Path,
    client: StellarClient,
    identity: str | None = None,
    generated_at: str | None = None,
) -> dict[str, Any]:
    repo_root = repo_root.resolve()
    checks: list[dict[str, Any]] = []
    network_value = manifest.get("network")
    if not isinstance(network_value, dict):
        raise DeploymentError("manifest network must be an object")
    network = NetworkConfig.from_dict(network_value)
    source_identity = identity or manifest.get("identity")
    if not isinstance(source_identity, str) or not source_identity:
        raise DeploymentError(
            "verification requires an identity argument or manifest identity"
        )
    contracts = manifest.get("contracts")
    if not isinstance(contracts, dict) or not contracts:
        raise DeploymentError("manifest contracts must be a non-empty object")

    for name, untyped_record in contracts.items():
        if not isinstance(name, str) or not isinstance(untyped_record, dict):
            _check(
                checks,
                contract=str(name),
                check="manifest_record",
                status="failed",
                expected="object",
                actual=type(untyped_record).__name__,
                detail="contract record is invalid",
            )
            continue
        record = untyped_record
        artifact = record.get("artifact")
        contract_id = record.get("contract_id")
        wasm_hash = record.get("wasm_hash")
        if not isinstance(artifact, dict):
            _check(
                checks,
                contract=name,
                check="artifact_record",
                status="failed",
                expected="object",
                actual=type(artifact).__name__,
            )
            continue
        artifact_value = artifact.get("path")
        if not isinstance(artifact_value, str) or not artifact_value:
            _check(
                checks,
                contract=name,
                check="artifact_path",
                status="failed",
                expected="non-empty path",
                actual=artifact_value,
            )
            continue
        artifact_path = _resolve_path(Path(artifact_value), repo_root)
        if not artifact_path.is_file():
            _check(
                checks,
                contract=name,
                check="artifact_exists",
                status="failed",
                expected=str(artifact_path),
                actual="missing",
            )
            continue
        try:
            validate_artifact(artifact_path)
        except DeploymentError as exc:
            _check(
                checks,
                contract=name,
                check="artifact_format",
                status="failed",
                expected="valid WASM",
                actual=str(exc),
            )
            continue
        local_hash = sha256_file(artifact_path)
        _check_comparison(
            checks,
            name,
            "local_artifact_sha256",
            artifact.get("sha256"),
            local_hash,
        )
        _check_comparison(
            checks,
            name,
            "declared_wasm_hash",
            wasm_hash,
            local_hash,
        )

        try:
            local_metadata = client.contract_metadata(artifact=artifact_path)
            local_metadata_hash = sha256_text(local_metadata)
            _check_comparison(
                checks,
                name,
                "local_contract_metadata",
                artifact.get("contract_metadata_sha256"),
                local_metadata_hash,
            )
        except DeploymentError as exc:
            local_metadata_hash = None
            _check(
                checks,
                contract=name,
                check="local_contract_metadata",
                status="failed",
                expected=artifact.get("contract_metadata_sha256"),
                actual=None,
                detail=str(exc),
            )

        if not isinstance(contract_id, str) or not contract_id:
            _check(
                checks,
                contract=name,
                check="contract_id",
                status="failed",
                expected="deployed contract ID",
                actual=contract_id,
            )
            continue
        try:
            remote_hash = client.contract_hash(contract_id, network)
            _check_comparison(
                checks,
                name,
                "deployed_wasm_hash",
                wasm_hash,
                remote_hash,
            )
        except DeploymentError as exc:
            _check(
                checks,
                contract=name,
                check="deployed_wasm_hash",
                status="failed",
                expected=wasm_hash,
                actual=None,
                detail=str(exc),
            )
        try:
            remote_metadata = client.contract_metadata(
                contract_id=contract_id,
                network=network,
            )
            remote_metadata_hash = sha256_text(remote_metadata)
            _check_comparison(
                checks,
                name,
                "deployed_contract_metadata",
                artifact.get("contract_metadata_sha256"),
                remote_metadata_hash,
            )
            if local_metadata_hash is not None:
                _check_comparison(
                    checks,
                    name,
                    "local_remote_metadata_match",
                    local_metadata_hash,
                    remote_metadata_hash,
                )
        except DeploymentError as exc:
            _check(
                checks,
                contract=name,
                check="deployed_contract_metadata",
                status="failed",
                expected=artifact.get("contract_metadata_sha256"),
                actual=None,
                detail=str(exc),
            )

        dependencies = record.get("resolved_dependencies", {})
        if not isinstance(dependencies, dict):
            _check(
                checks,
                contract=name,
                check="dependency_registry",
                status="failed",
                expected="object",
                actual=type(dependencies).__name__,
            )
        else:
            for dependency, expected_id in dependencies.items():
                dependency_record = contracts.get(dependency)
                actual_id = (
                    dependency_record.get("contract_id")
                    if isinstance(dependency_record, dict)
                    else None
                )
                _check_comparison(
                    checks,
                    name,
                    f"dependency_registry:{dependency}",
                    expected_id,
                    actual_id,
                )

        health_value = record.get("resolved_health_check")
        if isinstance(health_value, dict):
            try:
                health = HealthCheck.from_dict(health_value)
                if health is None:
                    raise DeploymentError("health check is empty")
                output = client.invoke(
                    contract_id,
                    source_identity,
                    network,
                    health.function,
                    health.args,
                )
                passed, expected = evaluate_health_check(health, output)
                _check(
                    checks,
                    contract=name,
                    check=f"health:{health.function}",
                    status="passed" if passed else "failed",
                    expected=expected,
                    actual=output.strip(),
                )
            except DeploymentError as exc:
                _check(
                    checks,
                    contract=name,
                    check="health",
                    status="failed",
                    expected="successful read call",
                    actual=None,
                    detail=str(exc),
                )

    failed = sum(1 for check in checks if check["status"] == "failed")
    passed = sum(1 for check in checks if check["status"] == "passed")
    timestamp = generated_at or datetime.now(timezone.utc).isoformat().replace(
        "+00:00", "Z"
    )
    return {
        "schema_version": MANIFEST_SCHEMA_VERSION,
        "status": "passed" if failed == 0 else "failed",
        "generated_at": timestamp,
        "deployment_id": manifest.get("deployment_id"),
        "manifest_sha256": serialized_manifest_sha256(manifest),
        "network": network.as_public_dict(),
        "checks": checks,
        "summary": {
            "total": len(checks),
            "passed": passed,
            "failed": failed,
        },
    }


def evaluate_health_check(health: HealthCheck, output: str) -> tuple[bool, str]:
    stripped = output.strip()
    if health.expectation == "nonempty":
        return bool(stripped), "non-empty result"
    if health.expectation == "integer":
        normalized = stripped.strip('"')
        return bool(INTEGER_RE.fullmatch(normalized)), "integer result"
    expected = health.contains or ""
    return expected in stripped, f"result containing {expected!r}"


def resolve_mapping(
    values: Mapping[str, Any], context: Mapping[str, str]
) -> dict[str, Any]:
    return {key: resolve_value(value, context) for key, value in values.items()}


def resolve_value(value: Any, context: Mapping[str, str]) -> Any:
    if isinstance(value, dict):
        return {key: resolve_value(item, context) for key, item in value.items()}
    if isinstance(value, list):
        return [resolve_value(item, context) for item in value]
    if not isinstance(value, str):
        return value
    exact = TEMPLATE_RE.fullmatch(value)
    if exact:
        key = exact.group(1)
        if key not in context:
            raise DeploymentError(f"unresolved deployment template: {value}")
        return context[key]

    def substitute(match: re.Match[str]) -> str:
        key = match.group(1)
        if key not in context:
            raise DeploymentError(
                f"unresolved deployment template: {match.group(0)}"
            )
        return context[key]

    return TEMPLATE_RE.sub(substitute, value)


def partial_manifest_path(manifest_path: Path) -> Path:
    return manifest_path.with_name(
        f"{manifest_path.stem}.partial{manifest_path.suffix}"
    )


def serialized_manifest_sha256(manifest: Mapping[str, Any]) -> str:
    return sha256_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")


def copy_manifest(manifest: Mapping[str, Any]) -> dict[str, Any]:
    return json.loads(json.dumps(manifest))


def write_frontend_env(
    path: Path,
    network: NetworkConfig,
    contract_values: Mapping[str, str],
) -> None:
    managed: dict[str, str] = {
        "VITE_STELLAR_NETWORK": network.name,
        **dict(contract_values),
    }
    if network.rpc_url:
        managed["VITE_STELLAR_RPC_URL"] = network.rpc_url
    elif network.name == "testnet":
        managed["VITE_STELLAR_RPC_URL"] = "https://soroban-testnet.stellar.org"
    elif network.name in {"local", "standalone"}:
        managed["VITE_STELLAR_RPC_URL"] = "http://localhost:8000/soroban/rpc"

    existing_lines = (
        path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    )
    output: list[str] = []
    seen: set[str] = set()
    for line in existing_lines:
        if "=" in line and not line.lstrip().startswith("#"):
            key = line.split("=", 1)[0].strip()
            if key in managed:
                output.append(f"{key}={managed[key]}")
                seen.add(key)
                continue
        output.append(line)
    for key, value in managed.items():
        if key not in seen:
            output.append(f"{key}={value}")
    atomic_write_text(path, "\n".join(output).rstrip() + "\n")


def _artifact_path(template: str, repo_root: Path, wasm_dir: Path) -> Path:
    rendered = template.replace("${wasm_dir}", str(wasm_dir))
    if TEMPLATE_RE.search(rendered):
        raise DeploymentError(f"unresolved artifact path template: {template}")
    return _resolve_path(Path(rendered), repo_root)


def _resolve_path(path: Path, repo_root: Path) -> Path:
    return path.resolve() if path.is_absolute() else (repo_root / path).resolve()


def _portable_path(path: Path, repo_root: Path) -> str:
    try:
        return path.resolve().relative_to(repo_root.resolve()).as_posix()
    except ValueError:
        return path.resolve().as_posix()


def _require_dict(value: Mapping[str, Any], key: str) -> dict[str, Any]:
    candidate = value.get(key)
    if not isinstance(candidate, dict):
        raise DeploymentError(f"{key} must be an object")
    return candidate


def _check_comparison(
    checks: list[dict[str, Any]],
    contract: str,
    check: str,
    expected: Any,
    actual: Any,
) -> None:
    _check(
        checks,
        contract=contract,
        check=check,
        status="passed" if expected == actual else "failed",
        expected=expected,
        actual=actual,
    )


def _check(
    checks: list[dict[str, Any]],
    *,
    contract: str,
    check: str,
    status: str,
    expected: Any,
    actual: Any,
    detail: str | None = None,
) -> None:
    record: dict[str, Any] = {
        "contract": contract,
        "check": check,
        "status": status,
        "expected": expected,
        "actual": actual,
    }
    if detail:
        record["detail"] = detail
    checks.append(record)
