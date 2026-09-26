"""Cross-language durable pending exposure registry.

The registry is deliberately fail-closed. Active rows survive a runner crash
and continue to reserve Gross until a reconciliation path explicitly releases
the row. It is a coordination record only and never submits or cancels orders.
"""
from __future__ import annotations

import json
import os
import tempfile
import time
from pathlib import Path
from typing import Any

SCHEMA = "disdex-pending-exposure/v1"
ACTIVE_STATUSES = {"PENDING", "SUBMITTED", "UNKNOWN"}


def default_path() -> Path:
    return Path(os.getenv("DISDEX_PENDING_EXPOSURE_REGISTRY_PATH", "/var/lib/disdex/shared/pending-exposure.json")).resolve()


def _now_ms() -> int:
    return int(time.time() * 1000)


def _expected_sleeve(strategy_id: str) -> str:
    owner = str(strategy_id or "").strip().upper()
    if owner in {"V11_EQ", "V50_POST_OPEN_BASIS", "V52"} or "V52" in owner:
        return "STOCK"
    if owner == "V12" or "V12_" in owner or "PENGU" in owner or "FET_BRK48" in owner or "QUALITY102" in owner:
        return "CRYPTO"
    raise RuntimeError(f"PENDING_EXPOSURE_OWNER_UNKNOWN:{strategy_id or 'EMPTY'}")


def _validate_entry(row: Any) -> dict[str, Any]:
    if not isinstance(row, dict):
        raise RuntimeError("PENDING_EXPOSURE_ENTRY_INVALID")
    strategy_id = str(row.get("strategyId", "")).strip()
    sleeve = str(row.get("sleeve", "")).strip().upper()
    if not strategy_id or sleeve not in {"CRYPTO", "STOCK"}:
        raise RuntimeError("PENDING_EXPOSURE_ENTRY_IDENTITY_INVALID")
    if _expected_sleeve(strategy_id) != sleeve:
        raise RuntimeError(f"PENDING_EXPOSURE_OWNER_SLEEVE_MISMATCH:{strategy_id}")
    status = str(row.get("status", "")).strip().upper()
    if status not in ACTIVE_STATUSES | {"RELEASED"}:
        raise RuntimeError("PENDING_EXPOSURE_STATUS_INVALID")
    for key in ("gross", "notionalUsd"):
        value = float(row.get(key, 0))
        if value < 0:
            raise RuntimeError(f"PENDING_EXPOSURE_{key.upper()}_INVALID")
    for key in ("createdAt", "updatedAt"):
        value = int(row.get(key, 0))
        if value <= 0:
            raise RuntimeError(f"PENDING_EXPOSURE_{key.upper()}_INVALID")
    return dict(row, strategyId=strategy_id, sleeve=sleeve, status=status)


def empty_registry(now_ms: int | None = None, account_scope: str = "ASTER_FUTURES") -> dict[str, Any]:
    return {"schema": SCHEMA, "accountScope": account_scope, "updatedAt": now_ms or _now_ms(), "entries": []}


def read_registry(path: str | Path | None = None) -> dict[str, Any]:
    target = Path(path or default_path()).resolve()
    if not target.exists():
        return empty_registry()
    if target.is_symlink() or not target.is_file():
        raise RuntimeError("PENDING_EXPOSURE_PATH_NOT_REGULAR_FILE")
    try:
        value = json.loads(target.read_text(encoding="utf-8"))
    except Exception as error:
        raise RuntimeError("PENDING_EXPOSURE_REGISTRY_MALFORMED") from error
    if not isinstance(value, dict) or value.get("schema") != SCHEMA or not isinstance(value.get("entries"), list):
        raise RuntimeError("PENDING_EXPOSURE_REGISTRY_MALFORMED")
    entries = [_validate_entry(row) for row in value["entries"]]
    if len({row["reservationId"] for row in entries}) != len(entries):
        raise RuntimeError("PENDING_EXPOSURE_DUPLICATE")
    return dict(value, entries=entries)


def _atomic_write(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix=f"{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, indent=2, sort_keys=True)
            handle.write("\n")
        os.replace(temp, path)
    finally:
        try:
            os.unlink(temp)
        except FileNotFoundError:
            pass


def upsert_pending(entry: dict[str, Any], path: str | Path | None = None) -> dict[str, Any]:
    target = Path(path or default_path()).resolve()
    current = read_registry(target)
    normalized = _validate_entry(dict(entry, status=entry.get("status", "PENDING"), updatedAt=entry.get("updatedAt", _now_ms())))
    next_entries = [row for row in current["entries"] if row.get("reservationId") != normalized["reservationId"]]
    next_entries.append(normalized)
    _atomic_write(target, dict(current, updatedAt=_now_ms(), entries=next_entries))
    return normalized


def release_pending(reservation_id: str, path: str | Path | None = None) -> bool:
    target = Path(path or default_path()).resolve()
    current = read_registry(target)
    found = False
    next_entries = []
    for row in current["entries"]:
        if row.get("reservationId") == reservation_id:
            found = True
            next_entries.append(dict(row, status="RELEASED", updatedAt=_now_ms()))
        else:
            next_entries.append(row)
    if found:
        _atomic_write(target, dict(current, updatedAt=_now_ms(), entries=next_entries))
    return found


def aggregate_pending(path: str | Path | None = None) -> dict[str, Any]:
    result: dict[str, Any] = {"cryptoGross": 0.0, "stockGross": 0.0, "byStrategyGross": {}}
    for row in read_registry(path)["entries"]:
        if row["status"] not in ACTIVE_STATUSES:
            continue
        gross = float(row["gross"])
        result["cryptoGross" if row["sleeve"] == "CRYPTO" else "stockGross"] += gross
        result["byStrategyGross"][row["strategyId"]] = result["byStrategyGross"].get(row["strategyId"], 0.0) + gross
    return result
