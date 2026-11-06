"""CAS updates of only Shared Risk monitor keys, with conservative rollback."""
import hashlib
import os
from pathlib import Path
import stat
import uuid


def replace_values(raw,old,new):
    if set(old)!=set(new) or not old:raise ValueError('monitor key scope invalid')
    lines=raw.splitlines(keepends=True);seen=set();output=[]
    for line in lines:
        key=line.split('=',1)[0]
        if key in old:
            if key in seen or line.rstrip('\r\n')!=key+'='+old[key]:
                raise ValueError('monitor value changed or duplicate key')
            seen.add(key);output.append(key+'='+new[key]+ ('\r\n' if line.endswith('\r\n') else '\n'))
        else:output.append(line)
    if seen!=set(old):raise ValueError('required monitor key missing')
    return ''.join(output)


def atomic_text(path,raw,metadata):
    uid,gid,mode=metadata
    tmp=path.with_name(path.name+'.'+uuid.uuid4().hex+'.tmp')
    fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode)
    try:
        os.fchown(fd,uid,gid);os.fchmod(fd,mode)
        with os.fdopen(fd,'wb',closefd=False) as out:
            out.write(raw);out.flush();os.fsync(fd)
        os.replace(tmp,path)
        directory=os.open(path.parent,os.O_RDONLY)
        try:os.fsync(directory)
        finally:os.close(directory)
    finally:
        os.close(fd);tmp.unlink(missing_ok=True)


class SharedRiskMonitorWiring:
    def __init__(self,files,*,root_uid=0):
        self.prepared=[];self.attempted=[];self.root_uid=root_uid
        for path,old,new in files:
            s=path.lstat();parent=path.parent.lstat()
            if (path.is_symlink() or path.parent.is_symlink() or not stat.S_ISREG(s.st_mode)
                    or not stat.S_ISDIR(parent.st_mode) or s.st_uid!=root_uid or parent.st_uid!=root_uid
                    or s.st_mode&0o022 or parent.st_mode&0o022):
                raise ValueError('untrusted monitor wiring file')
            raw=path.read_bytes();next_raw=replace_values(raw.decode(),old,new).encode()
            self.prepared.append(dict(path=path,before=raw,after=next_raw,old=old,new=new,
                metadata=(s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode))))

    @classmethod
    def production(cls,old_sha,new_sha):
        from disdex_deployment_contract import SHA
        if not SHA.fullmatch(old_sha) or not SHA.fullmatch(new_sha):raise ValueError('invalid monitor SHA')
        base=Path('/etc/disdex/current-runtime');common='7688ed7c93a1918d8b44837339b7da5584a868f5'
        def values(sha):
            return {'DISDEX_HEALTH_SNAPSHOT_SHARED_RISK_SERVICE_UNIT':'disdex-shared-crypto-risk@'+sha+'.service',
                    'DISDEX_HEALTH_SNAPSHOT_SHARED_RISK_RELEASE_ROOT':'/home/deploy/disdex-trading/releases/'+sha}
        return cls([(base/(common+'.health-snapshot.env'),values(old_sha),values(new_sha)),
            (base/(common+'.watchdog.env'),{'DISDEX_WATCHDOG_SHARED_RISK_EXPECTED_SHA':old_sha},
             {'DISDEX_WATCHDOG_SHARED_RISK_EXPECTED_SHA':new_sha})])

    def journal(self):
        return [dict(path=str(row['path']),oldValues=row['old'],newValues=row['new'],
            beforeHash=hashlib.sha256(row['before']).hexdigest(),afterHash=hashlib.sha256(row['after']).hexdigest())
            for row in self.prepared]

    def apply(self):
        for row in self.prepared:
            if row['path'].read_bytes()!=row['before']:raise ValueError('monitor wiring CAS conflict')
            # Mark before replace: a directory fsync failure after rename must
            # still restore any file already published by the transaction.
            self.attempted.append(row)
            atomic_text(row['path'],row['after'],row['metadata'])
        self.assert_applied()

    def assert_applied(self):
        for row in self.prepared:
            if row['path'].read_bytes()!=row['after']:raise ValueError('monitor wiring changed during audit')

    def restore(self):
        for row in reversed(self.attempted):
            actual=row['path'].read_bytes()
            if actual==row['before']:continue
            if actual!=row['after']:raise ValueError('newer monitor wiring must not be overwritten')
            atomic_text(row['path'],row['before'],row['metadata'])
