from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Mapping


MANIFEST_SCHEMA_VERSION = 1
CONFIG_SCHEMA_VERSION = 1
HEX_HASH_RE = re.compile(r"^[0-9a-f]{64}$")
CONTRACT_ID_RE = re.compile(r"^C[A-Z2-7]{55}$")


class DeploymentError(RuntimeError):
    """A deployment error with an operator-actionable message."""


class VerificationFailed(DeploymentError):
    """Raised when deployment verification produced one or more failures."""

    def __init__(self, message: str, report: Mapping[str, Any]):
        super().__init__(message)
        self.report = report


@dataclass(frozen=True)
class NetworkConfig:
    name: str
    rpc_url: str | None = None
    passphrase: str | None = None

    def __post_init__(self) -> None:
        if not self.name:
            raise DeploymentError("network name cannot be empty")
        if bool(self.rpc_url) != bool(self.passphrase):
            raise DeploymentError(
                "rpc_url and network passphrase must be supplied together"
            )

    def cli_args(self) -> list[str]:
        if self.rpc_url and self.passphrase:
            return [
                "--rpc-url",
                self.rpc_url,
                "--network-passphrase",
                self.passphrase,
            ]
        return ["--network", self.name]

    def as_public_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {"name": self.name}
        if self.rpc_url:
            result["rpc_url"] = self.rpc_url
        if self.passphrase:
            result["passphrase"] = self.passphrase
        return result

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "NetworkConfig":
        return cls(
            name=require_string(value, "name"),
            rpc_url=optional_string(value, "rpc_url"),
            passphrase=optional_string(value, "passphrase"),
        )


@dataclass(frozen=True)
class HealthCheck:
    function: str
    args: Mapping[str, Any] = field(default_factory=dict)
    expectation: str = "nonempty"
    contains: str | None = None

    @classmethod
    def from_dict(cls, value: Mapping[str, Any] | None) -> "HealthCheck | None":
        if value is None:
            return None
        function = require_string(value, "function")
        args = value.get("args", {})
        if not isinstance(args, dict):
            raise DeploymentError(f"health check {function!r} args must be an object")
        expectation = value.get("expectation", "nonempty")
        if expectation not in {"nonempty", "integer", "contains"}:
            raise DeploymentError(
                f"health check {function!r} has unsupported expectation {expectation!r}"
            )
        contains = optional_string(value, "contains")
        if expectation == "contains" and not contains:
            raise DeploymentError(
                f"health check {function!r} requires a non-empty contains value"
            )
        return cls(
            function=function,
            args=args,
            expectation=expectation,
            contains=contains,
        )

    def as_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "function": self.function,
            "args": dict(self.args),
            "expectation": self.expectation,
        }
        if self.contains is not None:
            result["contains"] = self.contains
        return result


@dataclass(frozen=True)
class ContractSpec:
    name: str
    artifact: str
    env_key: str
    dependencies: tuple[str, ...]
    deployment_mode: str
    constructor_args: Mapping[str, Any] = field(default_factory=dict)
    initialize_function: str | None = None
    initialize_args: Mapping[str, Any] = field(default_factory=dict)
    declared_metadata: Mapping[str, Any] = field(default_factory=dict)
    health_check: HealthCheck | None = None

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "ContractSpec":
        name = require_string(value, "name")
        artifact = require_string(value, "artifact")
        env_key = require_string(value, "env_key")
        dependencies_value = value.get("dependencies", [])
        if not isinstance(dependencies_value, list) or not all(
            isinstance(item, str) and item for item in dependencies_value
        ):
            raise DeploymentError(f"{name}: dependencies must be an array of names")
        mode = value.get("deployment_mode", "constructor")
        if mode not in {"constructor", "initialize"}:
            raise DeploymentError(
                f"{name}: deployment_mode must be 'constructor' or 'initialize'"
            )
        constructor_args = value.get("constructor_args", {})
        initialize_args = value.get("initialize_args", {})
        declared_metadata = value.get("declared_metadata", {})
        for label, candidate in (
            ("constructor_args", constructor_args),
            ("initialize_args", initialize_args),
            ("declared_metadata", declared_metadata),
        ):
            if not isinstance(candidate, dict):
                raise DeploymentError(f"{name}: {label} must be an object")
        initialize_function = optional_string(value, "initialize_function")
        if mode == "initialize" and not initialize_function:
            raise DeploymentError(
                f"{name}: initialize mode requires initialize_function"
            )
        return cls(
            name=name,
            artifact=artifact,
            env_key=env_key,
            dependencies=tuple(dependencies_value),
            deployment_mode=mode,
            constructor_args=constructor_args,
            initialize_function=initialize_function,
            initialize_args=initialize_args,
            declared_metadata=declared_metadata,
            health_check=HealthCheck.from_dict(value.get("health_check")),
        )

    def as_manifest_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "name": self.name,
            "env_key": self.env_key,
            "dependencies": list(self.dependencies),
            "deployment_mode": self.deployment_mode,
            "declared_metadata": dict(self.declared_metadata),
        }
        if self.health_check:
            result["health_check"] = self.health_check.as_dict()
        return result


