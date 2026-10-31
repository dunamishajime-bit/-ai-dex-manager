#!/usr/bin/env python3
"""Owner-reviewed, single-target V52 hotfix switch. No test orders or risk override.

This procedure switches ONLY the two exact V52 service identities while the
shared Kill Switch is already active. It never clears HOLD or touches STOPs.
All failures after stopping old V52 attempt immediate rollback of the pin
and old service. Run via reviewed GitHub Action, never a cron/scheduled job.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import time

PROD = "7688ed7c93a1918d8b44837339b7da5584a868f5"
OLD = "97830672e2f139b39f7194166d7dc8c36e8c8933"
NEW = "4d33d8244c0b50a7e461ffd8aaf493c32bfdfd81"
V4 = "53a0be396719f0284af4e11b35c66a4ac7d58f79"
STOP = "v12-v4-98ded39746ed3502a4d7b0e26ef9"
BASE = Path("/home/deploy/disdex-trading/releases")
OLD_UNIT = f"disdex-v52-aster-only@{OLD}.service"
NEW_UNIT = f"disdex-v52-aster-only@{NEW}.service"
PIN = Path("/etc/disdex/current-runtime/v52-current.env")
APPROVAL = Path(f"/var/lib/disdex/shared/operator-activation/v52-{NEW}.json")
KILL = Path("/var/lib/disdex/shared/kill-switch.json")
RISK = Path("/var/lib/disdex/shared/crypto-daily-risk.json")
MARGIN = Path("/var/lib/disdex/shared/margin-risk/guard-live.json")
PENDING = Path("/var/lib/disdex/shared/pending-exposure.json")
BACKUP_DIR = Path("/var/backups/disdex-v52-owner-approved-cutover")
ACTIVATION = BASE / NEW / "scripts/ops/root/disdex-live-operator-activation-gate.mjs"
GUARD = BASE / NEW / "scripts/ops/root/disdex-fet-preemption-readiness-guard.py"

def run(*argv: str, timeout: int = 35) -> str:
    process = subprocess.run(argv, text=True, capture_output=True, timeout=timeout)
    if process.returncode:
        raise RuntimeError(f"COMMAND_FAILED:{argv[0]}:{process.returncode}")
    return process.stdout.strip()

def unit_property(unit: str, key: str) -> str:
    return run("systemctl", "show", unit, f"--property={key}", "--value")

def service_active(unit: str) -> bool:
    return unit_property(unit, "ActiveState") == "active"

def is_enabled(unit: str) -> bool:
    p = subprocess.run(["systemctl", "is-enabled", unit], capture_output=True, text=True, timeout=12)
    require(p.returncode in (0, 1) and p.stdout.strip() in ("enabled", "disabled", "indirect", "static"),
            "SERVICE_ENABLED_STATE_UNAVAILABLE")
    return p.stdout.strip() == "enabled"

def require(cond: bool, message: str) -> None:
    if not cond:
        raise RuntimeError(message)

def read_json(p: Path) -> dict:
    require(p.is_file() and not p.is_symlink(), "STATE_FILE_MISSING_OR_LINK:" + p.name)
    data = json.loads(p.read_text())
    require(isinstance(data, dict), "STATE_JSON_NOT_OBJECT:" + p.name)
    return data

def risk_snapshot() -> None:
    require(os.geteuid() == 0, "ROOT_REQUIRED")
    require((BASE / PROD / ".disdex-release-sha").read_text().strip() == PROD, "PRODUCTION_RELEASE_INVALID")
    require(Path("/home/deploy/disdex-trading/current/.disdex-release-sha").read_text().strip() == PROD, "PRODUCTION_SHA_CHANGED")
    require((BASE / NEW / ".disdex-release-sha").read_text().strip() == NEW, "HOTFIX_RELEASE_SHA_INVALID")
    kill = read_json(KILL)
    require(kill.get("active") is True and kill.get("action") == "HOLD_PROTECTED", "SHARED_HOLD_MUST_BE_ACTIVE")
    require(kill.get("recoverable") is True and "IDLE_RESIDUAL_STATE_RUNTIME_OR_SCHEMA_MISMATCH" in str(kill.get("reason")), "UNEXPECTED_HOLD_REASON")
    risk = read_json(RISK)
    require(risk.get("sourceComplete") is True and risk.get("tripped") is False, "SHARED_RISK_NOT_HEALTHY")
    margin = read_json(MARGIN)
    require(margin.get("stage") == "HEALTHY" and margin.get("ordersAllowed") is True, "MARGIN_GUARD_NOT_HEALTHY")
    checked = int(margin.get("checkedAt") or 0)
    now = int(time.time() * 1000)
    require(0 <= now - checked < 15 * 60000, "MARGIN_GUARD_STALE")
    pending = read_json(PENDING)
    require(isinstance(pending.get("entries"), list) and not any(
        x.get("status") != "RELEASED" for x in pending["entries"]), "PENDING_EXPOSURE_ACTIVE")
    activation = read_json(APPROVAL)
    require(activation.get("approvedSha") == NEW and activation.get("ordersEnabled") is True
            and activation.get("operatorAcknowledgement") == "I_ACK_REAL_MONEY_LIVE_ACTIVATION"
            and activation.get("fetCorePreemptionReady") is True
            and {"V52", "FET_BRK48_RESIDUAL"}.issubset(activation.get("approvedRunners", [])),
            "OWNER_ACTIVATION_ARTIFACT_MISMATCH")
    result = json.loads(run("/usr/bin/node", str(ACTIVATION), "--release-root", str(BASE / NEW),
                          "--sha", NEW, "--runner", "V52", "--activation-path", str(APPROVAL)))
    require(result.get("status") == "OPERATOR_ACTIVATION_READY" and result.get("allowed") is True,
            "EXACT_OPERATOR_CERTIFICATION_BLOCKED")

    # Equivalent to systemd's prestart environment inputs, never load them as shell commands.
    flags = {}
    for file in (Path(f"/etc/disdex/current-runtime/{PROD}.env"),
                 Path(f"/etc/disdex/current-runtime/{NEW}-v52-overrides.env")):
        require(file.is_file() and not file.is_symlink(), "DURABLE_RUNTIME_ENV_MISSING")
        for line in file.read_text().splitlines():
            if "=" in line:
                k, v = line.split("=", 1)
                if k in ("DISDEX_RUNTIME_COMMIT_SHA", "FET_BRK48_CORE_PREEMPTION_READY"):
                    flags[k] = v.strip()
    env = dict(os.environ, **flags)
    proc = subprocess.run(["/usr/bin/python3", str(GUARD), "--prestart", "--sha", NEW,
                           "--activation-path", str(APPROVAL)], capture_output=True,
                          text=True, env=env, timeout=25)
    require(proc.returncode == 0 and json.loads(proc.stdout).get("status") == "HEALTHY",
            "V52_FET_PRESTART_BLOCKED")

def venue_get() -> str:
    # Three per deployment to protect the existing real DOGE short.
    expression = (
        "set -ae; for f in /etc/disdex/disdex-v13d-v11eq-v96.env "
        "/etc/disdex/disdex-v12-pengu-v2-v52.env /etc/disdex/disdex-v12-v4.env; "
        "do . \"$f\"; done; set +a; exec /usr/bin/node "
        + str(BASE / V4 / "node_modules/tsx/dist/cli.mjs")
        + " scripts/disdex-aster-readonly-account-diagnostic.ts"
    )
    p = subprocess.run(["/bin/bash", "-c", expression], cwd=BASE / V4,
                       text=True, capture_output=True, timeout=55)
    require(p.returncode == 0, "SIGNED_ASTER_GET_FAILED")
    rows = [s for s in p.stdout.splitlines() if s.startswith("{")]
    require(bool(rows), "SIGNED_ASTER_GET_EMPTY")
    d = json.loads(rows[-1])
    require(d.get("status") == "ASTER_READONLY_ACCOUNT_DIAGNOSTIC_PASS", "SIGNED_ASTER_STATUS_NOT_PASS")
    require(all(d.get(k) == 0 for k in ("ordersSent", "cancelsSent", "positionChangesSent")), "SIGNED_GET_NOT_READONLY")
    pp, oo = d.get("positions") or [], d.get("openOrders") or []
    require(len(pp) == 1 and len(oo) == 1, "VENUE_UNEXPECTED_POSITIONS_OR_ORDERS")
    p, s = pp[0], oo[0]
    require(p.get("symbol") == "DOGEUSDT" and float(p.get("positionAmt")) == -226.0
            and float(p.get("entryPrice")) == .08052, "RESIDENT_DOGE_POSITION_MISMATCH")
    require(s.get("symbol") == "DOGEUSDT" and s.get("clientOrderId") == STOP
            and s.get("side") == "BUY" and s.get("type") == "STOP_MARKET"
            and float(s.get("origQty")) == 226.0 and float(s.get("executedQty")) == 0.0
            and s.get("reduceOnly") is True and s.get("status") == "NEW",
            "RESIDENT_DOGE_STOP_MISMATCH")
    return str(d.get("observedAt"))

def pinned() -> tuple[bytes, int, int, int]:
    require(PIN.is_file() and not PIN.is_symlink(), "V52_PIN_NOT_REGULAR_FILE")
    st = PIN.stat()
    require(st.st_uid == 0 and st.st_mode & 0o022 == 0, "V52_PIN_PERMISSIONS_INVALID")
    data = PIN.read_bytes()
    lines = data.decode("utf-8").splitlines()
    require(lines.count(f"DISDEX_V52_RUNTIME_SHA={OLD}") == 1, "OLD_V52_SHA_PIN_CHANGED")
    require(lines.count(f"DISDEX_V52_RUNTIME_ROOT={BASE / OLD}") == 1, "OLD_V52_ROOT_PIN_CHANGED")
    require(sum(x.startswith("DISDEX_V52_RUNTIME_SHA=") for x in lines) == 1
            and sum(x.startswith("DISDEX_V52_RUNTIME_ROOT=") for x in lines) == 1,
            "V52_PIN_DUPLICATE_KEYS")
    return data, st.st_uid, st.st_gid, stat.S_IMODE(st.st_mode)

def atomic_pin(data: bytes, uid: int, gid: int, mode: int) -> None:
    fd, tmp = tempfile.mkstemp(dir=PIN.parent, prefix=".v52-approved-cutover-")
    try:
        with os.fdopen(fd, "wb") as f:
            os.fchmod(f.fileno(), mode)
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.chown(tmp, uid, gid)
        os.replace(tmp, PIN)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)

def new_pin(old: bytes) -> bytes:
    text = old.decode("utf-8")
    text = text.replace(f"DISDEX_V52_RUNTIME_SHA={OLD}", f"DISDEX_V52_RUNTIME_SHA={NEW}")
    text = text.replace(f"DISDEX_V52_RUNTIME_ROOT={BASE / OLD}", f"DISDEX_V52_RUNTIME_ROOT={BASE / NEW}")
    return text.encode()

def all_preflight() -> tuple[bytes,int,int,int]:
    risk_snapshot()
    require(service_active(OLD_UNIT) and not service_active(NEW_UNIT), "EXPECTED_OLD_ONLY_V52_RUNNING")
    pid = int(unit_property(OLD_UNIT, "MainPID"))
    require(pid > 100, "OLD_V52_MAINPID_INVALID")
    require(os.path.realpath(f"/proc/{pid}/cwd") == str(BASE / OLD), "OLD_V52_RELEASE_CWD_MISMATCH")
    pin = pinned()
    observations = [venue_get() for _ in range(3)]
    require(len(set(observations)) == 3, "SIGNED_ASTER_GET_TIMESTAMPS_NOT_INCREASING")
    risk_snapshot()
    print("V52_HOTFIX_SAFE_PREFLIGHT=PASS",flush=True)
    print("VENUE_SIGNED_GETS=3",flush=True)
    print("OLD_V52_ONLY=TRUE",flush=True)
    print("ORDERS_SENT=0 CANCELS_SENT=0 POSITION_CHANGES=0",flush=True)
    return pin

def wait_unit(unit: str, cwd: str, secs: int = 65) -> None:
    deadline = time.monotonic() + secs
    while time.monotonic() < deadline:
        if service_active(unit):
            pid = int(unit_property(unit, "MainPID") or "0")
            if pid > 100 and os.path.realpath(f"/proc/{pid}/cwd") == cwd:
                time.sleep(3)
                if service_active(unit) and int(unit_property(unit, "MainPID")) == pid:
                    return
        time.sleep(2)
    raise RuntimeError("NEW_V52_NOT_STABLE")

def execute(run_id: str) -> None:
    require(re.fullmatch(r"[0-9]{1,20}", run_id) is not None,"RUN_ID_INVALID")
    old, uid, gid, mode = all_preflight()
    BACKUP_DIR.mkdir(mode=0o700,parents=True,exist_ok=True)
    st = BACKUP_DIR.stat()
    require(st.st_uid == 0 and st.st_mode & 0o077 == 0, "BACKUP_DIR_UNSAFE")
    backup = BACKUP_DIR / f"v52-pin-before-{run_id}.env"
    require(not backup.exists() and not backup.is_symlink(), "BACKUP_ALREADY_EXISTS")
    with backup.open("xb") as f:
        os.fchmod(f.fileno(),0o600)
        f.write(old)
        f.flush()
        os.fsync(f.fileno())
    require(backup.read_bytes()==old, "PIN_BACKUP_NOT_EXACT")

    switched = False
    old_enabled = is_enabled(OLD_UNIT)
    new_enabled = is_enabled(NEW_UNIT)
    try:
        # Production remains HOLD_PROTECTED for the entire V52 switch.
        require(PIN.read_bytes() == old, "PIN_CHANGED_BEFORE_CUTOVER")
        run("systemctl","stop",OLD_UNIT,timeout=90)
        require(not service_active(OLD_UNIT), "OLD_V52_STILL_ACTIVE")
        atomic_pin(new_pin(old),uid,gid,mode)
        switched = True
        run("systemctl","start",NEW_UNIT,timeout=100)
        wait_unit(NEW_UNIT,str(BASE/NEW))
        require(not service_active(OLD_UNIT),"DUAL_V52_OWNER")
        risk_snapshot()
        venue_get()
        require(PIN.read_bytes() == new_pin(old),"PIN_CHANGED_AFTER_CUTOVER")
        if old_enabled: run("systemctl","disable",OLD_UNIT)
        if not new_enabled: run("systemctl","enable",NEW_UNIT)
        require(service_active(NEW_UNIT) and not service_active(OLD_UNIT),"V52_FINAL_SERVICE_MISMATCH")
        require(read_json(KILL).get("active") is True,"KILL_SWITCH_UNEXPECTEDLY_CLEARED")
        print("V52_HOTFIX_CUTOVER=SUCCESS")
        print(f"V52_ACTIVE_SHA={NEW}")
        print("OLD_V52_ACTIVE=FALSE SHARED_HOLD_PRESERVED=TRUE")
        print("SIGNED_POSTCUTOVER_VENUE_PROOF=PASS ORDERS_SENT=0 CANCELS_SENT=0")
    except Exception as err:
        print("V52_HOTFIX_CUTOVER=BLOCKED_ROLLBACK_START",file=sys.stderr)
        try:
            run("systemctl","stop",NEW_UNIT,timeout=80)
            if switched: atomic_pin(old,uid,gid,mode)
            if old_enabled: run("systemctl","enable",OLD_UNIT)
            if not new_enabled: run("systemctl","disable",NEW_UNIT)
            if not service_active(OLD_UNIT): run("systemctl","start",OLD_UNIT,timeout=95)
            wait_unit(OLD_UNIT,str(BASE/OLD),secs=45)
            require(PIN.read_bytes() == old, "ROLLBACK_PIN_MISMATCH")
            require(read_json(KILL).get("active") is True,"KILL_SWITCH_NOT_PROTECTED_AFTER_ROLLBACK")
            print("V52_HOTFIX_ROLLBACK=SUCCESS",file=sys.stderr)
        except Exception as rollback_err:
            print(f"V52_HOTFIX_ROLLBACK=FAILED:{type(rollback_err).__name__}:{str(rollback_err)[:120]}",file=sys.stderr)
        raise RuntimeError("V52_CUTOVER_BLOCKED:" + str(err)[:150]) from err

def main() -> int:
    parser=argparse.ArgumentParser()
    group=parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--preflight-readonly",action="store_true")
    group.add_argument("--execute-approved",action="store_true")
    parser.add_argument("--github-run-id")
    args=parser.parse_args()
    try:
        if args.preflight_readonly: all_preflight()
        else: execute(args.github_run_id or "")
        return 0
    except Exception as e:
        print("V52_HOTFIX_BLOCKED:" + type(e).__name__ + ":" + str(e)[:185],file=sys.stderr)
        return 1

if __name__=="__main__":
    sys.exit(main())
