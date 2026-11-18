#!/usr/bin/env python3
"""Refresh and resume the flat IDLE runner while H48 GLOBAL HOLD is active.

This is a narrow non-order maintenance path.  It is usable only from the
formal all-runner task, and it never clears the Kill Switch, changes a runner
pin, enables orders, cancels an order, changes a position, or changes a STOP.
The existing flat state is backed up and refreshed atomically, then the exact
existing IDLE unit is started under the still-active GLOBAL HOLD.  Signed
venue GETs prove the account is flat before and after the operation.
"""
from __future__ import annotations

import argparse
import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path
import stat
import subprocess
import tempfile
import time

from disdex_h48_protected_hold import (
    H48ProtectedHoldError,
    validate_h48_protected_hold,
)

IDLE_SHA = "7688ed7c93a1918d8b44837339b7da5584a868f5"
IDLE_UNIT = f"disdex-idle-priority-short@{IDLE_SHA}.service"
IDLE_STATE_SCHEMA = "disdex-idle-residual-long-state/v1"
BASE = Path("/home/deploy/disdex-trading/releases")
CURRENT = Path("/home/deploy/disdex-trading/current")
PINS = Path("/etc/disdex/runner-pins.json")
STATE = Path("/var/lib/disdex/idle-priority/residual-long-state.json")
KILL = Path("/var/lib/disdex/shared/kill-switch.json")
H48_HOLD_RECEIPT = Path(
    "/etc/disdex/stable4/holds/e0e4f1d8f22b62e9410188ef6e590a20e31f760f.json"
)
RISK = Path("/var/lib/disdex/shared/crypto-daily-risk.json")
MARGIN = Path("/var/lib/disdex/shared/margin-risk/guard-live.json")
PENDING = Path("/var/lib/disdex/shared/pending-exposure.json")
BACKUP_ROOT = Path("/var/backups/disdex-idle-h48-protected-recovery")


def require(ok: bool, reason: str) -> None:
    if not ok:
        raise ValueError(reason)


def read_json(path: Path) -> dict:
    require(path.is_file() and not path.is_symlink(), "STATE_FILE_INVALID:" + str(path))
    st = path.stat()
    require(stat.S_ISREG(st.st_mode) and not st.st_mode & 0o022,
            "STATE_FILE_PERMISSIONS_INVALID:" + str(path))
    value = json.loads(path.read_text())
    require(isinstance(value, dict), "STATE_NOT_OBJECT:" + str(path))
    return value


def state_bytes(path: Path) -> tuple[bytes, os.stat_result]:
    st = path.lstat()
    require(stat.S_ISREG(st.st_mode) and not path.is_symlink(),
            "IDLE_STATE_NOT_REGULAR")
    require(st.st_uid != 0 and not st.st_mode & 0o022,
            "IDLE_STATE_OWNER_OR_PERMISSIONS_INVALID")
    return path.read_bytes(), st


def validate_idle_state(value: dict, now_ms: int) -> dict:
    require(isinstance(value, dict), "IDLE_STATE_NOT_OBJECT")
    require(value.get("schema") == IDLE_STATE_SCHEMA, "IDLE_STATE_SCHEMA_INVALID")
    require(value.get("runtimeSha") == IDLE_SHA, "IDLE_STATE_OWNER_SHA_INVALID")
    require(all(value.get(k) is None for k in ("position", "pending", "manualReview")),
            "IDLE_STATE_NOT_FLAT")
    updated = value.get("updatedAt")
    require(type(updated) is int and updated > 0 and updated <= now_ms + 1000,
            "IDLE_STATE_UPDATED_AT_INVALID")
    return value


def refreshed_idle_state(value: dict, now_ms: int) -> dict:
    validate_idle_state(value, now_ms)
    refreshed = dict(value)
    refreshed["updatedAt"] = now_ms
    return refreshed