@dataclass(frozen=True)
class DeploymentConfig:
    profile: str
    contracts: tuple[ContractSpec, ...]
    source_path: Path

    @classmethod
    def load(cls, path: Path) -> "DeploymentConfig":
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError as exc:
            raise DeploymentError(f"deployment config not found: {path}") from exc
        except json.JSONDecodeError as exc:
            raise DeploymentError(
                f"invalid JSON in deployment config {path}: {exc}"
            ) from exc
        if not isinstance(raw, dict):
            raise DeploymentError("deployment config must be a JSON object")
        if raw.get("schema_version") != CONFIG_SCHEMA_VERSION:
            raise DeploymentError(
                f"deployment config schema_version must be {CONFIG_SCHEMA_VERSION}"
            )
        profile = raw.get("profile", "development")
        if profile not in {"development", "production"}:
            raise DeploymentError("deployment config profile is not recognized")
        contracts_value = raw.get("contracts")
        if not isinstance(contracts_value, list) or not contracts_value:
            raise DeploymentError("deployment config contracts must be a non-empty array")
        if not all(isinstance(item, dict) for item in contracts_value):
            raise DeploymentError("every deployment config contract must be an object")
        contracts = tuple(
            ContractSpec.from_dict(item)
            for item in contracts_value
            if item.get("enabled", True)
        )
        if not contracts:
            raise DeploymentError("deployment config enables no contracts")
        config = cls(profile=profile, contracts=contracts, source_path=path.resolve())
        config.validate()
        return config

    def validate(self) -> None:
        names = [contract.name for contract in self.contracts]
        env_keys = [contract.env_key for contract in self.contracts]
        if len(set(names)) != len(names):
            raise DeploymentError("contract names must be unique")
        if len(set(env_keys)) != len(env_keys):
            raise DeploymentError("contract env_key values must be unique")
        known = set(names)
        for contract in self.contracts:
            missing = set(contract.dependencies) - known
            if missing:
                raise DeploymentError(
                    f"{contract.name}: unknown dependencies: {', '.join(sorted(missing))}"
                )
            if contract.name in contract.dependencies:
                raise DeploymentError(
                    f"{contract.name}: a contract cannot depend on itself"
                )
        topological_order(self.contracts)

    def ordered_contracts(self) -> tuple[ContractSpec, ...]:
        return topological_order(self.contracts)

    def validate_for_network(self, network: NetworkConfig) -> None:
        if network.name.lower() in {"mainnet", "public"}:
            if self.profile != "production":
                raise DeploymentError(
                    "mainnet deployment requires a config with profile='production'"
                )
            placeholders = find_placeholder_values(
                {
                    contract.name: {
                        "constructor_args": contract.constructor_args,
                        "initialize_args": contract.initialize_args,
                        "declared_metadata": contract.declared_metadata,
                    }
                    for contract in self.contracts
                }
            )
            if placeholders:
                raise DeploymentError(
                    "mainnet config contains placeholder values: "
                    + ", ".join(placeholders)
                )


def topological_order(
    contracts: Iterable[ContractSpec],
) -> tuple[ContractSpec, ...]:
    by_name = {contract.name: contract for contract in contracts}
    permanent: set[str] = set()
    temporary: set[str] = set()
    ordered: list[ContractSpec] = []

    def visit(name: str, chain: tuple[str, ...]) -> None:
        if name in permanent:
            return
        if name in temporary:
            cycle = " -> ".join((*chain, name))
            raise DeploymentError(f"contract dependency cycle detected: {cycle}")
        temporary.add(name)
        contract = by_name[name]
        for dependency in contract.dependencies:
            visit(dependency, (*chain, name))
        temporary.remove(name)
        permanent.add(name)
        ordered.append(contract)

    for contract_name in by_name:
        visit(contract_name, ())
    return tuple(ordered)


def require_string(value: Mapping[str, Any], key: str) -> str:
    candidate = value.get(key)
    if not isinstance(candidate, str) or not candidate:
        raise DeploymentError(f"{key} must be a non-empty string")
    return candidate


def optional_string(value: Mapping[str, Any], key: str) -> str | None:
    candidate = value.get(key)
    if candidate is None:
        return None
    if not isinstance(candidate, str) or not candidate:
        raise DeploymentError(f"{key} must be a non-empty string when supplied")
    return candidate


def find_placeholder_values(value: Any, path: str = "$") -> list[str]:
    found: list[str] = []
    if isinstance(value, dict):
        for key, item in value.items():
            found.extend(find_placeholder_values(item, f"{path}.{key}"))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            found.extend(find_placeholder_values(item, f"{path}[{index}]"))
    elif isinstance(value, str):
        normalized = value.strip().lower()
        if (
            "placeholder" in normalized
            or normalized in {"todo", "tbd", "replace-me", "changeme"}
            or normalized.startswith("<")
            and normalized.endswith(">")
        ):
            found.append(path)
    return found


def canonical_json(value: Any) -> str:
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_text(value: str) -> str:
    return sha256_bytes(value.encode("utf-8"))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def file_sha256_or_none(path: Path) -> str | None:
    if not path.exists():
        return None
    return sha256_file(path)


def validate_artifact(path: Path) -> None:
    if not path.is_file():
        raise DeploymentError(f"WASM artifact not found: {path}")
    size = path.stat().st_size
    if size < 8:
        raise DeploymentError(f"WASM artifact is unexpectedly small: {path} ({size} bytes)")
    with path.open("rb") as handle:
        magic = handle.read(4)
    if magic != b"\x00asm":
        raise DeploymentError(f"WASM artifact has invalid magic bytes: {path}")


def atomic_write_json(path: Path, value: Any) -> None:
    atomic_write_text(path, json.dumps(value, indent=2, sort_keys=True) + "\n")


def atomic_write_text(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temp_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    temp_path = Path(temp_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(value)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, path)
    finally:
        if temp_path.exists():
            temp_path.unlink()


def load_json_object(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise DeploymentError(f"JSON file not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise DeploymentError(f"invalid JSON in {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise DeploymentError(f"expected a JSON object in {path}")
    return value
