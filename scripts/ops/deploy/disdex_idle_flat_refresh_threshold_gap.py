#!/usr/bin/env python3
"""Close the IDLE flat-state freshness gap for whole-task HOLD recovery.

The existing flat-state repair refreshes only after 3 hours, but the exact HOLD
recovery requires the same state to be <=20 minutes old. This narrow migration
changes only that threshold to 15 minutes, preserving every existing safety
gate: IDLE stopped, flat schema/owner, HOLD active, V52 owner pin, three signed
Aster GETs, protected DOGE STOP, backup, atomic write, and zero order mutation.

No runner is started and no Kill Switch, order, position or STOP is changed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile

TARGET=Path("/usr/local/sbin/disdex-idle-residual-flat-stale-repair")
EXPECTED_SHA="2e60491b5328d1db7dd4e1556b799b7c09992ed350c1326f45d85429a2720221"
OLD=b'if time.time()*1000-state["updatedAt"] < 3*60*60*1000:'
NEW=b'if time.time()*1000-state["updatedAt"] < 15*60*1000:'
MARKER=b'IDLE_STATE_NOT_STALE'
IDLE_SHA="7688ed7c93a1918d8b44837339b7da5584a868f5"
V52_SHA="4d33d8244c0b50a7e461ffd8aaf493c32bfdfd81"
IDLE_UNIT=f"disdex-idle-priority-short@{IDLE_SHA}.service"
V52_UNIT=f"disdex-v52-aster-only@{V52_SHA}.service"
STATE=Path("/var/lib/disdex/idle-priority/residual-long-state.json")
HOLD=Path("/var/lib/disdex/shared/kill-switch.json")
BACKUPS=Path("/var/backups/disdex-idle-flat-refresh-threshold")


def require(ok: bool, reason: str):
    if not ok:
        raise RuntimeError(reason)


def unit(unit: str, prop: str) -> str:
    p=subprocess.run(["systemctl","show",unit,f"--property={prop}","--value"],
                     capture_output=True,text=True,timeout=15,check=True)
    return p.stdout.strip()


def state_contract() -> None:
    require(unit(IDLE_UNIT,"ActiveState")=="failed" and unit(IDLE_UNIT,"MainPID")=="0",
            "IDLE_OWNER_NOT_FAILED_PID0")
    require(unit(V52_UNIT,"ActiveState")=="active","V52_NOT_ACTIVE")
    ss=STATE.lstat()
    require(stat.S_ISREG(ss.st_mode) and not STATE.is_symlink() and
            ss.st_uid==1000 and ss.st_gid==1000 and stat.S_IMODE(ss.st_mode)==0o600,
            "IDLE_STATE_FILE_UNTRUSTED")
    state=json.loads(STATE.read_text())
    require(state.get("schema")=="disdex-idle-residual-long-state/v1" and
            state.get("runtimeSha")==IDLE_SHA,"IDLE_STATE_SCHEMA_OR_SHA_MISMATCH")
    require(all(state.get(k) is None for k in ("position","pending","manualReview")),
            "IDLE_STATE_NOT_FLAT")
    ks=HOLD.lstat()
    require(stat.S_ISREG(ks.st_mode) and not HOLD.is_symlink() and
            stat.S_IMODE(ks.st_mode)==0o600,"HOLD_FILE_UNTRUSTED")
    hold=json.loads(HOLD.read_text())
    require(hold.get("active") is True and hold.get("action")=="HOLD_PROTECTED",
            "HOLD_PROTECTED_REQUIRED")


def atomic_write(data: bytes, st: os.stat_result):
    fd,tmp=tempfile.mkstemp(dir=str(TARGET.parent),prefix=".idle-refresh-threshold-")
    try:
        with os.fdopen(fd,"wb") as f:
            os.fchmod(f.fileno(),stat.S_IMODE(st.st_mode))
            f.write(data);f.flush();os.fsync(f.fileno())
        os.chown(tmp,st.st_uid,st.st_gid)
        os.replace(tmp,TARGET)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)


def main(run_id: str):
    require(os.geteuid()==0,"ROOT_REQUIRED")
    require(run_id.isdecimal() and len(run_id)<21,"RUN_ID_INVALID")
    require(TARGET.is_file() and not TARGET.is_symlink(),"TARGET_NOT_REGULAR")
    st=TARGET.stat()
    require(st.st_uid==0 and not (st.st_mode & 0o022),"TARGET_PERMISSIONS_UNTRUSTED")
    old=TARGET.read_bytes()
    digest=hashlib.sha256(old).hexdigest()
    if digest==EXPECTED_SHA:
        require(old.count(OLD)==1 and old.count(NEW)==0,"OLD_THRESHOLD_NOT_UNIQUE")
        updated=old.replace(OLD,NEW,1)
        already=False
    else:
        require(old.count(NEW)==1 and old.count(OLD)==0,"PATCHED_THRESHOLD_NOT_UNIQUE")
        restored=old.replace(NEW,OLD,1)
        require(hashlib.sha256(restored).hexdigest()==EXPECTED_SHA,"TARGET_SOURCE_CHANGED")
        updated=old
        already=True
    require(updated.count(MARKER)>=1,"STALE_CONTRACT_MARKER_MISSING")
    compile(updated.decode("utf-8"),str(TARGET),"exec")
    state_contract()
    BACKUPS.mkdir(mode=0o700,parents=True,exist_ok=True)
    bst=BACKUPS.stat()
    require(bst.st_uid==0 and stat.S_IMODE(bst.st_mode)==0o700,"BACKUP_DIR_UNSAFE")
    backup=BACKUPS/f"idle-flat-repair-before-threshold-{run_id}.py"
    require(not backup.exists() and not backup.is_symlink(),"BACKUP_EXISTS")
    with backup.open("xb") as f:
        os.fchmod(f.fileno(),0o600);f.write(old);f.flush();os.fsync(f.fileno())
    require(backup.read_bytes()==old,"BACKUP_MISMATCH")
    try:
        if not already:
            require(TARGET.read_bytes()==old,"TARGET_CHANGED_DURING_PATCH")
            atomic_write(updated,st)
        require(TARGET.read_bytes()==updated,"PATCH_READBACK_FAILED")
        state_contract()
        # Read-only proof: patched threshold now permits the same existing
        # three-signed-GET verifier to prove readiness without refreshing state.
        proof=subprocess.run(["/usr/bin/python3",str(TARGET)],
                             capture_output=True,text=True,timeout=145)
        require(proof.returncode==0,"PATCHED_READONLY_PROOF_FAILED")
        rows=[line for line in proof.stdout.splitlines() if line.startswith("{")]
        require(rows,"PATCHED_READONLY_PROOF_MISSING")
        data=json.loads(rows[-1])
        require(data.get("status")=="READ_ONLY_PROOF_PASS_NO_CHANGE",
                "PATCHED_READONLY_STATUS_INVALID")
        require(all(data.get(k)==0 for k in ("ordersSent","cancelsSent","positionChangesSent")),
                "PATCHED_READONLY_MUTATION")
        state_contract()
    except Exception:
        if not already:
            atomic_write(old,st)
        print("IDLE_REFRESH_THRESHOLD_PATCH=ROLLBACK")
        raise
    print("IDLE_REFRESH_THRESHOLD_PATCH=SUCCESS")
    print("IDLE_REFRESH_THRESHOLD_MINUTES=15")
    print("HOLD_FRESHNESS_LIMIT_MINUTES=20")
    print("PATCHED_READONLY_THREE_SIGNED_GETS=PASS")
    print("ORDERS_SENT=0 CANCELS_SENT=0 POSITION_CHANGES=0 STOP_CHANGES=0")


if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--run-id",required=True)
    a=p.parse_args()
    main(a.run_id)
