"""Cross-language account lock/reservation protocol shared by V12, PENGU and V52.

The on-disk lock and waiter formats intentionally match
``lib/disdex-account-order-lock.ts``.  This module is a coordination primitive
only; it never submits, cancels or modifies an exchange order.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any

SCHEMA = "disdex-account-lock/v1"
WAITER_SCHEMA = "disdex-account-lock-waiter/v1"
DEFAULT_SCOPE = "ASTER_FUTURES"


def _now_ms() -> int:
    return int(time.time() * 1000)


def _int_env(name: str, fallback: int) -> int:
    try:
        return int(float(os.getenv(name, str(fallback))))
    except (TypeError, ValueError):
        return fallback


def account_order_priority(owner_id: str) -> int:
    """Return the cross-language execution priority (lower wins)."""
    match = re.search(r"(?:^|:)P([1-4])(?::|$)", owner_id)
    if match:
        return int(match.group(1))
    if owner_id.startswith("V52:"):
        return 2
    if owner_id.startswith("PENGU_DUAL_LS_V2:"):
        return 3
    if owner_id.startswith("V12_X1.00_ALL:"):
        return 4
    return 5


def _load(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
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
        self.waiter_dir = Path(f"{self.path}.waiters")
        self.lease_ms = lease_ms
        self.default_owner = default_owner
        self.owner_id: str | None = None
        self.lease_id: str | None = None
        self.arbitration_ms = min(1000, max(0, _int_env("DISDEX_ACCOUNT_LOCK_ARBITRATION_MS", 200)))
        self.waiter_ttl_ms = max(2000, _int_env("DISDEX_ACCOUNT_LOCK_WAITER_TTL_MS", 10_000))

    def _register_waiter(self, owner_id: str) -> tuple[dict[str, Any], Path]:
        self.waiter_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        waiter_id = str(uuid.uuid4())
        created_at = _now_ms()
        waiter = {
            "schema": WAITER_SCHEMA,
            "ownerId": owner_id,
            "waiterId": waiter_id,
            "priority": account_order_priority(owner_id),
            "createdAt": created_at,
            "expiresAt": created_at + self.waiter_ttl_ms,
        }
        digest = hashlib.sha256(f"{owner_id}|{waiter_id}".encode()).hexdigest()[:24]
        path = self.waiter_dir / f"wait-{digest}.json"
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(waiter, handle, separators=(",", ":"))
            handle.write("\n")
        return waiter, path

    def _active_waiters(self) -> list[dict[str, Any]]:
        now = _now_ms()
        rows: list[dict[str, Any]] = []
        try:
            names = list(self.waiter_dir.iterdir())
        except FileNotFoundError:
            return rows
        for path in names:
            if not path.is_file() or not re.fullmatch(r"wait-[0-9a-f]{24}\.json", path.name):
                continue
            try:
                raw = json.loads(path.read_text(encoding="utf-8"))
                if not isinstance(raw, dict) or raw.get("schema") != WAITER_SCHEMA or not isinstance(raw.get("ownerId"), str) or not isinstance(raw.get("waiterId"), str):
                    path.unlink(missing_ok=True)
                    continue
                expires_at = int(raw.get("expiresAt", 0))
                if expires_at <= now:
                    path.unlink(missing_ok=True)
                    continue
                rows.append({
                    "ownerId": raw["ownerId"],
                    "waiterId": raw["waiterId"],
                    "priority": int(raw.get("priority") or account_order_priority(raw["ownerId"])),
                    "createdAt": int(raw.get("createdAt") or now),
                    "expiresAt": expires_at,
                    "path": path,
                })
            except Exception:
                try:
                    path.unlink()
                except FileNotFoundError:
                    pass
        rows.sort(key=lambda row: (row["priority"], row["createdAt"], row["ownerId"], row["waiterId"]))
        return rows

    def acquire(self, owner_id: str | None = None, account_scope: str = DEFAULT_SCOPE) -> bool:
        owner_id = owner_id or self.default_owner
        if not owner_id:
            raise ValueError("ACCOUNT_LOCK_OWNER_REQUIRED")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        waiter, waiter_path = self._register_waiter(owner_id)
        try:
            if self.arbitration_ms:
                time.sleep(self.arbitration_ms / 1000.0)
            waiters = self._active_waiters()
            if not waiters or waiters[0]["waiterId"] != waiter["waiterId"]:
                return False

            now = _now_ms()
            payload = {
                "schema": SCHEMA,
                "accountScope": account_scope,
                "ownerId": owner_id,
                "leaseId": str(uuid.uuid4()),
                "acquiredAt": now,
                "expiresAt": now + self.lease_ms,
                "reservations": [],
            }
            try:
                fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
                with os.fdopen(fd, "w", encoding="utf-8") as handle:
                    json.dump(payload, handle, indent=2)
                    handle.write("\n")
                self.owner_id, self.lease_id = owner_id, payload["leaseId"]
                return True
            except FileExistsError:
                # Never steal an expired cross-language lock from Python. An
                # expired lease can still correspond to an exchange request in
                # flight. V12's durable-state-aware takeover is implemented in
                # the Node V12 owner, which has the necessary pending evidence.
                try:
                    _load(self.path)
                except Exception:
                    pass
                return False
        finally:
            try:
                waiter_path.unlink()
            except FileNotFoundError:
                pass

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
        finally:
            self.owner_id = None
            self.lease_id = None


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
            assert account_order_priority("V52:P2:live:1") == 2
            assert account_order_priority("PENGU_DUAL_LS_V2:P3:1") == 3
            assert account_order_priority("V12_X1.00_ALL:P4:1") == 4
            assert account_order_priority("V12_X1.00_ALL:P1:1") == 1
            lock = AccountOrderLock(path)
            assert lock.acquire("V52:P2:python-selftest")
            row = lock.reserve("V12_X1.00_ALL", "ETHUSDT", "LONG", 0.25, 250.0)
            assert row["status"] == "RESERVED"
            lock.release_reservation(row["reservationId"])
            lock.release()
            print("ACCOUNT_ORDER_LOCK_SELFTEST_PASS")
        finally:
            try:
                path.unlink()
            except FileNotFoundError:
                pass
            try:
                for child in Path(f"{path}.waiters").iterdir():
                    child.unlink()
                Path(f"{path}.waiters").rmdir()
            except FileNotFoundError:
                pass
            try:
                directory.rmdir()
            except OSError:
                pass
