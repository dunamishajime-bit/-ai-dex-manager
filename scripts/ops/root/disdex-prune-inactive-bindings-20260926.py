#!/usr/bin/env python3
"""One-shot guarded/archive-first cleanup of obsolete release reference FILES.
Never deletes releases, audit artifacts, runtime state or live systemd units.
The installed official retention helper independently decides any deletions.
"""
from __future__ import annotations
import argparse
import fcntl
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tarfile
import time

ROOT=Path("/home/deploy/disdex-trading")
RELEASES=ROOT/"releases"
SYSTEMD=Path("/etc/systemd/system")
RUNTIME_ENVS=Path("/etc/disdex/current-runtime")
ARCHIVES=Path("/root/disdex-release-binding-archives")
PROMOTION=Path("/home/deploy/disdex-ops/promotion.lock")
SHA=re.compile(r"^[0-9a-f]{40}$")
PROD_SHA="e1b58060d6263a3af7ced51bec854d3e211d2f35"
UNITS=("disdex-v12-x1-all","disdex-pengu-dual-ls-v2","disdex-quality102-causal-v1","disdex-fet-brk48","disdex-v52-aster-only","disdex-shared-crypto-risk","disdex-v12-v52-margin-guard")

def capture(command:list[str], timeout=10):
    result=subprocess.run(command,capture_output=True,text=True,timeout=timeout)
    return result.returncode,result.stdout.strip()
def identity():
    target=(ROOT/"current").resolve(strict=True)
    assert target.parent==RELEASES and SHA.fullmatch(target.name) and target.name==PROD_SHA,"CURRENT_RELEASE_CHANGED"
    assert (target/".disdex-release-sha").read_text().strip()==target.name,"LIVE_MARKER_MISMATCH"
    assert os.geteuid()==0,"REQUIRES_ROOT"
    for u in UNITS:
        rc,txt=capture(["systemctl","show",u+"@"+PROD_SHA+".service","-p","ActiveState","-p","NRestarts","--no-pager"])
        assert rc==0 and "ActiveState=active" in txt and "NRestarts=0" in txt,"LIVE_UNIT_UNHEALTHY:"+u
    kill=Path("/var/lib/disdex/shared/kill-switch.json")
    assert not kill.is_symlink() and json.loads(kill.read_text()).get("active") is False,"KILL_SWITCH_NOT_SAFE"
    rc,_=capture(["runuser","-u","deploy","--","test","-r",str(kill)])
    assert rc==0,"DEPLOY_KILL_SWITCH_NOT_READABLE"
    return target
def valid_releases():
    return sorted((p for p in RELEASES.iterdir()
                   if p.is_dir() and not p.is_symlink() and SHA.fullmatch(p.name)
                   and (p/".disdex-release-sha").is_file() and not (p/".disdex-release-sha").is_symlink()
                   and (p/".disdex-release-sha").read_text().strip()==p.name),
                  key=lambda p:p.stat().st_mtime,reverse=True)
def protected_releases(releases:list[Path],current:Path)->set[Path]:
    pinned={current}
    for p in releases:
        if p!=current and len(pinned)<3:pinned.add(p)
    pending=list(pinned)
    while pending:
        p=pending.pop()
        for name in ("node_modules",".venv2"):
            dep=p/name
            if dep.is_symlink():
                actual=dep.resolve(strict=True)
                dep_root=actual.parent
                assert dep_root.parent==RELEASES and SHA.fullmatch(dep_root.name),"DEPENDENCY_OUTSIDE_PROTECTED_RELEASE_ROOT"
                if dep_root not in pinned:pinned.add(dep_root);pending.append(dep_root)
    return pinned
def unit_active(name:str)->bool:
    return capture(["systemctl","is-active",name],timeout=5)[1]=="active"
def unit_enabled(name:str)->bool:
    value=capture(["systemctl","is-enabled",name],timeout=5)[1]
    return value.startswith(("enabled","linked"))
def select_paths(releases:list[Path],pinned:set[Path])->tuple[list[Path],list[Path],list[Path]]:
    selected=[]; selected_dirs=[]; prospective=[]
    for rel in releases:
        if rel in pinned or time.time()-rel.stat().st_mtime<86400:continue
        unit_dirs=sorted(SYSTEMD.glob("*@"+rel.name+".service.d"))
        files=[]
        for dr in unit_dirs:
            assert not dr.is_symlink() and dr.is_dir(),"UNTRUSTED_DROPIN_DIRECTORY"
            unit=dr.name[:-2]
            if unit_active(unit) or unit_enabled(unit):raise RuntimeError("BLOCKED_OBSOLETE_UNIT_STILL_ACTIVE_OR_ENABLED:"+unit)
            for name in dr.rglob("*"):
                assert name.is_file() and not name.is_symlink(),"UNTRUSTED_DROPIN_CONTENT"
                files.append(name)
        envs=sorted(x for x in RUNTIME_ENVS.glob(rel.name+"*") if x.is_file() and not x.is_symlink())
        for x in envs:
            assert x.parent==RUNTIME_ENVS and x.name.startswith(rel.name),"UNTRUSTED_ENV"
        selected.extend(files+envs)
        selected_dirs.extend(unit_dirs)
        prospective.append(rel)
    return selected,selected_dirs,prospective
