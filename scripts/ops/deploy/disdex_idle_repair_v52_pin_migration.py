#!/usr/bin/env python3
"""One-field, audited V52 owner SHA migration for the pre-existing IDLE repair helper.

Updates only the pinned V52 SHA in the already installed protected helper.
Never executes the mutating repair mode, sends orders, or clears the Kill Switch.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile

OLD="97830672e2f139b39f7194166d7dc8c36e8c8933"
NEW="4d33d8244c0b50a7e461ffd8aaf493c32bfdfd81"
OWNER="7688ed7c93a1918d8b44837339b7da5584a868f5"
EXPECTED_SOURCE_SHA256="ad84823335cd6355dc529f8e2a092e803fc23dd1fea13ff0a60ea5e465ac0ab5"
TARGET=Path("/usr/local/sbin/disdex-idle-residual-flat-stale-repair")
BACKUP_ROOT=Path("/var/backups/disdex-idle-v52-owner-pin-migration")
OLD_FRAGMENT=f'V52_SHA = "{OLD}"'.encode()
NEW_FRAGMENT=f'V52_SHA = "{NEW}"'.encode()

def require(ok, reason):
    if not ok: raise RuntimeError(reason)

def property(unit, key):
    p=subprocess.run(["/usr/bin/systemctl","show",unit,"--value","--property="+key],
                     check=True,capture_output=True,text=True,timeout=15)
    return p.stdout.strip()

def validate_venue_owner():
    old=f"disdex-v52-aster-only@{OLD}.service"
    new=f"disdex-v52-aster-only@{NEW}.service"
    idle=f"disdex-idle-priority-short@{OWNER}.service"
    require(property(old,"ActiveState")!="active","OLD_V52_STILL_ACTIVE")
    require(property(new,"ActiveState")=="active","NEW_V52_NOT_ACTIVE")
    require(property(idle,"ActiveState")=="failed","IDLE_EXPECTED_FAILED_STATE_CHANGED")
    pid=int(property(new,"MainPID"))
    require(pid>100 and Path(f"/proc/{pid}/environ").is_file(),"NEW_V52_PID_INVALID")
    env=dict(x.split(b"=",1) for x in Path(f"/proc/{pid}/environ").read_bytes().split(b"\0") if b"=" in x)
    require(env.get(b"DISDEX_IDLE_PRIORITY_RUNTIME_SHA")==OWNER.encode(),"NEW_V52_IDLE_OWNER_SHA_NOT_PINNED")
    require(Path("/etc/disdex/current-runtime/v52-current.env").read_text().count("DISDEX_V52_RUNTIME_SHA="+NEW)==1,
            "V52_RELEASE_PIN_NOT_UPDATED")
    kill=json.loads(Path("/var/lib/disdex/shared/kill-switch.json").read_text())
    require(kill.get("active") is True and kill.get("action")=="HOLD_PROTECTED","PROTECTED_HOLD_NOT_ACTIVE")

def atomic_replace(value, st):
    fd,name=tempfile.mkstemp(dir=str(TARGET.parent),prefix=".disdex-idle-v52-owner-")
    try:
        with os.fdopen(fd,"wb") as file:
            os.fchmod(file.fileno(),stat.S_IMODE(st.st_mode))
            file.write(value);file.flush();os.fsync(file.fileno())
        os.chown(name,st.st_uid,st.st_gid)
        os.replace(name,TARGET)
    finally:
        if os.path.exists(name):os.unlink(name)

def main(run_id):
    require(os.geteuid()==0,"ROOT_REQUIRED")
    require(re.fullmatch(r"[0-9]{1,20}",run_id) is not None,"RUN_ID_INVALID")
    require(TARGET.is_file() and not TARGET.is_symlink(),"PROTECTED_SCRIPT_NOT_REGULAR")
    st=TARGET.stat()
    require(st.st_uid==0 and not st.st_mode & 0o022,"PROTECTED_SCRIPT_UNTRUSTED")
    old=TARGET.read_bytes()
    require(hashlib.sha256(old).hexdigest()==EXPECTED_SOURCE_SHA256,"PROTECTED_SCRIPT_UNEXPECTED_SHA256")
    require(old.count(OLD_FRAGMENT)==1,"OLD_SHA_LITERAL_NOT_UNIQUE")
    require(NEW_FRAGMENT not in old,"NEW_SHA_ALREADY_PRESENT_UNEXPECTED")
    updated=old.replace(OLD_FRAGMENT,NEW_FRAGMENT,1)
    compile(updated.decode("utf-8"),str(TARGET),"exec")
    validate_venue_owner()
    BACKUP_ROOT.mkdir(mode=0o700,parents=True,exist_ok=True)
    bs=BACKUP_ROOT.stat()
    require(bs.st_uid==0 and not bs.st_mode & 0o077,"BACKUP_ROOT_PERMISSIONS_UNSAFE")
    backup=BACKUP_ROOT/("idle-repair-before-v52-sha-"+run_id+".py")
    require(not backup.exists() and not backup.is_symlink(),"BACKUP_ALREADY_EXISTS")
    with backup.open("xb") as f:
        os.fchmod(f.fileno(),0o600)
        f.write(old);f.flush();os.fsync(f.fileno())
    require(backup.read_bytes()==old,"BACKUP_NOT_EXACT")
    try:
        require(TARGET.read_bytes()==old,"PROTECTED_SCRIPT_CHANGED_BEFORE_UPDATE")
        atomic_replace(updated,st)
        require(TARGET.read_bytes()==updated,"PROTECTED_SCRIPT_READBACK_MISMATCH")
        validate_venue_owner()
        # Critically, NO --execute flag is passed: this is read-only, three Aster GETs.
        proof=subprocess.run(["/usr/bin/python3",str(TARGET)],text=True,capture_output=True,timeout=140)
        require(proof.returncode==0,"UPDATED_HELPER_READONLY_PROOF_FAILED")
        rows=[s for s in proof.stdout.splitlines() if s.startswith("{")]
        require(bool(rows),"UPDATED_HELPER_PROOF_MISSING")
        d=json.loads(rows[-1])
        require(d.get("status")=="READ_ONLY_PROOF_PASS_NO_CHANGE","UPDATED_HELPER_NOT_READONLY_PASS")
        require(all(d.get(k)==0 for k in ("ordersSent","cancelsSent","positionChangesSent")),
                "UPDATED_HELPER_ORDER_MUTATION")
        validate_venue_owner()
        print("IDLE_V52_PIN_MIGRATION=SUCCESS")
        print("IDLE_REPAIR_NEW_OWNER_V52_SHA="+NEW)
        print("PROOF=THREE_SIGNED_GETS_PASS_NO_CHANGE")
        print("ORDERS_SENT=0 CANCELS_SENT=0 POSITION_CHANGES=0")
    except Exception:
        atomic_replace(old,st)
        print("IDLE_V52_PIN_MIGRATION=ROLLBACK_COMPLETED",flush=True)
        raise

if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--run-id",required=True)
    a=p.parse_args()
    main(a.run_id)
