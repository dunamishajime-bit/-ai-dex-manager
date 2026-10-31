#!/usr/bin/env python3
"""Repair only V52's systemd dependency graph for the approved 4d33 hotfix.

The generic template requires a margin guard with the same instance SHA. That
guard does not exist in the 4d33 release, while the approved V52 hotfix is
explicitly pinned to the canonical 7688 margin guard. A drop-in cannot reliably
remove the template Requires dependency, so this installs one exact instance
unit with the canonical dependency only.

No venue, order, position, STOP, Kill Switch, or trading state mutation occurs.
HOLD_PROTECTED must remain active throughout. On failure, the exact instance
unit is removed and systemd is reloaded, returning to the prior template graph.
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
import time

V52="4d33d8244c0b50a7e461ffd8aaf493c32bfdfd81"
CANON="7688ed7c93a1918d8b44837339b7da5584a868f5"
TEMPLATE=Path("/etc/systemd/system/disdex-v52-aster-only@.service")
INSTANCE=Path(f"/etc/systemd/system/disdex-v52-aster-only@{V52}.service")
TEMPLATE_SHA="1e8a2707e5835b77be8374f8b8b3d615dc1de754543cd36efca85ff1cdc5a45a"
DROPIN=Path(f"/etc/systemd/system/disdex-v52-aster-only@{V52}.service.d/zzzzzzzzzzzzzzzz-v52-hotfix-4d33.conf")
DROPIN_SHA="5bf45aabafc6ed290cada5d1d380412e75a71952fd362a90255401d7ab729938"
V52_UNIT=f"disdex-v52-aster-only@{V52}.service"
BAD_GUARD=f"disdex-v12-v52-margin-guard@{V52}.service"
GOOD_GUARD=f"disdex-v12-v52-margin-guard@{CANON}.service"
HOLD=Path("/var/lib/disdex/shared/kill-switch.json")
BACKUP=Path("/var/backups/disdex-v52-instance-dependency")
UNIT=f"""[Unit]
Description=DisDex V52 Aster-only LIVE runner for V12 composition ({V52})
After=network-online.target disdex-stock-reference-free.service {GOOD_GUARD}
Wants=network-online.target
Requires=disdex-stock-reference-free.service {GOOD_GUARD}

[Service]
Type=simple
User=deploy
Group=deploy
WorkingDirectory=/home/deploy/disdex-trading/releases/{V52}
EnvironmentFile=/etc/disdex/disdex-v13d-v11eq-v96.env
EnvironmentFile=/etc/disdex/disdex-v12-pengu-v2-v52.env
Environment=NODE_ENV=production
Environment=PYTHONPATH=/home/deploy/dis-dex-manager/.venv-stock/lib/python3.12/site-packages
ExecStartPre=/usr/bin/test -f /home/deploy/disdex-trading/releases/{V52}/.disdex-release-sha
ExecStartPre=/usr/bin/grep -Fxq {V52} /home/deploy/disdex-trading/releases/{V52}/.disdex-release-sha
ExecStart=/usr/bin/python3 scripts/disdex_v12_v52_live_engine.py --mode live --daemon
Restart=on-failure
RestartSec=15s
TimeoutStopSec=90s
KillSignal=SIGTERM
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=read-only
ReadOnlyPaths=/home/deploy/disdex-trading/releases
ReadWritePaths=/home/deploy/ai-dex-manager-v96-paper/.runtime-state /var/lib/disdex/shared
UMask=0077

