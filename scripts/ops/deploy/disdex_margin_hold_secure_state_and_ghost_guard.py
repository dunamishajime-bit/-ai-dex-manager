#!/usr/bin/env python3
"""Exact non-order maintenance for secure Margin Guard writer and HOLD verifier parity.

Only recognizes 0660 for the known deploy-owned margin file inside its
owner-only (0700) directory. All other HOLD state remains 0600; all runtime
health and three venue proofs in the original recovery helper are unchanged.
Stop only the known disabled, broken duplicate guard; keep active owner guard.
No orders, cancels, position/STOP mutation, or Kill Switch modifications.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import runpy
import stat
import subprocess
import sys
import tempfile

SOURCE_SHA = "dcf703f00cbbb1fc428111a105d63a966b95e8defd2a7d87773586089c5243b0"
OWNER = "7688ed7c93a1918d8b44837339b7da5584a868f5"
V52 = "4d33d8244c0b50a7e461ffd8aaf493c32bfdfd81"
OLD_GUARD = f"disdex-v12-v52-margin-guard@{OWNER}.service"
BROKEN_GUARD = f"disdex-v12-v52-margin-guard@{V52}.service"
V52_UNIT = f"disdex-v52-aster-only@{V52}.service"
HOLD = Path("/var/lib/disdex/shared/kill-switch.json")
GUARD = Path("/var/lib/disdex/shared/margin-risk/guard-live.json")
TARGET = Path("/usr/local/sbin/disdex-idle-residual-kill-recovery")
BACKUPS = Path("/var/backups/disdex-margin-guard-recovery-contract")
NEW_FILE_MARKER = "MARGIN_SECURE_SHARED_OWNER_ONLY_V1"
OLD = '''    if not stat.S_ISREG(st.st_mode) or st.st_mode & 0o077:
        raise ValueError("UNTRUSTED_STATE_FILE:" + str(path))
'''
NEW = '''    if not stat.S_ISREG(st.st_mode):
        raise ValueError("UNTRUSTED_STATE_FILE:" + str(path))
    # MARGIN_SECURE_SHARED_OWNER_ONLY_V1
    # Guard writer uses 0660 in deploy's private 0700 directory. Only deploy
    # can traverse it, so group write grants no other user access.
    if path == MARGIN:
        parent = path.parent.lstat()
        if (not stat.S_ISDIR(parent.st_mode) or parent.st_uid != 1000
                or parent.st_gid != 1000 or stat.S_IMODE(parent.st_mode) != 0o700
                or st.st_uid != 1000 or st.st_gid != 1000
                or stat.S_IMODE(st.st_mode) not in (0o600, 0o660)):
            raise ValueError("UNTRUSTED_MARGIN_STATE_OWNER_OR_PRIVATE_DIR")
    elif st.st_mode & 0o077:
        raise ValueError("UNTRUSTED_STATE_FILE:" + str(path))
'''


def check(ok: bool, reason: str):
    if not ok:
        raise RuntimeError(reason)


def systemd(unit: str, key: str) -> str:
    p = subprocess.run(["systemctl", "show", unit, f"--property={key}", "--value"],
                       capture_output=True, text=True, timeout=14, check=True)
    return p.stdout.strip()


def prerequisites() -> tuple[bytes, os.stat_result]:
    check(os.geteuid() == 0, "ROOT_REQUIRED")
    check(systemd(OLD_GUARD, "ActiveState") == "active", "CANONICAL_MARGIN_GUARD_NOT_ACTIVE")
    check(systemd(V52_UNIT, "ActiveState") == "active", "NEW_V52_NOT_ACTIVE")
    check(systemd(BROKEN_GUARD, "UnitFileState") == "disabled", "BROKEN_GUARD_SHOULD_BE_DISABLED")
    missing = (Path("/home/deploy/disdex-trading/releases") / V52 /
               "scripts/disdex_v12_v52_margin_guard_runtime.py")
    check(not missing.exists() and not missing.is_symlink(), "BROKEN_GUARD_SCRIPT_NOW_EXISTS")
    for file in (TARGET, GUARD, HOLD):
        st = file.lstat()
        check(stat.S_ISREG(st.st_mode) and not file.is_symlink(), "UNTRUSTED_FILE:" + str(file))
    st = TARGET.stat()
    check(st.st_uid == 0 and (st.st_mode & 0o022) == 0, "RECOVERY_HELPER_UNTRUSTED")
    previous = TARGET.read_bytes()
    if hashlib.sha256(previous).hexdigest() == SOURCE_SHA:
        check(previous.count(OLD.encode()) == 1, "EXACT_OLD_SECURITY_CHECK_NOT_UNIQUE")
        check(NEW_FILE_MARKER.encode() not in previous, "UNEXPECTED_NEW_MARKER")
    else:
        check(previous.count(NEW.encode()) == 1, "PATCHED_SECURITY_CHECK_NOT_UNIQUE")
        check(hashlib.sha256(previous.replace(NEW.encode(), OLD.encode(), 1)).hexdigest()
              == SOURCE_SHA, "RECOVERY_HELPER_SOURCE_CHANGED")
        check(NEW_FILE_MARKER.encode() in previous, "NEW_MARKER_MISSING")
    # Observe exactly the private group-shared writer format.
    gs, ds = GUARD.stat(), GUARD.parent.lstat()
    check((gs.st_uid, gs.st_gid, stat.S_IMODE(gs.st_mode)) == (1000, 1000, 0o660),
          "MARGIN_FILE_NOT_EXACT_KNOWN_WRITER_MODE")
    check(stat.S_ISDIR(ds.st_mode) and
          (ds.st_uid, ds.st_gid, stat.S_IMODE(ds.st_mode)) == (1000, 1000, 0o700),
          "MARGIN_DIRECTORY_NOT_PRIVATE_DEPLOY")
    guard = json.loads(GUARD.read_bytes())
    check(guard.get("stage") == "HEALTHY" and guard.get("ordersAllowed") is True,
          "MARGIN_GUARD_NOT_HEALTHY")
    hold = json.loads(HOLD.read_bytes())
    check(hold.get("active") is True and hold.get("action") == "HOLD_PROTECTED",
          "UNEXPECTED_KILL_SWITCH")
    return previous, st


def atomic_update(data: bytes, st: os.stat_result):
    fd, path = tempfile.mkstemp(dir=str(TARGET.parent), prefix=".margin-recovery-parity-")
    try:
        with os.fdopen(fd, "wb") as writer:
            os.fchmod(writer.fileno(), stat.S_IMODE(st.st_mode))
            writer.write(data)
            writer.flush()
            os.fsync(writer.fileno())
        os.chown(path, st.st_uid, st.st_gid)
        os.replace(path, TARGET)
    finally:
        if os.path.exists(path):
            os.unlink(path)


def validate_proof():
    # runpy with a non-main module name runs definitions only. No kill release.
    module = runpy.run_path(str(TARGET), run_name="disdex_readonly_verifier")
    margin = module["_json"](GUARD)[2]
    check(margin.get("stage") == "HEALTHY" and margin.get("ordersAllowed") is True,
          "PATCHED_MARGIN_VERIFIER_NOT_HEALTHY")
    # Every other state still has the exact original strictly-private mode.
    for name in ("STATE", "KILL", "RISK", "PENDING"):
        module["_json"](module[name])
    check(systemd(OLD_GUARD, "ActiveState") == "active", "ACTIVE_CANONICAL_GUARD_CHANGED")
    check(systemd(V52_UNIT, "ActiveState") == "active", "V52_CHANGED")
    check(json.loads(HOLD.read_bytes()).get("active") is True, "HOLD_UNEXPECTEDLY_CLEARED")


def main(run_id: str):
    check(run_id.isdecimal() and len(run_id) < 21, "RUN_ID_INVALID")
    old, st = prerequisites()
    already_patched = NEW_FILE_MARKER.encode() in old
    updated = old if already_patched else old.replace(OLD.encode(), NEW.encode(), 1)
    compile(updated, str(TARGET), "exec")
    BACKUPS.mkdir(mode=0o700, parents=True, exist_ok=True)
    bst = BACKUPS.stat()
    check(bst.st_uid == 0 and stat.S_IMODE(bst.st_mode) == 0o700, "BACKUP_ROOT_NOT_SECURE")
    backup = BACKUPS / f"kill-recovery-before-margin-owner-{run_id}.py"
    check(not backup.exists() and not backup.is_symlink(), "BACKUP_EXISTS")
    with backup.open("xb") as writer:
        os.fchmod(writer.fileno(), 0o600)
        writer.write(old)
        writer.flush()
        os.fsync(writer.fileno())
    check(backup.read_bytes() == old, "BACKUP_BYTES_MISMATCH")
    try:
        check(TARGET.read_bytes() == old, "TARGET_CHANGED_BEFORE_PATCH")
        if not already_patched:
            atomic_update(updated, st)
        check(TARGET.read_bytes() == updated, "PATCH_READBACK_FAILED")
        validate_proof()
        # This unit is disabled, lacks its executable and is repeatedly
        # restarting. Stop it without touching the healthy canonical guard.
        subprocess.run(["systemctl", "stop", BROKEN_GUARD], check=True, timeout=65)
        check(systemd(BROKEN_GUARD, "ActiveState") not in ("active", "activating", "deactivating"),
              "BROKEN_GUARD_STILL_RUNNING")
        validate_proof()
    except Exception:
        if not already_patched:
            atomic_update(old, st)
        print("MARGIN_HOLD_CONTRACT_PATCH=ROLLBACK", file=sys.stderr)
        raise
    print("MARGIN_HOLD_CONTRACT_PATCH=SUCCESS")
    print("KNOWN_PRIVATE_MARGIN_0660=VERIFIED")
    print("CANONICAL_MARGIN_GUARD=ACTIVE")
    print("BROKEN_DUPLICATE_MARGIN_GUARD=STOPPED")
    print("KILL_SWITCH=HOLD_PROTECTED_UNCHANGED")
    print("ORDERS_SENT=0 CANCELS_SENT=0 POSITION_CHANGES=0 STOP_CHANGES=0")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    arguments = parser.parse_args()
    main(arguments.run_id)
