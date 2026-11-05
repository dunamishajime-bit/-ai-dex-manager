#!/usr/bin/env python3
"""Lossless serialization adapter for the immutable V4 refresh CLI.

The three-payload atomic bundle can exceed the legacy per-document pretty JSON
limit. Compact the same root-owned JSON before that reader; retain every value,
payload digest, source timestamp and approval. No evidence is generated here.
"""
import json,hashlib,os,re,stat,subprocess,uuid,time,secrets,sys
from pathlib import Path

def public_refresh_failure(result):
    for line in result.stderr.splitlines():
        try:event=json.loads(line)
        except ValueError:continue
        reason=event.get('reason') if isinstance(event,dict) else None
        if isinstance(reason,str) and re.fullmatch(r'(?:V4|ASTER|PENDING)_[A-Z0-9_]+(?::[0-9.]+)?',reason):return reason
    return 'CHILD_ERROR_REDACTED'

def readonly_refresh_deferral(result):
    events=[]
    for line in (result.stdout+'\n'+result.stderr).splitlines():
        try:value=json.loads(line)
        except ValueError:continue
        if isinstance(value,dict):events.append(value)
    if len(events)!=1:return None
    event=events[0];effects=event.get('tradingEffects',{})
    if (event.get('status')!='V4_DYNAMIC_EVIDENCE_REFRESH_BLOCKED'
        or event.get('readOnly') is not True or event.get('authorizesTrading') is not False
        or not isinstance(effects,dict) or set(effects)!=set(['ordersSent','cancelsSent','positionChangesSent'])
        or not all(type(v) is int and v==0 for v in effects.values())):return None
    reason=event.get('reason')
    if reason=='V4_BUDGET_PROXY_RESPONSE_INVALID':return reason
    if isinstance(reason,str) and re.fullmatch(r'ASTER_GLOBAL_RATE_BUDGET_SATURATED:[0-9]+(?:\.[0-9]+)?',reason):return reason
    return None

def run_refresh_child(command,*,cwd,runner=None,wait=None,jitter=None,emit=None):
    """Retry only rejected read-only rounds, never reuse their partial output.

    Every attempt is the same immutable CLI: it rechecks the original lease,
    actual signed data, runtime freshness, static hashes and atomic commit.
    The outer systemd flock spans all attempts. Budget/lock limits stay intact.
    """
    runner=subprocess.run if runner is None else runner
    wait=time.sleep if wait is None else wait
    jitter=(lambda:secrets.randbelow(5001)/1000) if jitter is None else jitter
    emit=(lambda value:print(json.dumps(value),flush=True)) if emit is None else emit
    for attempt in range(3):
        result=runner(command,cwd=cwd,check=False,capture_output=True,text=True)
        reason=readonly_refresh_deferral(result) if result.returncode else None
        if result.returncode==0 or reason is None or attempt==2:return result
        extra=jitter()
        if type(extra) not in (int,float) or not 0<=extra<=5:raise ValueError('V4_REFRESH_RETRY_JITTER_INVALID')
        delay=(15 if attempt==0 else 30)+extra
        emit(dict(status='V4_REFRESH_READONLY_RETRY_DEFERRED',attempt=attempt+1,
                  retryAfterSeconds=delay,reason=reason,authorizesTrading=False))
        wait(delay)

def compact_document(raw,sha):
    if len(raw)>1048576:raise ValueError('V4_REFRESH_SERIALIZATION_INPUT_LIMIT')
    d=json.loads(raw)
    if (d.get('schema')!='disdex-v4-dynamic-evidence-commit/v1' or d.get('sha')!=sha
            or d.get('scope')!='V4_EVIDENCE_REFRESH_ONLY' or d.get('ordersEnabled') is not False
            or d.get('authorizesTrading') is not False):
        raise ValueError('V4_REFRESH_SERIALIZATION_IDENTITY')
    result=(json.dumps(d,separators=(',',':'),ensure_ascii=False,allow_nan=False)+'\n').encode()
    if len(result)>256*1024:raise ValueError('V4_REFRESH_SERIALIZATION_OUTPUT_LIMIT')
    if json.loads(result)!=d:raise ValueError('V4_REFRESH_SERIALIZATION_CHANGED_VALUES')
    return result

def compact_file(path,sha):
    s=path.lstat()
    if not stat.S_ISREG(s.st_mode) or path.is_symlink() or s.st_uid!=0 or s.st_mode&0o022:
        raise ValueError('V4_REFRESH_SERIALIZATION_UNTRUSTED_FILE')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd,'rb') as f:
        actual=os.fstat(f.fileno())
        if (actual.st_dev,actual.st_ino)!=(s.st_dev,s.st_ino):raise ValueError('V4_REFRESH_SERIALIZATION_CAS')
        raw=f.read(1048577)
    compact=compact_document(raw,sha)
    if compact==raw:return
    temp=path.with_name('.compact-'+uuid.uuid4().hex)
    fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,stat.S_IMODE(s.st_mode))
    try:
        with os.fdopen(fd,'wb') as f:
            f.write(compact);os.fchown(f.fileno(),s.st_uid,s.st_gid);os.fchmod(f.fileno(),stat.S_IMODE(s.st_mode));f.flush();os.fsync(f.fileno())
        latest=path.lstat()
        if (latest.st_dev,latest.st_ino)!=(s.st_dev,s.st_ino) or path.read_bytes()!=raw:
            raise ValueError('V4_REFRESH_SERIALIZATION_CAS')
        os.replace(temp,path)
        directory=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
        try:os.fsync(directory)
        finally:os.close(directory)
    finally:temp.unlink(missing_ok=True)

def main():
    import argparse
    p=argparse.ArgumentParser();p.add_argument('--sha',required=True);args=p.parse_args();sha=args.sha
    if os.geteuid()!=0 or not re.fullmatch('[a-f0-9]{40}',sha):raise ValueError('V4_REFRESH_SERIALIZATION_ROOT_AND_SHA_REQUIRED')
    release=Path('/home/deploy/disdex-trading/releases')/sha
    if release.is_symlink() or (release/'.disdex-release-sha').read_text().strip()!=sha:
        raise ValueError('V4_REFRESH_SERIALIZATION_RELEASE')
    compact_file(Path('/etc/disdex/v12-v4-evidence/refresh-commit.json'),sha)
    # The official CLI still validates root lease, expiry, static/dynamic hashes,
    # risk, Kill and API budget. Inherit the unit's existing sandbox and env.
    result=run_refresh_child(['/usr/bin/node',str(release/'node_modules/tsx/dist/cli.mjs'),
        str(release/'scripts/ops/root/disdex-v4-dynamic-evidence-refresh.ts'),'--sha',sha,'--apply',
        '--lease','/var/lib/disdex/unified-deploy/refresh-leases/v4/'+sha+'.json'],cwd=release)
    if result.returncode==0:sys.stdout.write(result.stdout)
    else:
        # Do not echo raw child stderr or a credential-bearing upstream URL.
        print(json.dumps(dict(status='V4_REFRESH_CHILD_FAILED_CLOSED',
            reason=public_refresh_failure(result))))
    return result.returncode

if __name__=='__main__':
    try:raise SystemExit(main())
    except Exception as error:
        reason=str(error) if isinstance(error,ValueError) and str(error).startswith('V4_REFRESH_SERIALIZATION_') else type(error).__name__
        print(json.dumps(dict(status='V4_REFRESH_SERIALIZATION_FAILED_CLOSED',reason=reason)));raise SystemExit(2)