def validate_flat_signed_get(value: dict) -> dict:
    require(isinstance(value, dict), "ASTER_GET_NOT_OBJECT")
    require(value.get("status") == "ASTER_READONLY_ACCOUNT_DIAGNOSTIC_PASS",
            "ASTER_GET_NOT_PASS")
    require(all(type(value.get(k)) is int and value[k] == 0
                for k in ("ordersSent", "cancelsSent", "positionChangesSent")),
            "ASTER_GET_NOT_READONLY")
    positions = value.get("positions")
    orders = value.get("openOrders")
    require(isinstance(positions, list) and isinstance(orders, list),
            "ASTER_GET_ARRAYS_INVALID")
    require(all(isinstance(row, dict) for row in positions + orders),
            "ASTER_GET_ROW_INVALID")
    require(not positions and not orders, "ASTER_ACCOUNT_NOT_FLAT")
    return value


def prop(unit: str, key: str) -> str:
    result = subprocess.run(
        ["systemctl", "show", unit, "--property=" + key, "--value"],
        capture_output=True, text=True, timeout=15,
    )
    require(result.returncode == 0, "SYSTEMD_PROPERTY_FAILED:" + unit)
    return result.stdout.strip()


def active(unit: str) -> bool:
    return prop(unit, "ActiveState") == "active"


def runner_pin_sha(runner: str) -> str:
    pins = read_json(PINS)
    row = (pins.get("runners") or {}).get(runner)
    require(isinstance(row, dict), "RUNNER_PIN_MISSING:" + runner)
    sha = str(row.get("sha") or "")
    require(len(sha) == 40 and all(c in "0123456789abcdef" for c in sha),
            "RUNNER_PIN_SHA_INVALID:" + runner)
    require(row.get("releaseRoot") == str(BASE / sha), "RUNNER_PIN_ROOT_INVALID:" + runner)
    if runner == "IDLE_PRIORITY_SHORT":
        expected_unit = f"disdex-idle-priority-short@{sha}.service"
    else:
        expected_unit = str(row.get("serviceUnit") or "")
    require(row.get("serviceUnit") == expected_unit, "RUNNER_PIN_UNIT_INVALID:" + runner)
    marker = BASE / sha / ".disdex-release-sha"
    require(marker.is_file() and not marker.is_symlink() and marker.read_text().strip() == sha,
            "RUNNER_RELEASE_MARKER_INVALID:" + runner)
    return sha


def verify_runtime_pin() -> None:
    marker = CURRENT / ".disdex-release-sha"
    require(marker.is_file() and marker.read_text().strip() == IDLE_SHA,
            "CURRENT_RELEASE_SHA_MISMATCH")
    sha = runner_pin_sha("IDLE_PRIORITY_SHORT")
    require(sha == IDLE_SHA, "IDLE_PIN_SHA_MISMATCH")
    require(prop(IDLE_UNIT, "ActiveState") in ("failed", "inactive"),
            "IDLE_ALREADY_ACTIVE_OR_STARTING")


def verify_h48_hold(now_ms: int) -> tuple[bytes, dict]:
    require(KILL.is_file() and not KILL.is_symlink(), "KILL_STATE_INVALID")
    kill_stat = KILL.stat()
    require(stat.S_ISREG(kill_stat.st_mode) and not kill_stat.st_mode & 0o022,
            "KILL_STATE_PERMISSIONS_INVALID")
    kill_bytes = KILL.read_bytes()
    kill = json.loads(kill_bytes)
    require(H48_HOLD_RECEIPT.is_file() and not H48_HOLD_RECEIPT.is_symlink(),
            "H48_HOLD_RECEIPT_MISSING")
    hold_stat = H48_HOLD_RECEIPT.stat()
    require(stat.S_ISREG(hold_stat.st_mode) and hold_stat.st_uid == 0
            and not hold_stat.st_mode & 0o222,
            "H48_HOLD_RECEIPT_NOT_ROOT_IMMUTABLE")
    receipt = json.loads(H48_HOLD_RECEIPT.read_text())
    try:
        observation = validate_h48_protected_hold(
            kill, receipt, kill_bytes, now_ms, allow_expired_observation=True
        )
    except H48ProtectedHoldError as error:
        raise RuntimeError(str(error)) from None
    require(observation["ordersEnabled"] is False and observation["authorizesOrders"] is False,
            "H48_HOLD_ORDER_AUTHORITY_PRESENT")
    return kill_bytes, observation


