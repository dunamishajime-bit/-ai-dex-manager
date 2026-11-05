#!/usr/bin/env python3
"""Serialize the existing bounded watchdog with formal deployment transactions.

No marker is manufactured on deferral. No trading authority, API policy or
watchdog decision changes; only the genuine native child can perform its
existing allow-listed recovery once the deployment lock is free.
"""
import argparse,json,os,subprocess
from pathlib import Path
from disdex_unified_root_gate import (_assert_execution_root,assert_root_trusted_dir,
    assert_regular_secure,release_marker,RELEASES)

WATCHDOG_SCRIPT='scripts/ops/root/disdex-runner-watchdog-current.mjs'
ROOT=Path('/var/lib/disdex/unified-deploy')

def run_watchdog(sha,*,deployment_root=ROOT,releases=RELEASES,audit_only=False,runner=None):
    import fcntl
    _assert_execution_root(0)
    release=release_marker(sha,releases,root_uid=0)
    script=release/WATCHDOG_SCRIPT;info=assert_regular_secure(script,root_uid=0,private=False)
    if info.st_mode&0o222:raise ValueError('WATCHDOG_IMMUTABLE_SCRIPT_REQUIRED')
    assert_root_trusted_dir(deployment_root,root_uid=0)
    lock=deployment_root/'deployment-execution.lock'
    before=assert_regular_secure(lock,root_uid=0,private=True)
    fd=os.open(lock,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        opened=os.fstat(fd)
        if (before.st_dev,before.st_ino)!=(opened.st_dev,opened.st_ino):raise ValueError('WATCHDOG_DEPLOYMENT_LOCK_CHANGED')
        try:fcntl.flock(fd,fcntl.LOCK_SH|fcntl.LOCK_NB)
        except BlockingIOError:
            return dict(status='WATCHDOG_DEFERRED_DEPLOYMENT_IN_PROGRESS',releaseSha=sha,
                exitCode=0,ran=False,ordersSent=0,cancelsSent=0,positionChangesSent=0)
        current=assert_regular_secure(lock,root_uid=0,private=True)
        if (current.st_dev,current.st_ino)!=(opened.st_dev,opened.st_ino):raise ValueError('WATCHDOG_DEPLOYMENT_LOCK_CHANGED')
        command=['/usr/bin/node',str(script)]+(['--audit-only'] if audit_only else [])
        # Keep this Root parent/lock alive until the entire child has exited.
        result=(subprocess.run if runner is None else runner)(command,cwd=release,check=False)
        code=result.returncode if result.returncode>=0 else 128-result.returncode
        return dict(status='WATCHDOG_COMMAND_COMPLETED' if code==0 else 'WATCHDOG_COMMAND_FAILED',
            releaseSha=sha,exitCode=code,ran=True,ordersSent=0,cancelsSent=0,positionChangesSent=0)
    finally:
        os.close(fd)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--sha',required=True)
    parser.add_argument('--audit-only',action='store_true');args=parser.parse_args()
    result=run_watchdog(args.sha,audit_only=args.audit_only)
    print(json.dumps(result,sort_keys=True));return result['exitCode']

if __name__=='__main__':raise SystemExit(main())
