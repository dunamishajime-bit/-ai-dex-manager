"""Cross-language account lock/reservation protocol shared by V12, PENGU and V52.

The file format intentionally matches lib/disdex-account-order-lock.ts.  It is
safe-by-default and is only a coordination primitive; it never submits orders.
"""
from __future__ import annotations

import hashlib
import json
import os
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any

SCHEMA = "disdex-account-lock/v1"
DEFAULT_SCOPE = "ASTER_FUTURES"


def _now_ms() -> int:
    return int(time.time() * 1000)


def _load(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise
    if not isinstance(value, dict) or value.get("schema") != SCHEMA or not value.get("ownerId") or not value.get("leaseId"):
        raise RuntimeError("ACCOUNT_LOCK_MALFORMED")
    if not isinstance(value.get("reservations", []), list):
        raise RuntimeError("ACCOUNT_LOCK_MALFORMED")
    return value


def _atomic_write(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix=f"{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, indent=2, sort_keys=True)
            handle.write("\n")
        os.replace(temp, path)
    finally:
        try:
            os.unlink(temp)
        except FileNotFoundError:
            pass


class AccountOrderLock:
    def __init__(self, path: str | Path | None = None, lease_ms: int = 120_000, default_owner: str | None = None):
        self.path = Path(path or os.getenv("DISDEX_ACCOUNT_LOCK_PATH", ".runtime-state/shared/account-order.lock")).resolve()
        self.lease_ms = lease_ms
        self.default_owner = default_owner
        self.owner_id: str | None = None
        self.lease_id: str | None = None

    def acquire(self, owner_id: str | None = None, account_scope: str = DEFAULT_SCOPE) -> bool:
        owner_id = owner_id or self.default_owner
        if not owner_id:
            raise ValueError("ACCOUNT_LOCK_OWNER_REQUIRED")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        for attempt in range(2):
            now = _now_ms()
            payload = {"schema": SCHEMA, "accountScope": account_scope, "ownerId": owner_id, "leaseId": str(uuid.uuid4()), "acquiredAt": now, "expiresAt": now + self.lease_ms, "reservations": []}
            try:
                fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
                with os.fdopen(fd, "w", encoding="utf-8") as handle:
                    json.dump(payload, handle, indent=2)
                    handle.write("\n")
                self.owner_id, self.lease_id = owner_id, payload["leaseId"]
                return True
            except FileExistsError:
                try:
                    current = _load(self.path)
                    if int(current.get("expiresAt", 0)) > _now_ms() or attempt:
                        return False
                    # Expired ownership is not proof that an exchange order is
                    # settled. Leave the lease in place for reconciliation/manual
                    # review instead of deleting it automatically.
                    return False
                except FileNotFoundError:
                    continue
                except Exception:
                    return False
        return False

    def _owned(self) -> dict[str, Any]:
        current = _load(self.path)
        if current.get("ownerId") != self.owner_id or current.get("leaseId") != self.lease_id or int(current.get("expiresAt", 0)) <= _now_ms():
            raise RuntimeError("ACCOUNT_LOCK_NOT_OWNER")
        return current

    def reserve(self, strategy_id: str, symbol: str, side: str, gross: float, notional_usd: float) -> dict[str, Any]:
        if gross < 0 or notional_usd < 0:
            raise ValueError("ACCOUNT_RESERVATION_INVALID")
        current = self._owned()
        reservation_id = hashlib.sha256(f"{self.lease_id}|{strategy_id}|{symbol}|{side}|{gross}|{notional_usd}".encode()).hexdigest()[:24]
        reservation = {"reservationId": reservation_id, "strategyId": strategy_id, "symbol": symbol, "side": side, "gross": gross, "notionalUsd": notional_usd, "createdAt": _now_ms(), "status": "RESERVED"}
        current["expiresAt"] = _now_ms() + self.lease_ms
        current["reservations"] = [row for row in current.get("reservations", []) if row.get("reservationId") != reservation_id] + [reservation]
        _atomic_write(self.path, current)
        return reservation

    def release_reservation(self, reservation_id: str) -> None:
        current = self._owned()
        current["expiresAt"] = _now_ms() + self.lease_ms
        current["reservations"] = [{**row, "status": "RELEASED"} if row.get("reservationId") == reservation_id else row for row in current.get("reservations", [])]
        _atomic_write(self.path, current)

    def release(self) -> None:
        try:
            current = _load(self.path)
            if current.get("ownerId") == self.owner_id and current.get("leaseId") == self.lease_id:
                self.path.unlink()
        except FileNotFoundError:
            pass


def active_reserved_gross(document: dict[str, Any]) -> float:
    return sum(float(row.get("gross", 0)) for row in document.get("reservations", []) if row.get("status") == "RESERVED")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        directory = Path.cwd() / ".codex-tmp" / f"account-lock-selftest-{os.getpid()}"
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / "lock.json"
        try:
            lock = AccountOrderLock(path)
            assert lock.acquire("python-selftest")
            row = lock.reserve("V12_X1.00_ALL", "ETHUSDT", "LONG", 0.25, 250.0)
            assert row["status"] == "RESERVED"
            lock.release_reservation(row["reservationId"])
            lock.release()
            print("ACCOUNT_ORDER_LOCK_SELFTEST_PASS")
        finally:
            try:
                path.unlink()
                directory.rmdir()
            except FileNotFoundError:
                pass
