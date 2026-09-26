"""Validation for secret-free production-source manifests."""

from __future__ import annotations

import json
import hashlib
import re
from datetime import datetime
from pathlib import Path
from typing import Any


_SHA1 = re.compile(r"^[0-9a-f]{40}$", re.IGNORECASE)
_SHA256 = re.compile(r"^[0-9a-f]{64}$", re.IGNORECASE)
_SECRET_KEY = re.compile(r"secret|api[_-]?key|private|password|token|account|wallet|seed|mnemonic", re.IGNORECASE)
_REQUIRED_KEYS = {
    "runtime_sha",
    "units",
    "files",
    "config_allowlist",
    "extraction_utc",
    "secrets_excluded",
}


def _reject_secret_fields(value: Any, path: str = "manifest") -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if _SECRET_KEY.search(str(key)) and key != "secrets_excluded":
                raise ValueError(f"secret-like field is prohibited: {path}.{key}")
            _reject_secret_fields(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _reject_secret_fields(child, f"{path}[{index}]")


def load_manifest(path: str | Path) -> dict[str, Any]:
    """Load and validate the immutable, secret-free source provenance manifest."""
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("manifest must be a JSON object")
    missing = sorted(_REQUIRED_KEYS - payload.keys())
    if missing:
        raise ValueError(f"manifest missing required keys: {', '.join(missing)}")
    _reject_secret_fields(payload)
    if not isinstance(payload["runtime_sha"], str) or not _SHA1.fullmatch(payload["runtime_sha"]):
        raise ValueError("runtime_sha must be a 40-character hexadecimal identifier")
    if payload["secrets_excluded"] is not True:
        raise ValueError("manifest must explicitly confirm secrets are excluded")
    if not isinstance(payload["units"], list) or not all(isinstance(item, str) for item in payload["units"]):
        raise ValueError("units must be a list of strings")
    if not isinstance(payload["files"], list):
        raise ValueError("files must be a list")
    for index, item in enumerate(payload["files"]):
        if not isinstance(item, dict) or not isinstance(item.get("path"), str):
            raise ValueError(f"files[{index}] must include a path")
        if not isinstance(item.get("sha256"), str) or not _SHA256.fullmatch(item["sha256"]):
            raise ValueError(f"files[{index}].sha256 must be a 64-character SHA256")
    if not isinstance(payload["config_allowlist"], dict):
        raise ValueError("config_allowlist must be an object")
    if not isinstance(payload["extraction_utc"], str):
        raise ValueError("extraction_utc must be an ISO-8601 timestamp")
    try:
        timestamp = datetime.fromisoformat(payload["extraction_utc"].replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("extraction_utc must be an ISO-8601 timestamp") from exc
    if timestamp.tzinfo is None:
        raise ValueError("extraction_utc must include a timezone")
    return payload


def hash_source_files(snapshot_root: str | Path, relative_paths: list[str]) -> list[dict[str, str]]:
    """Hash explicitly allowlisted source files without following paths outside the snapshot."""
    root = Path(snapshot_root).resolve()
    records: list[dict[str, str]] = []
    for relative in sorted(set(relative_paths)):
        candidate = (root / relative).resolve()
        try:
            candidate.relative_to(root)
        except ValueError as exc:
            raise ValueError(f"source path escapes snapshot root: {relative}") from exc
        if not candidate.is_file():
            raise ValueError(f"source file does not exist: {relative}")
        digest = hashlib.sha256(candidate.read_bytes()).hexdigest()
        records.append({"path": relative.replace("\\", "/"), "sha256": digest})
    return records
