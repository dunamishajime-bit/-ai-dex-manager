#!/usr/bin/env python3
"""Root-SSH, one-child pending reconciliation; never authorizes venue mutations.

Only a new signed GET under the existing account lock can advance updatedAt.
The ephemeral grant is bound to this root parent, exact source and registry.
It is not an owner-signed artifact and grants no trading permission.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import stat
import subprocess
import sys
import time

SHA=re.compile(r'[a-f0-9]{40}\Z')
HASH=re.compile(r'[a-f0-9]{64}\Z')
NONCE=re.compile(r'[a-f0-9]{32}\Z')
RELEASES=Path('/home/deploy/disdex-trading/releases')
PENDING=Path('/var/lib/disdex/shared/pending-exposure.json')
RUNTIME=Path('/run/disdex-pending-refresh')
AUDIT=Path('/var/lib/disdex/unified-deploy/pending-reconcile')


def build_grant(sha, registry_hash, parent_pid, now, nonce):
    if (not SHA.fullmatch(sha) or not HASH.fullmatch(registry_hash)
            or not NONCE.fullmatch(nonce) or type(parent_pid) is not int or parent_pid<=0
            or type(now) is not int or now<=0):
        raise ValueError('pending grant binding invalid')
    return dict(schema='disdex-pending-refresh-root-grant/v1',scope='PENDING_RECONCILE_ONLY',
        repository='dunamishajime-bit/-ai-dex-manager',target='DD1296_FINAL_ALLIN_10BPS',
        route='CODEX_SSH',authorizationMethod='ROOT_SSH_SESSION',ordersEnabled=False,
        sourceSha=sha,registryHash=registry_hash,parentPid=parent_pid,nonce=nonce,
        issuedAt=now,expiresAt=now+60000)


def validate_result(row, before_hash):
    if (not isinstance(row,dict) or row.get('status')!='PENDING_READONLY_RECONCILE_APPLIED'
            or row.get('beforeHash')!=before_hash or not HASH.fullmatch(str(row.get('afterHash','')))
            or any(type(row.get(k)) is not int or row[k]!=0 for k in
                   ['positionCount','openOrderCount','ordersSent','cancelsSent','positionChangesSent'])
            or any(type(row.get(k)) is not int for k in ['verifiedAt','currentUpdatedAt','priorUpdatedAt'])
            or row['verifiedAt']!=row['currentUpdatedAt']
            or row['currentUpdatedAt']<=row['priorUpdatedAt']):
        raise ValueError('pending reconciliation readback invalid')


def secure(path, directory=False, uid=0, allowed_write=0):
    s=path.lstat()
    if (path.is_symlink() or (not stat.S_ISDIR(s.st_mode) if directory else not stat.S_ISREG(s.st_mode))
            or s.st_uid!=uid or s.st_mode & (0o0222 & ~allowed_write)):
        raise ValueError('untrusted pending reconciliation path: '+str(path))
    return s


def exclusive_json(path, value, gid=0, mode=0o600):
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode)
    try:
        os.fchown(fd,0,gid);os.fchmod(fd,mode)
        with os.fdopen(fd,'w',closefd=False) as out:
            json.dump(value,out,sort_keys=True);out.write('\n');out.flush();os.fsync(fd)
    finally:os.close(fd)


def main():
    import fcntl
    import pwd
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sha',required=True)
    mode=parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--verify-only',action='store_true')
    mode.add_argument('--apply-refresh',action='store_true')
    args=parser.parse_args()
    if os.geteuid()!=0 or not SHA.fullmatch(args.sha):raise ValueError('root and exact SHA required')
    installed=Path('/usr/local/libexec/disdex-unified')
    secure(installed,directory=True,allowed_write=0o200)
    for name in ['disdex_unified_root_gate.py','disdex_deployment_contract.py']:
        secure(installed/name,allowed_write=0o200)
    sys.path.insert(0,str(installed))
    from disdex_unified_root_gate import assert_codex_ssh_session
    assert_codex_ssh_session()
    release=RELEASES/args.sha
    secure(release,directory=True)
    secure(release/'.disdex-release-sha')
    if (release/'.disdex-release-sha').read_text().strip()!=args.sha:raise ValueError('release marker mismatch')
    script=release/'scripts/ops/root/disdex-pending-exposure-readonly-reconcile.ts'
    loader=release/'node_modules/tsx/dist/loader.mjs'
    secure(script);secure(loader)
    if Path(__file__).resolve()!=release/'scripts/ops/deploy/disdex_pending_refresh.py':
        raise ValueError('executor must be release local')
    deploy=pwd.getpwnam('deploy')
    if args.verify_only:
        print(json.dumps(dict(status='PENDING_ROOT_EXECUTOR_PREFLIGHT_PASS',sourceSha=args.sha,
            scope='PENDING_RECONCILE_ONLY',ordersEnabled=False,registryWrites=0)))
        return
    for p,gid,mode_value in [(RUNTIME,deploy.pw_gid,0o750),(AUDIT,0,0o700)]:
        if not p.exists():
            p.mkdir(mode=mode_value);os.chown(p,0,gid);os.chmod(p,mode_value)
        secure(p,directory=True,allowed_write=0o200)
        if stat.S_IMODE(p.stat().st_mode)!=mode_value:raise ValueError('private pending executor directory mode invalid')
    lock_fd=os.open(RUNTIME/'executor.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
    grant_path=None
    try:
        fcntl.flock(lock_fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        secure(RUNTIME/'executor.lock',allowed_write=0o200)
        # This is the requested plan binding; the child checks it again inside
        # the account lock, before and after signed GET, before any write.
        before=PENDING.read_bytes();before_hash=hashlib.sha256(before).hexdigest()
        nonce=secrets.token_hex(16)
        grant=build_grant(args.sha,before_hash,os.getpid(),time.time_ns()//1000000,nonce)
        exclusive_json(AUDIT/(nonce+'-prepared.json'),grant)
        grant_path=RUNTIME/(nonce+'.json');exclusive_json(grant_path,grant,deploy.pw_gid,0o640)
        env={k:os.environ[k] for k in ['ASTER_API_PRIVATE_KEY','ASTER_USER_ADDRESS','ASTER_FUTURES_BASE_URL'] if k in os.environ}
        env.update(PATH='/usr/bin:/bin',HOME=deploy.pw_dir,NODE_ENV='production',
            DISDEX_RELEASE_SHA=args.sha,DISDEX_PENDING_REFRESH_GRANT_PATH=str(grant_path),
            DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH='/var/lib/disdex/shared/aster-rate-budget.json')
        result=subprocess.run(['/usr/bin/node','--import',str(loader),str(script),'--apply-refresh'],
            user=deploy.pw_uid,group=deploy.pw_gid,extra_groups=[],cwd=release,env=env,
            capture_output=True,text=True,timeout=55)
        if result.returncode:
            # Never copy raw stderr or credential-bearing exception messages.
            exclusive_json(AUDIT/(nonce+'-failed.json'),dict(status='FAIL_CLOSED',returnCode=result.returncode,sourceSha=args.sha))
            raise ValueError('pending signed reconciliation rejected; registry freshness not certified')
        rows=[json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')]
        if len(rows)!=1:raise ValueError('unexpected reconciliation output')
        row=rows[0];validate_result(row,before_hash)
        after=PENDING.read_bytes()
        # No rollback of a registry after releasing the account lock: another
        # real reservation may already exist. A changed readback fails closed.
        if hashlib.sha256(after).hexdigest()!=row['afterHash']:raise ValueError('pending post-child registry changed')
        old=json.loads(before);new=json.loads(after)
        expected={**old,'updatedAt':row['verifiedAt']}
        if new!=expected:raise ValueError('pending refresh modified fields outside exact scope')
        receipt=dict(status='PENDING_ROOT_RECONCILE_VERIFIED',sourceSha=args.sha,scope='PENDING_RECONCILE_ONLY',
            authorizationMethod='ROOT_SSH_SESSION',ordersEnabled=False,result=row)
        exclusive_json(AUDIT/(nonce+'-verified.json'),receipt)
        print(json.dumps(receipt,sort_keys=True))
    finally:
        if grant_path is not None:grant_path.unlink(missing_ok=True)
        os.close(lock_fd)


if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps(dict(status='PENDING_ROOT_RECONCILE_FAIL_CLOSED',reason=type(error).__name__,
            ordersSent=0,cancelsSent=0,positionChangesSent=0)),file=sys.stderr)
        raise SystemExit(2)
