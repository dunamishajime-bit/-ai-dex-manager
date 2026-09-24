"""Validation for the source bundle required by the formal integrated BT.

The checked-in result summaries are useful references, but they are not a
replay input.  This module deliberately accepts only a declared bundle of
event ledgers, source allocator, and input manifests with verified hashes.
It never turns a summary JSON or a generated result into formal evidence.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Mapping


FORMAL_BUNDLE_KIND = "CANONICAL_EVENT_LEDGER_BUNDLE_V1"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _blocked(reason: str, **extra: Any) -> dict[str, Any]:
    return {
        "status": "BLOCKED_MISSING_CANONICAL_SOURCE",
        "reason": reason,
        **extra,
    }


def inspect_source_bundle(manifest_path: Path, source_root: Path | None = None) -> dict[str, Any]:
    """Inspect a declared source bundle without executing a backtest.

    Every required file must be a regular file, non-empty, and match the
    declared SHA256.  The manifest must explicitly declare event ledgers; a
    result/summary-only directory is rejected even when it contains matching
    headline numbers.
    """
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return _blocked("SOURCE_BUNDLE_MANIFEST_UNREADABLE", error=str(exc))
    if not isinstance(manifest, Mapping):
        return _blocked("SOURCE_BUNDLE_MANIFEST_NOT_OBJECT")
    if manifest.get("bundle_kind") != FORMAL_BUNDLE_KIND:
        return _blocked("SOURCE_BUNDLE_KIND_NOT_FORMAL", bundle_kind=manifest.get("bundle_kind"))
    required = manifest.get("required_files")
    if not isinstance(required, list) or not required:
        return _blocked("SOURCE_BUNDLE_REQUIRED_FILES_MISSING")
    root = source_root or manifest_path.parent
    files: list[dict[str, Any]] = []
    missing: list[str] = []
    mismatched: list[str] = []
    for item in required:
        if not isinstance(item, Mapping):
            return _blocked("SOURCE_BUNDLE_FILE_ENTRY_INVALID")
        logical_id = item.get("id")
        relative = item.get("path")
        expected = item.get("sha256")
        if not isinstance(logical_id, str) or not logical_id:
            return _blocked("SOURCE_BUNDLE_FILE_ID_INVALID")
        if not isinstance(relative, str) or not relative:
            return _blocked("SOURCE_BUNDLE_FILE_PATH_INVALID", file_id=logical_id)
        if not isinstance(expected, str) or len(expected) != 64:
            return _blocked("SOURCE_BUNDLE_FILE_HASH_INVALID", file_id=logical_id)
        candidate = Path(relative)
        path = candidate if candidate.is_absolute() else root / candidate
        record: dict[str, Any] = {
            "id": logical_id,
            "path": str(path),
            "expected_sha256": expected.lower(),
        }
        if not path.is_file():
            record["status"] = "MISSING"
            missing.append(logical_id)
        else:
            actual = _sha256(path)
            record["actual_sha256"] = actual
            record["size_bytes"] = path.stat().st_size
            if record["size_bytes"] <= 0:
                record["status"] = "EMPTY"
                missing.append(logical_id)
            elif actual != expected.lower():
                record["status"] = "HASH_MISMATCH"
                mismatched.append(logical_id)
            else:
                record["status"] = "OK"
        files.append(record)

    ledger_ids = manifest.get("event_ledger_ids")
    if not isinstance(ledger_ids, list) or not ledger_ids:
        return _blocked("SOURCE_BUNDLE_EVENT_LEDGER_DECLARATION_MISSING", files=files)
    present_ids = {item.get("id") for item in required if isinstance(item, Mapping)}
    missing_ledgers = sorted(str(item) for item in ledger_ids if item not in present_ids)
    if missing_ledgers:
        return _blocked(
            "SOURCE_BUNDLE_EVENT_LEDGER_FILES_MISSING",
            missing_event_ledgers=missing_ledgers,
            files=files,
        )
    if missing or mismatched:
        return _blocked(
            "SOURCE_BUNDLE_FILE_VERIFICATION_FAILED",
            missing_files=missing,
            hash_mismatches=mismatched,
            files=files,
        )
    return {
        "status": "SOURCE_BUNDLE_VERIFIED",
        "bundle_kind": FORMAL_BUNDLE_KIND,
        "event_ledger_ids": ledger_ids,
        "files": files,
    }