def verify_shared_health(now_ms: int) -> None:
    kill_bytes, _ = verify_h48_hold(now_ms)
    risk = read_json(RISK)
    require(risk.get("sourceComplete") is True and risk.get("tripped") is False,
            "SHARED_RISK_NOT_HEALTHY")
    updated = risk.get("updatedAt")
    require(risk.get("utcDay") == datetime.fromtimestamp(now_ms / 1000, timezone.utc).date().isoformat()
            and type(updated) in (int, float) and -1000 <= now_ms - updated <= 15 * 60_000,
            "SHARED_RISK_STALE_OR_WRONG_UTC_DAY")
    limits = [risk[k] for k in ("maximumLossPct", "dailyLossLimit", "maxDailyLossPct", "dailyLossLimitPct")
              if k in risk and risk[k] is not None]
    require(bool(limits), "SHARED_RISK_LIMIT_MISSING")
    for value in limits:
        require(not isinstance(value, bool), "SHARED_RISK_LIMIT_INVALID")
        try:
            number = float(value)
        except (TypeError, ValueError):
            raise RuntimeError("SHARED_RISK_LIMIT_INVALID") from None
        require(math.isfinite(number) and (abs(number - 0.075) < 1e-9 or abs(number - 7.5) < 1e-9),
                "SHARED_RISK_LIMIT_MISMATCH")
    margin = read_json(MARGIN)
    require(margin.get("stage") == "HEALTHY" and margin.get("ordersAllowed") is True,
            "MARGIN_GUARD_NOT_HEALTHY")
    checked = margin.get("checkedAt")
    require(type(checked) in (int, float) and -1000 <= now_ms - checked <= 15 * 60_000,
            "MARGIN_GUARD_STALE")
    pending = read_json(PENDING)
    entries = pending.get("entries")
    require(isinstance(entries, list) and all(isinstance(row, dict) for row in entries),
            "PENDING_EXPOSURE_INVALID")
    require(not any(str(row.get("status", "")).upper() != "RELEASED" for row in entries),
            "PENDING_EXPOSURE_ACTIVE")
    require(KILL.read_bytes() == kill_bytes, "KILL_CHANGED_DURING_HEALTH_CHECK")


def signed_get() -> dict:
    v4_sha = runner_pin_sha("V12_V4")
    release = BASE / v4_sha
    command = (
        "set -ae; for f in /etc/disdex/disdex-v13d-v11eq-v96.env "
        "/etc/disdex/disdex-v12-pengu-v2-v52.env /etc/disdex/disdex-v12-v4.env "
        f"/etc/disdex/current-runtime/{v4_sha}.env; do . \"$f\"; done; set +a; "
        "[ \"$" + "{DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH:-}\" = "
        "\"/var/lib/disdex/shared/aster-rate-budget.json\" ] || exit 42; "
        f"exec /usr/sbin/runuser -u deploy -- /usr/bin/node {release}/node_modules/tsx/dist/cli.mjs "
        "scripts/disdex-aster-readonly-account-diagnostic.ts"
    )
    result = subprocess.run(
        ["/bin/bash", "-c", command], cwd=release, capture_output=True,
        text=True, timeout=55,
    )
    require(result.returncode == 0, "ASTER_SIGNED_GET_FAILED")
    rows = [line for line in result.stdout.splitlines() if line.startswith("{")]
    require(rows, "ASTER_SIGNED_GET_EMPTY")
    return validate_flat_signed_get(json.loads(rows[-1]))


def atomic_write_state(raw: bytes, st: os.stat_result, run_id: str) -> None:
    fd, temp = tempfile.mkstemp(dir=STATE.parent, prefix=".idle-h48-" + run_id + "-")
    try:
        with os.fdopen(fd, "wb") as file:
            os.fchmod(file.fileno(), stat.S_IMODE(st.st_mode))
            file.write(raw)
            file.flush()
            os.fsync(file.fileno())
        os.chown(temp, st.st_uid, st.st_gid)
        os.replace(temp, STATE)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def backup_state(raw: bytes, run_id: str) -> Path:
    BACKUP_ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    root_stat = BACKUP_ROOT.stat()
    require(root_stat.st_uid == 0 and stat.S_IMODE(root_stat.st_mode) == 0o700,
            "BACKUP_ROOT_UNSAFE")
    backup = BACKUP_ROOT / f"idle-state-before-h48-refresh-{run_id}.json"
    require(not backup.exists() and not backup.is_symlink(), "BACKUP_ALREADY_EXISTS")
    with backup.open("xb") as file:
        os.fchmod(file.fileno(), 0o600)
        file.write(raw)
        file.flush()
        os.fsync(file.fileno())
    require(backup.read_bytes() == raw, "BACKUP_NOT_EXACT")
    return backup


