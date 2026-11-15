#!/usr/bin/env python3
"""Authenticate root SSH and restore ONLY a journaled no-order upgrade.

This intentionally runs before the generic deployment health gate. It cannot
issue approvals, change runner pins, place orders or grant trading authority.
"""
import fcntl
import json
import os
from pathlib import Path
import stat
import subprocess
from types import SimpleNamespace

def main():
    from disdex_unified_root_gate import assert_codex_ssh_session,release_marker
    import disdex_pending_maintenance_install as maintenance
    from disdex_pending_composite_upgrade import NEW,validate_source_files,recover_incomplete_upgrade
    if os.geteuid()!=0:raise ValueError('PENDING_COMPOSITE_RECOVERY_ROOT_REQUIRED')
    assert_codex_ssh_session()
    root=Path('/var/lib/disdex/unified-deploy');lock=root/'deployment-execution.lock'
    info=lock.lstat()
    if not stat.S_ISREG(info.st_mode) or lock.is_symlink() or info.st_uid!=0 or info.st_mode&0o022:raise ValueError('PENDING_COMPOSITE_RECOVERY_LOCK_UNTRUSTED')
    fd=os.open(lock,os.O_RDWR|os.O_NOFOLLOW)
    try:
        fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        paths=SimpleNamespace(root=root,releases=Path('/home/deploy/disdex-trading/releases'),current_plan=root/'current-plan.json',pins=Path('/etc/disdex/runner-pins.json'))
        parent=SimpleNamespace(paths=paths,root_uid=0)
        journal=root/'pending-maintenance/transactions'/(NEW+'.json')
        if not journal.exists() and not journal.is_symlink():
            print(json.dumps({'status':'NO_INCOMPLETE_COMPOSITE_UPGRADE','ordersSent':0,'cancelsSent':0,'positionChangesSent':0}));return
        release=release_marker(NEW,paths.releases,root_uid=0);validate_source_files(release)
        sdk=maintenance._load_sdk(release)
        restored=recover_incomplete_upgrade(parent,systemd_root=Path('/etc/systemd/system'),runner=subprocess.run,maintenance=maintenance,expected_new_unit=sdk.render_service(NEW).encode())
        print(json.dumps({'status':'PENDING_COMPOSITE_UPGRADE_ROLLED_BACK' if restored else 'NO_INCOMPLETE_COMPOSITE_UPGRADE','ordersSent':0,'cancelsSent':0,'positionChangesSent':0}))
    finally:
        fcntl.flock(fd,fcntl.LOCK_UN);os.close(fd)

if __name__=='__main__':main()
