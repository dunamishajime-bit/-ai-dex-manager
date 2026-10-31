#!/usr/bin/env python3
"""Exact root recovery for the V52/IDLE Residual owner-SHA HOLD.

This recovery is deliberately narrow. It never changes venue orders or
positions. It clears only the known recoverable V52 HOLD after:
- the V52 owner-SHA hotfix is the sole active V52 runner,
- IDLE Residual state is fresh and flat under the independently pinned IDLE SHA,
- Shared Risk and Margin Guard are healthy,
- no active pending-exposure reservation exists, and
- three stable signed Aster GETs prove the resident DOGE V4 short remains
  protected by its exact reduce-only STOP.

Any post-clear venue mismatch immediately re-arms HOLD_PROTECTED.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import time
from datetime import datetime, timezone

IDLE_SHA = "7688ed7c93a1918d8b44837339b7da5584a868f5"
OLD_V52_SHA = "97830672e2f139b39f7194166d7dc8c36e8c8933"
V52_SHA = "4d33d8244c0b50a7e461ffd8aaf493c32bfdfd81"
V4_SHA = "53a0be396719f0284af4e11b35c66a4ac7d58f79"
KNOWN_STOP = "v12-v4-98ded39746ed3502a4d7b0e26ef9"

STATE = Path("/var/lib/disdex/idle-priority/residual-long-state.json")
KILL = Path("/var/lib/disdex/shared/kill-switch.json")
RISK = Path("/var/lib/disdex/shared/crypto-daily-risk.json")
MARGIN = Path("/var/lib/disdex/shared/margin-risk/guard-live.json")
PENDING = Path("/var/lib/disdex/shared/pending-exposure.json")
RELEASES = Path("/home/deploy/disdex-trading/releases")
BACKUP_ROOT = Path("/var/backups/disdex-kill-switch")
IDLE_UNIT = f"disdex-idle-priority-short@{IDLE_SHA}.service"
V52_UNIT = f"disdex-v52-aster-only@{V52_SHA}.service"
OLD_V52_UNIT = f"disdex-v52-aster-only@{OLD_V52_SHA}.service"

KNOWN_REASON_PREFIX = (
    'V52 recoverable tick error: IDLE_RESIDUAL_CORE_PREEMPT_HELPER_FAILED:rc=2:'
)
KNOWN_REASON_FRAGMENT = "IDLE_RESIDUAL_STATE_RUNTIME_OR_SCHEMA_MISMATCH"


def _json(path: Path) -> tuple[os.stat_result, bytes, dict]:
    st = path.lstat()
    if not stat.S_ISREG(st.st_mode) or st.st_mode & 0o077:
        raise ValueError("UNTRUSTED_STATE_FILE:" + str(path))
    raw = path.read_bytes()
    if len(raw) > 262144:
        raise ValueError("STATE_FILE_TOO_LARGE:" + str(path))
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError("STATE_NOT_OBJECT:" + str(path))
    return st, raw, value


def active_pending_count(pending: dict) -> int:
    entries = pending.get("entries")
    if not isinstance(entries, list):
        raise ValueError("PENDING_EXPOSURE_ENTRIES_INVALID")
    active = 0
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError("PENDING_EXPOSURE_ENTRY_INVALID")
        if str(entry.get("status", "")).upper() != "RELEASED":
            active += 1
    return active


def validate_known_kill(kill: dict) -> None:
    reason = str(kill.get("reason") or "")
    if (
        kill.get("active") is not True
        or kill.get("action") != "HOLD_PROTECTED"
        or kill.get("recoverable") is not True
        or kill.get("operator") != "disdex-v52-aster-only"
        or not reason.startswith(KNOWN_REASON_PREFIX)
        or KNOWN_REASON_FRAGMENT not in reason
    ):
        raise ValueError("KILL_SWITCH_REASON_NOT_EXACT_RECOVERABLE_V52_IDLE_OWNER_HOLD")


def validate_flat_fresh_state(state: dict, now_ms: int) -> None:
    if state.get("schema") != "disdex-idle-residual-long-state/v1":
        raise ValueError("IDLE_STATE_SCHEMA_INVALID")
    if state.get("runtimeSha") != IDLE_SHA:
        raise ValueError("IDLE_STATE_OWNER_SHA_INVALID")
    if any(state.get(k) is not None for k in ("position", "pending", "manualReview")):
        raise ValueError("IDLE_STATE_NOT_FLAT")
    updated = state.get("updatedAt")
    if type(updated) not in (int, float) or updated > now_ms + 1000:
        raise ValueError("IDLE_STATE_UPDATED_AT_INVALID")
    if now_ms - updated > 20 * 60_000:
        raise ValueError("IDLE_STATE_STALE_AFTER_FORMAL_REPAIR")


def validate_venue(value: dict) -> str:
    if value.get("status") != "ASTER_READONLY_ACCOUNT_DIAGNOSTIC_PASS":
        raise ValueError("SIGNED_ACCOUNT_DIAGNOSTIC_FAILED")
    if any(value.get(k) != 0 for k in ("ordersSent", "cancelsSent", "positionChangesSent")):
        raise ValueError("VENUE_READONLY_VIOLATED")
    positions = value.get("positions") or []
    orders = value.get("openOrders") or []
    if len(positions) != 1 or len(orders) != 1:
        raise ValueError("UNEXPECTED_LIVE_POSITION_OR_OPEN_ORDER")
    p, s = positions[0], orders[0]
    contract = {
        "symbol": p.get("symbol"),
        "positionSide": p.get("positionSide"),
        "positionAmt": float(p.get("positionAmt", 0)),
        "entryPrice": float(p.get("entryPrice", 0)),
        "stopSymbol": s.get("symbol"),
        "clientOrderId": s.get("clientOrderId"),
        "stopType": s.get("type"),
        "stopSide": s.get("side"),
        "origQty": float(s.get("origQty", 0)),
        "executedQty": float(s.get("executedQty", 0)),
        "reduceOnly": s.get("reduceOnly"),
        "status": s.get("status"),
    }
    expected = {
        "symbol": "DOGEUSDT",
        "positionSide": "BOTH",
        "positionAmt": -226.0,
        "entryPrice": 0.08052,
        "stopSymbol": "DOGEUSDT",
        "clientOrderId": KNOWN_STOP,
        "stopType": "STOP_MARKET",
        "stopSide": "BUY",
        "origQty": 226.0,
        "executedQty": 0.0,
        "reduceOnly": True,
        "status": "NEW",
    }
    if contract != expected:
        raise ValueError("V4_RESIDENT_STOP_OR_POSITION_MISMATCH")
    return hashlib.sha256(json.dumps(contract, sort_keys=True).encode()).hexdigest()


def _systemd(unit: str, prop: str) -> str:
    result = subprocess.run(
        ["/usr/bin/systemctl", "show", unit, "--property=" + prop, "--value"],
        capture_output=True, text=True, check=False, timeout=12,
    )
    if result.returncode:
        raise ValueError("SYSTEMD_STATE_UNAVAILABLE:" + unit)
    return result.stdout.strip()


def _assert_runtime() -> None:
    if os.geteuid() != 0:
        raise ValueError("ROOT_REQUIRED")
    if _systemd(IDLE_UNIT, "ActiveState") != "failed" or _systemd(IDLE_UNIT, "MainPID") != "0":
        raise ValueError("IDLE_OWNER_NOT_FAILED_PID0")
    if _systemd(V52_UNIT, "ActiveState") != "active":
        raise ValueError("V52_HOTFIX_NOT_ACTIVE")
    pid = _systemd(V52_UNIT, "MainPID")
    if not pid.isdigit() or int(pid) <= 100:
        raise ValueError("V52_HOTFIX_PID_INVALID")
    if _systemd(OLD_V52_UNIT, "ActiveState") in ("active", "activating", "deactivating"):
        raise ValueError("OLD_V52_STILL_ACTIVE")
    env = {}
    for pair in (Path("/proc") / pid / "environ").read_bytes().split(b"\0"):
        if b"=" in pair:
            k, v = pair.split(b"=", 1)
            env[k.decode(errors="ignore")] = v.decode(errors="ignore")
    if env.get("DISDEX_RUNTIME_COMMIT_SHA") != V52_SHA:
        raise ValueError("V52_RUNTIME_SHA_MISMATCH")
    if env.get("DISDEX_IDLE_PRIORITY_RUNTIME_SHA") != IDLE_SHA:
        raise ValueError("V52_IDLE_OWNER_PIN_MISMATCH")


def _assert_local_health() -> tuple[os.stat_result, bytes, dict]:
    now_ms = int(time.time() * 1000)
    state_st, state_raw, state = _json(STATE)
    validate_flat_fresh_state(state, now_ms)
    kill_st, kill_raw, kill = _json(KILL)
    validate_known_kill(kill)
    _, _, risk = _json(RISK)
    if risk.get("sourceComplete") is not True or risk.get("tripped") is True:
        raise ValueError("SHARED_RISK_NOT_HEALTHY")
    _, _, margin = _json(MARGIN)
    if margin.get("stage") != "HEALTHY" or margin.get("ordersAllowed") is not True:
        raise ValueError("MARGIN_GUARD_NOT_HEALTHY")
    checked = margin.get("checkedAt")
    if type(checked) not in (int, float) or now_ms - checked > 15 * 60_000 or checked > now_ms + 1000:
        raise ValueError("MARGIN_GUARD_STALE")
    _, _, pending = _json(PENDING)
    if active_pending_count(pending) != 0:
        raise ValueError("ACTIVE_PENDING_EXPOSURE_EXISTS")
    return kill_st, kill_raw, kill


def _signed_get() -> dict:
    release = RELEASES / V4_SHA
    command = (
        "set -ae; for f in "
        "/etc/disdex/disdex-v13d-v11eq-v96.env "
        "/etc/disdex/disdex-v12-pengu-v2-v52.env "
        "/etc/disdex/disdex-v12-v4.env; do . \"$f\"; done; set +a; "
        f"exec /usr/bin/node {release}/node_modules/tsx/dist/cli.mjs "
        "scripts/disdex-aster-readonly-account-diagnostic.ts"
    )
    result = subprocess.run(
        ["/bin/bash", "-c", command], cwd=release,
        capture_output=True, text=True, encoding="utf8", errors="replace", timeout=35,
    )
    if result.returncode:
        raise ValueError("ASTER_SIGNED_GET_FAILED")
    lines = [line for line in result.stdout.splitlines() if line.startswith("{")]
    if not lines:
        raise ValueError("ASTER_SIGNED_GET_MISSING_RESULT")
    value = json.loads(lines[-1])
    return {
        "observedAt": value.get("observedAt"),
        "stopContractDigest": validate_venue(value),
    }


def _three_get_proof() -> list[dict]:
    proof = []
    for _ in range(3):
        proof.append(_signed_get())
        time.sleep(1)
    times = [row["observedAt"] for row in proof]
    if any(type(x) is not int for x in times) or times != sorted(set(times)):
        raise ValueError("ASTER_SIGNED_OBSERVATIONS_NOT_INCREASING")
    if len({row["stopContractDigest"] for row in proof}) != 1:
        raise ValueError("RESIDENT_STOP_NOT_STABLE")
    return proof


def _atomic_kill(value: dict, st: os.stat_result) -> None:
    temp = KILL.parent / (".kill-recovery-" + str(os.getpid()) + ".tmp")
    if temp.exists() or temp.is_symlink():
        raise ValueError("KILL_TMP_PATH_EXISTS")
    raw = (json.dumps(value, indent=2, sort_keys=True) + "\n").encode()
    try:
        with os.fdopen(os.open(temp, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600), "wb") as f:
            f.write(raw); f.flush(); os.fsync(f.fileno())
        os.chown(temp, st.st_uid, st.st_gid)
        os.replace(temp, KILL)
    finally:
        if temp.exists():
            temp.unlink()


def run(commit: bool) -> dict:
    _assert_runtime()
    kill_st, kill_raw, kill = _assert_local_health()
    proof = _three_get_proof()
    _assert_runtime()
    now_st, now_raw, now_kill = _assert_local_health()
    if now_raw != kill_raw or now_st.st_ino != kill_st.st_ino or now_st.st_mtime_ns != kill_st.st_mtime_ns:
        raise ValueError("KILL_SWITCH_CHANGED_DURING_PROOF")
    result = {
        "status": "READ_ONLY_KILL_RECOVERY_PROOF_PASS" if not commit else "V52_IDLE_OWNER_HOLD_RECOVERED",
        "signedObservations": proof,
        "activePendingCount": 0,
        "ordersSent": 0, "cancelsSent": 0, "positionChangesSent": 0,
    }
    if not commit:
        return result

    BACKUP_ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chown(BACKUP_ROOT, 0, 0)
    os.chmod(BACKUP_ROOT, 0o700)
    backup = BACKUP_ROOT / ("v52-idle-owner-hold-" + str(int(time.time() * 1000)) + ".json")
    with os.fdopen(os.open(backup, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600), "wb") as f:
        f.write(kill_raw); f.flush(); os.fsync(f.fileno())
    if backup.read_bytes() != kill_raw:
        raise ValueError("KILL_BACKUP_NOT_EXACT")

    recovered = dict(kill)
    recovered.update({
        "active": False,
        "recoverable": False,
        "operator": "V52_IDLE_RESIDUAL_OWNER_RECOVERY_V1",
        "previousReason": kill.get("reason"),
        "reason": "V52 IDLE owner-SHA hotfix active; flat state formally repaired; protected Aster venue stable; new entries may resume.",
        "recoveredAt": datetime.now(timezone.utc).isoformat(),
        "evidence": {
            "v52Sha": V52_SHA, "idleOwnerSha": IDLE_SHA,
            "signedReadOnlyGets": 3, "activePendingCount": 0,
            "stopContractDigest": proof[-1]["stopContractDigest"],
        },
        "ordersSent": 0, "cancelsSent": 0, "positionChangesSent": 0,
    })
    _atomic_kill(recovered, kill_st)
    try:
        _assert_runtime()
        post = _signed_get()
        if post["stopContractDigest"] != proof[-1]["stopContractDigest"]:
            raise ValueError("POST_CLEAR_STOP_CONTRACT_CHANGED")
        _, _, readback = _json(KILL)
        if readback.get("active") is not False:
            raise ValueError("KILL_SWITCH_CLEAR_READBACK_FAILED")
    except Exception as exc:
        rollback = dict(recovered)
        rollback.update({
            "active": True,
            "action": "HOLD_PROTECTED",
            "recoverable": False,
            "operator": "V52_IDLE_RESIDUAL_OWNER_RECOVERY_V1_POSTCHECK_FAIL",
            "reason": "Post-clear verification failed: " + str(exc)[:160],
        })
        _atomic_kill(rollback, kill_st)
        raise
    result["backupPath"] = str(backup)
    result["postClearObservation"] = post
    return result


def main() -> int:
    execute = "--execute-after-three-signed-gets" in sys.argv[1:]
    if len(sys.argv) != (2 if execute else 1):
        print(json.dumps({"status": "BLOCKED", "reason": "INVALID_ARGUMENTS"}), file=sys.stderr)
        return 2
    try:
        print(json.dumps(run(execute), sort_keys=True))
        return 0
    except Exception as exc:
        print(json.dumps({
            "status": "BLOCKED", "reason": str(exc)[:220],
            "ordersSent": 0, "cancelsSent": 0, "positionChangesSent": 0,
        }, sort_keys=True), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