def wait_stable(pid: int, timeout_seconds: int = 45) -> None:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        if active(IDLE_UNIT):
            current_pid = int(prop(IDLE_UNIT, "MainPID") or "0")
            if current_pid == pid:
                time.sleep(3)
                require(active(IDLE_UNIT) and int(prop(IDLE_UNIT, "MainPID") or "0") == pid,
                        "IDLE_NOT_STABLE")
                return
        time.sleep(1)
    raise RuntimeError("IDLE_NOT_ACTIVE")


def run(run_id: str) -> dict:
    require(os.geteuid() == 0, "ROOT_REQUIRED")
    require(run_id.isdecimal() and len(run_id) <= 20, "RUN_ID_INVALID")
    now = int(time.time() * 1000)
    verify_runtime_pin()
    verify_shared_health(now)
    before_venue = signed_get()
    raw, state_stat = state_bytes(STATE)
    state = json.loads(raw)
    refreshed = refreshed_idle_state(state, now)
    backup = backup_state(raw, run_id)
    started = False
    try:
        require(STATE.read_bytes() == raw, "IDLE_STATE_CHANGED_BEFORE_REFRESH")
        atomic_write_state((json.dumps(refreshed, indent=2) + "\n").encode(), state_stat, run_id)
        require(json.loads(STATE.read_text()).get("updatedAt") == now,
                "IDLE_STATE_REFRESH_READBACK_FAILED")
        verify_shared_health(int(time.time() * 1000))
        after_refresh = signed_get()
        require(not after_refresh["positions"] and not after_refresh["openOrders"],
                "ASTER_ACCOUNT_NOT_FLAT_AFTER_REFRESH")
        reset = subprocess.run(["systemctl", "reset-failed", IDLE_UNIT],
                               capture_output=True, text=True, timeout=20)
        require(reset.returncode == 0, "IDLE_RESET_FAILED")
        start = subprocess.run(["systemctl", "start", IDLE_UNIT],
                               capture_output=True, text=True, timeout=90)
        require(start.returncode == 0, "IDLE_START_FAILED:" + (start.stderr or start.stdout)[-180:])
        started = True
        pid = int(prop(IDLE_UNIT, "MainPID") or "0")
        require(pid > 100, "IDLE_PID_INVALID")
        wait_stable(pid)
        after_venue = signed_get()
        require(all(after_venue.get(key) == 0 for key in
                    ("ordersSent", "cancelsSent", "positionChangesSent")),
                "ASTER_POSTCHECK_MUTATION")
        require(not after_venue["positions"] and not after_venue["openOrders"],
                "ASTER_ACCOUNT_NOT_FLAT_AFTER_START")
        verify_shared_health(int(time.time() * 1000))
        result = {
            "status": "IDLE_H48_PROTECTED_RECOVERY_PASS",
            "runner": "IDLE_PRIORITY_SHORT",
            "unit": IDLE_UNIT,
            "pid": pid,
            "backup": str(backup),
            "protectedHoldObservation": True,
            "ordersEnabled": False,
            "ordersSent": 0,
            "cancelsSent": 0,
            "positionChangesSent": 0,
            "signedBeforeObservedAt": before_venue.get("observedAt"),
            "signedAfterObservedAt": after_venue.get("observedAt"),
        }
        print(json.dumps(result, sort_keys=True))
        return result
    except Exception:
        if started:
            subprocess.run(["systemctl", "stop", IDLE_UNIT],
                           capture_output=True, text=True, timeout=45)
        if STATE.read_bytes() != raw:
            atomic_write_state(raw, state_stat, run_id + "-rollback")
        raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()
    try:
        run(args.run_id)
    except Exception as error:
        print("IDLE_H48_PROTECTED_RECOVERY_BLOCKED:" + type(error).__name__ + ":" + str(error)[:240],
              file=os.sys.stderr)
        raise
