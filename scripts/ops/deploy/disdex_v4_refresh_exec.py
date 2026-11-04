#!/usr/bin/env python3
"""Lossless serialization adapter for the immutable V4 refresh CLI.

The three-payload atomic bundle can exceed the legacy per-document pretty JSON
limit. Compact the same root-owned JSON before that reader; retain every value,
payload digest, source timestamp and approval. No evidence is generated here.
"""
import json,hashlib,os,re,stat,subprocess,uuid
from pathlib import Path

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
    return subprocess.run(['/usr/bin/node',str(release/'node_modules/tsx/dist/cli.mjs'),
        str(release/'scripts/ops/root/disdex-v4-dynamic-evidence-refresh.ts'),'--sha',sha,'--apply',
        '--lease','/var/lib/disdex/unified-deploy/refresh-leases/v4/'+sha+'.json'],cwd=release).returncode

if __name__=='__main__':
    try:raise SystemExit(main())
    except Exception as error:
        reason=str(error) if isinstance(error,ValueError) and str(error).startswith('V4_REFRESH_SERIALIZATION_') else type(error).__name__
        print(json.dumps(dict(status='V4_REFRESH_SERIALIZATION_FAILED_CLOSED',reason=reason)));raise SystemExit(2)
