"""Minimal, dependency-free WASM export-section reader.

Used by upgrade simulation (#445) to diff a contract's public interface
across two WASM builds without shelling out to `wasm-tools`/`wasmparser` or
a Soroban CLI/network call — pure local static analysis.
"""

from __future__ import annotations

from pathlib import Path

from .models import DeploymentError

WASM_MAGIC = b"\x00asm"
EXPORT_SECTION_ID = 7
EXPORT_KIND_FUNCTION = 0


def _read_uleb128(data: bytes, offset: int) -> tuple[int, int]:
    result = 0
    shift = 0
    while True:
        if offset >= len(data):
            raise DeploymentError("malformed WASM: truncated LEB128 integer")
        byte = data[offset]
        offset += 1
        result |= (byte & 0x7F) << shift
        if byte & 0x80 == 0:
            break
        shift += 7
    return result, offset


def extract_function_exports(path: Path) -> list[str]:
    """Return the sorted list of function names exported by a WASM module.

    Walks the module's top-level sections looking for the export section
    (id 7) and returns the names of entries whose export kind is `func`
    (kind 0) — i.e. the contract's callable public interface. Other export
    kinds (memory, table, global) are ignored.
    """
    if not path.is_file():
        raise DeploymentError(f"WASM artifact not found: {path}")
    data = path.read_bytes()
    if len(data) < 8 or data[:4] != WASM_MAGIC:
        raise DeploymentError(f"not a valid WASM module: {path}")

    offset = 8  # past the 4-byte magic number and 4-byte version
    names: list[str] = []
    while offset < len(data):
        section_id = data[offset]
        offset += 1
        section_size, offset = _read_uleb128(data, offset)
        section_end = offset + section_size
        if section_end > len(data):
            raise DeploymentError(f"malformed WASM: section overruns module: {path}")
        if section_id == EXPORT_SECTION_ID:
            names = _parse_export_section(data, offset, section_end)
        offset = section_end
    return sorted(names)


def _parse_export_section(data: bytes, offset: int, end: int) -> list[str]:
    count, offset = _read_uleb128(data, offset)
    names: list[str] = []
    for _ in range(count):
        name_len, offset = _read_uleb128(data, offset)
        name = data[offset : offset + name_len].decode("utf-8")
        offset += name_len
        kind = data[offset]
        offset += 1
        _index, offset = _read_uleb128(data, offset)
        if kind == EXPORT_KIND_FUNCTION:
            names.append(name)
    if offset != end:
        raise DeploymentError("malformed WASM: export section size mismatch")
    return names