def attest_file(p:Path):
    st=p.lstat()
    assert stat.S_ISREG(st.st_mode) and st.st_nlink==1,"UNTRUSTED_FILE_TYPE"
    return {"path":str(p),"sha256":hashlib.sha256(p.read_bytes()).hexdigest(),"bytes":st.st_size}
def archive_before_delete(files:list[Path]):
    ARCHIVES.mkdir(mode=0o700,parents=True,exist_ok=True)
    os.chmod(ARCHIVES,0o700)
    path=ARCHIVES/("bindings-"+time.strftime("%Y%m%dT%H%M%SZ",time.gmtime())+"-"+str(os.getpid())+".tar.gz")
    manifest=[attest_file(p) for p in files]
    with tarfile.open(path,"w:gz") as tar:
        for p in files:
            tar.add(p,arcname=str(p).lstrip("/"),recursive=False)
        payload=json.dumps({"schema":"disdex-stale-binding-backup/v1","current":PROD_SHA,"files":manifest},sort_keys=True).encode()
        info=tarfile.TarInfo("MANIFEST.json");info.size=len(payload);info.mode=0o600;tar.addfile(info,io.BytesIO(payload))
    os.chmod(path,0o600)
    with tarfile.open(path,"r:gz") as tar:
        for item in manifest:
            member=tar.getmember(item["path"].lstrip("/"))
            assert hashlib.sha256(tar.extractfile(member).read()).hexdigest()==item["sha256"],"ARCHIVE_VERIFY_MISMATCH"
    return path,manifest
def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--apply-bindings",action="store_true")
    args=parser.parse_args()
    current=identity()
    releases=valid_releases()
    pinned=protected_releases(releases,current)
    files,dirs,prospective=select_paths(releases,pinned)
    assert all(x not in pinned for x in prospective),"PINNED_RELEASE_SELECT_ERROR"
    if not args.apply_bindings:
        print("ARCHIVE_PLAN="+json.dumps({"validReleases":len(releases),"pinned":sorted(p.name for p in pinned),"eligibleOldReleases":len(prospective),"files":len(files),"dropinDirs":len(dirs),"preserveOriginals":True,"mutation":0}))
        return
    PROMOTION.parent.mkdir(parents=True,exist_ok=True)
    with PROMOTION.open("a+") as handle:
        fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB)
        current2=identity()
        assert current==current2,"RELEASE_CHANGED_DURING_GATE"
        x,y,z=select_paths(valid_releases(),protected_releases(valid_releases(),current))
        assert set(x)==set(files) and set(y)==set(dirs) and set(z)==set(prospective),"BINDING_PLAN_CHANGED"
        for path in files:
            if path.is_symlink() or not path.is_file():raise RuntimeError("BINDING_CHANGED")
        backup,manifest=archive_before_delete(files)
        try:
            for row in manifest:
                p=Path(row["path"])
                assert attest_file(p)["sha256"]==row["sha256"],"BINDING_CONCURRENT_CHANGE"
                p.unlink()
            for p in sorted(set(dirs),key=lambda p:len(p.parts),reverse=True):
                if p.is_dir() and not any(p.iterdir()):p.rmdir()
            rc,_=capture(["systemctl","daemon-reload"],timeout=35)
            assert rc==0,"SYSTEMD_DAEMON_RELOAD_FAILED"
            identity()
            assert not any(x.exists() for x in files),"STALE_BINDING_STILL_PRESENT"
        except Exception:
            # Restore archive-only reference files; no release or trading state was altered.
            with tarfile.open(backup,"r:gz") as tar:
                for item in manifest:
                    p=Path(item["path"]);p.parent.mkdir(parents=True,exist_ok=True)
                    member=tar.getmember(str(p).lstrip("/"))
                    with tar.extractfile(member) as src,p.open("wb") as dst:dst.write(src.read())
                    os.chown(p,member.uid,member.gid);os.chmod(p,member.mode)
            capture(["systemctl","daemon-reload"],timeout=35)
            raise
        print("ARCHIVED_OBSOLETE_BINDINGS="+json.dumps({"files":len(files),"eligibleOldReleases":len(prospective),"archive":str(backup),"archiveBytes":backup.stat().st_size,"releaseDirectoriesDeleted":0,"runtimeStateChanged":False,"ordersSent":0,"activeServicesPreserved":True}))
if __name__=="__main__":main()