[Install]
WantedBy=multi-user.target
""".encode()


def require(ok: bool, reason: str) -> None:
    if not ok:
        raise RuntimeError(reason)


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def state(unit: str, key: str) -> str:
    p=subprocess.run(["systemctl","show",unit,f"--property={key}","--value"],
                     capture_output=True,text=True,timeout=15,check=True)
    return p.stdout.strip()


def current_hold() -> dict:
    st=HOLD.lstat()
    require(stat.S_ISREG(st.st_mode) and not HOLD.is_symlink() and not (st.st_mode & 0o077),
            "HOLD_FILE_UNTRUSTED")
    value=json.loads(HOLD.read_text())
    require(value.get("active") is True and value.get("action")=="HOLD_PROTECTED",
            "HOLD_PROTECTED_REQUIRED")
    return value


def unit_dependencies() -> set[str]:
    raw=state(V52_UNIT,"Requires")
    return set(x.strip('"') for x in raw.split() if x)


def validate_static() -> None:
    require(os.geteuid()==0,"ROOT_REQUIRED")
    require(TEMPLATE.is_file() and not TEMPLATE.is_symlink() and sha(TEMPLATE)==TEMPLATE_SHA,
            "V52_TEMPLATE_CHANGED")
    require(DROPIN.is_file() and not DROPIN.is_symlink() and sha(DROPIN)==DROPIN_SHA,
            "V52_HOTFIX_DROPIN_CHANGED")
    if INSTANCE.exists() or INSTANCE.is_symlink():
        require(INSTANCE.is_file() and not INSTANCE.is_symlink(), "EXISTING_INSTANCE_NOT_REGULAR")
        ist=INSTANCE.stat()
        require(ist.st_uid==0 and ist.st_gid==0 and stat.S_IMODE(ist.st_mode)==0o644,
                "EXISTING_INSTANCE_PERMISSIONS_UNTRUSTED")
        require(INSTANCE.read_bytes()==UNIT, "EXISTING_INSTANCE_CONTENT_MISMATCH")
    require(state(GOOD_GUARD,"ActiveState")=="active","CANONICAL_MARGIN_GUARD_NOT_ACTIVE")
    require(state(BAD_GUARD,"UnitFileState")=="disabled","BAD_MARGIN_GUARD_NOT_DISABLED")
    current_hold()
    # Verify exact candidate syntax before touching /etc.
    fd,tmp=tempfile.mkstemp(suffix=".service")
    try:
        with os.fdopen(fd,"wb") as f:
            f.write(UNIT);f.flush();os.fsync(f.fileno())
        check=subprocess.run(["systemd-analyze","verify",tmp],capture_output=True,text=True,timeout=30)
        require(check.returncode==0,"SYSTEMD_UNIT_VERIFY_FAILED")
    finally:
        if os.path.exists(tmp):os.unlink(tmp)


def write_instance() -> None:
    fd,tmp=tempfile.mkstemp(dir=str(INSTANCE.parent),prefix=".v52-instance-",suffix=".service")
    try:
        with os.fdopen(fd,"wb") as f:
            os.fchmod(f.fileno(),0o644)
            f.write(UNIT);f.flush();os.fsync(f.fileno())
        os.chown(tmp,0,0)
        os.replace(tmp,INSTANCE)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)


def wait_active(seconds: int=55) -> int:
    deadline=time.monotonic()+seconds
    last_pid=0
    stable_since=None
    while time.monotonic()<deadline:
        active=state(V52_UNIT,"ActiveState")
        pid=int(state(V52_UNIT,"MainPID") or "0")
        if active=="active" and pid>100:
            if pid!=last_pid:
                last_pid=pid;stable_since=time.monotonic()
            if stable_since and time.monotonic()-stable_since>=35:
                return pid
        else:
            stable_since=None
        time.sleep(2)
    raise RuntimeError("V52_NOT_STABLE_35_SECONDS")


def validate_live() -> None:
    deps=unit_dependencies()
    require(GOOD_GUARD in deps,"CANONICAL_MARGIN_DEPENDENCY_MISSING")
    require(BAD_GUARD not in deps,"BROKEN_MARGIN_DEPENDENCY_STILL_PRESENT")
    require(state(BAD_GUARD,"ActiveState") not in ("active","activating","deactivating"),
            "BROKEN_MARGIN_GUARD_RUNNING")
    require(state(GOOD_GUARD,"ActiveState")=="active","CANONICAL_MARGIN_GUARD_CHANGED")
    pid=wait_active()
    require(os.path.realpath(f"/proc/{pid}/cwd")==f"/home/deploy/disdex-trading/releases/{V52}",
            "V52_CWD_MISMATCH")
    env={}
    for pair in Path(f"/proc/{pid}/environ").read_bytes().split(b"\0"):
        if b"=" in pair:
            k,v=pair.split(b"=",1);env[k.decode(errors="ignore")]=v.decode(errors="ignore")
    require(env.get("DISDEX_RUNTIME_COMMIT_SHA")==V52,"V52_RUNTIME_SHA_MISMATCH")
    require(env.get("DISDEX_IDLE_PRIORITY_RUNTIME_SHA")==CANON,"V52_IDLE_OWNER_MISMATCH")
    current_hold()


def main(run_id: str) -> None:
    require(run_id.isdecimal() and len(run_id)<21,"RUN_ID_INVALID")
    validate_static()
    BACKUP.mkdir(mode=0o700,parents=True,exist_ok=True)
    bst=BACKUP.stat()
    require(bst.st_uid==0 and stat.S_IMODE(bst.st_mode)==0o700,"BACKUP_DIR_UNSAFE")
    instance_preexisting = INSTANCE.exists()
    marker=BACKUP/f"instance-before-{run_id}.json"
    require(not marker.exists() and not marker.is_symlink(),"BACKUP_MARKER_EXISTS")
    marker.write_text(json.dumps({
        "instanceExisted":instance_preexisting,
        "templateSha256":TEMPLATE_SHA,
        "dropinSha256":DROPIN_SHA,
        "v52Unit":V52_UNIT,
    },sort_keys=True)+"\n")
    os.chmod(marker,0o600)
    try:
        if not instance_preexisting:
            write_instance()
        require(INSTANCE.read_bytes()==UNIT,"INSTANCE_READBACK_MISMATCH")
        subprocess.run(["systemctl","daemon-reload"],check=True,timeout=30)
        # Bad dependency unit must stay stopped. Starting V52 will use only the
        # canonical guard after the exact instance unit overrides the template.
        subprocess.run(["systemctl","stop",BAD_GUARD],check=True,timeout=55)
        subprocess.run(["systemctl","start",V52_UNIT],check=True,timeout=100)
        validate_live()
    except Exception:
        subprocess.run(["systemctl","stop",V52_UNIT],check=False,timeout=90)
        if not instance_preexisting and INSTANCE.exists() and not INSTANCE.is_symlink():
            INSTANCE.unlink()
        subprocess.run(["systemctl","daemon-reload"],check=False,timeout=30)
        if instance_preexisting and INSTANCE.is_file() and not INSTANCE.is_symlink() and INSTANCE.read_bytes()==UNIT:
            subprocess.run(["systemctl","start",V52_UNIT],check=False,timeout=100)
        print("V52_INSTANCE_DEPENDENCY_REPAIR=ROLLBACK",flush=True)
        raise
    print("V52_INSTANCE_DEPENDENCY_REPAIR=ALREADY_APPLIED_VERIFIED" if instance_preexisting
          else "V52_INSTANCE_DEPENDENCY_REPAIR=SUCCESS")
    print("V52_CANONICAL_MARGIN_REQUIRES=TRUE")
    print("V52_BROKEN_MARGIN_REQUIRES=FALSE")
    print("V52_STABLE_35_SECONDS=TRUE")
    print("HOLD_PROTECTED_UNCHANGED=TRUE")
    print("ORDERS_SENT=0 CANCELS_SENT=0 POSITION_CHANGES=0 STOP_CHANGES=0")


if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--run-id",required=True)
    a=p.parse_args()
    main(a.run_id)
