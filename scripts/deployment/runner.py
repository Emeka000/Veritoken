from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any, Mapping, Protocol, Sequence

from .models import (
    CONTRACT_ID_RE,
    HEX_HASH_RE,
    DeploymentError,
    NetworkConfig,
    canonical_json,
)


HEX_HASH_SEARCH = re.compile(r"(?<![0-9a-fA-F])([0-9a-fA-F]{64})(?![0-9a-fA-F])")
CONTRACT_ID_SEARCH = re.compile(r"(?<![A-Z2-7])(C[A-Z2-7]{55})(?![A-Z2-7])")
ACCOUNT_ID_SEARCH = re.compile(r"(?<![A-Z2-7])(G[A-Z2-7]{55})(?![A-Z2-7])")


class StellarClient(Protocol):
    def account_address(self, identity: str) -> str: ...

    def upload_wasm(
        self, artifact: Path, identity: str, network: NetworkConfig
    ) -> str: ...

    def deploy_contract(
        self,
        wasm_hash: str,
        identity: str,
        network: NetworkConfig,
        constructor_args: Mapping[str, Any],
    ) -> str: ...

    def invoke(
        self,
        contract_id: str,
        identity: str,
        network: NetworkConfig,
        function: str,
        args: Mapping[str, Any],
    ) -> str: ...

    def contract_hash(self, contract_id: str, network: NetworkConfig) -> str: ...

    def contract_metadata(
        self,
        *,
        artifact: Path | None = None,
        contract_id: str | None = None,
        network: NetworkConfig | None = None,
    ) -> str: ...


class StellarCliClient:
    """Small, testable adapter around the current Stellar CLI."""

    def __init__(self, binary: str = "stellar") -> None:
        self.binary = binary
        if not _command_available(binary):
            raise DeploymentError(
                f"Stellar CLI executable not found: {binary!r}. "
                "Install it or set STELLAR_BIN."
            )

    def account_address(self, identity: str) -> str:
        output = self._run(["keys", "address", identity])
        match = ACCOUNT_ID_SEARCH.search(output)
        if not match:
            raise DeploymentError(
                f"stellar keys address returned no account address for {identity!r}"
            )
        return match.group(1)

    def upload_wasm(
        self, artifact: Path, identity: str, network: NetworkConfig
    ) -> str:
        output = self._run(
            [
                "contract",
                "upload",
                "--wasm",
                str(artifact),
                "--source-account",
                identity,
                *network.cli_args(),
            ]
        )
        return _extract_hash(output, "contract upload")

    def deploy_contract(
        self,
        wasm_hash: str,
        identity: str,
        network: NetworkConfig,
        constructor_args: Mapping[str, Any],
    ) -> str:
        command = [
            "contract",
            "deploy",
            "--wasm-hash",
            wasm_hash,
            "--source-account",
            identity,
            *network.cli_args(),
        ]
        encoded = encode_contract_args(constructor_args)
        if encoded:
            command.extend(["--", *encoded])
        output = self._run(command)
        match = CONTRACT_ID_SEARCH.search(output)
        if not match:
            raise DeploymentError(
                "stellar contract deploy returned no valid contract ID"
            )
        return match.group(1)

    def invoke(
        self,
        contract_id: str,
        identity: str,
        network: NetworkConfig,
        function: str,
        args: Mapping[str, Any],
    ) -> str:
        if not CONTRACT_ID_RE.fullmatch(contract_id):
            raise DeploymentError(f"invalid contract ID: {contract_id!r}")
        return self._run(
            [
                "contract",
                "invoke",
                "--id",
                contract_id,
                "--source-account",
                identity,
                *network.cli_args(),
                "--",
                function,
                *encode_contract_args(args),
            ]
        )

    def contract_hash(self, contract_id: str, network: NetworkConfig) -> str:
        output = self._run(
            [
                "contract",
                "info",
                "hash",
                "--contract-id",
                contract_id,
                *network.cli_args(),
            ]
        )
        return _extract_hash(output, "contract info hash")

    def contract_metadata(
        self,
        *,
        artifact: Path | None = None,
        contract_id: str | None = None,
        network: NetworkConfig | None = None,
    ) -> str:
        if bool(artifact) == bool(contract_id):
            raise DeploymentError(
                "contract_metadata requires exactly one of artifact or contract_id"
            )
        command = ["contract", "info", "meta"]
        if artifact:
            command.extend(["--wasm", str(artifact)])
        else:
            if network is None:
                raise DeploymentError(
                    "network is required when reading deployed contract metadata"
                )
            command.extend(["--contract-id", str(contract_id), *network.cli_args()])
        command.extend(["--output", "json"])
        return normalize_metadata(self._run(command))

    def _run(self, args: Sequence[str]) -> str:
        command = [self.binary, *args]
        try:
            completed = subprocess.run(
                command,
                check=False,
                capture_output=True,
                text=True,
                encoding="utf-8",
            )
        except OSError as exc:
            raise DeploymentError(
                f"could not execute {_display_command(command)}: {exc}"
            ) from exc
        if completed.returncode != 0:
            detail = completed.stderr.strip() or completed.stdout.strip()
            raise DeploymentError(
                f"command failed ({completed.returncode}): "
                f"{_display_command(command)}\n{detail}"
            )
        return completed.stdout.strip()


def encode_contract_args(values: Mapping[str, Any]) -> list[str]:
    encoded: list[str] = []
    for key, value in values.items():
        if not isinstance(key, str) or not key:
            raise DeploymentError("contract argument names must be non-empty strings")
        encoded.extend([f"--{key.replace('_', '-')}", encode_contract_value(value)])
    return encoded


def encode_contract_value(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (dict, list)):
        return canonical_json(value)
    return str(value)


def normalize_metadata(output: str) -> str:
    stripped = output.strip()
    if not stripped:
        return canonical_json([])
    try:
        return canonical_json(json.loads(stripped))
    except json.JSONDecodeError:
        return "\n".join(line.rstrip() for line in stripped.splitlines()).strip()


def _extract_hash(output: str, operation: str) -> str:
    match = HEX_HASH_SEARCH.search(output)
    if not match:
        raise DeploymentError(f"stellar {operation} returned no 64-character hash")
    result = match.group(1).lower()
    if not HEX_HASH_RE.fullmatch(result):
        raise DeploymentError(f"stellar {operation} returned an invalid hash")
    return result


def _command_available(binary: str) -> bool:
    path = Path(binary)
    if path.parent != Path(".") or path.is_absolute():
        return path.is_file()
    return shutil.which(binary) is not None


def _display_command(command: Sequence[str]) -> str:
    return " ".join(_quote_for_display(part) for part in command)


def _quote_for_display(value: str) -> str:
    if not value or any(character.isspace() for character in value):
        return repr(value)
    return value
