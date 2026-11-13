#!/usr/bin/env python3
"""Prepare scoped activation wiring without enabling orders or restarting services."""
from __future__ import annotations
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Callable

SCRIPT_DIR=Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0,str(SCRIPT_DIR))

from disdex_owner_approval import verify
from disdex_allrunner_order_enable import (
    PLAN_DEFAULT, PUBLIC_KEY, NONCE_DIR, PINS, SOURCE_SHA_FILE,
    REPO, DEPLOYMENT_TARGET, OPERATOR_TARGET, SCOPE,
    load_plan, plan_sha256, read_json, validate_pin_manifest, require,
)

OPERATION="ALL_RUNNERS_ORDER_ENABLE_PREP"
WRAPPER=Path("/usr/local/sbin/disdex-allrunner-order-enable-prep")
GLOBAL_ACTIVATION="/var/lib/disdex/shared/operator-activation/current.json"
DROPIN_NAME="99-disdex-order-enable-activation.conf"
DEDICATED_RUNNERS=("V12_V4","QUALITY102_CAUSAL_V1","V52")
UNIT_RE=re.compile(r"^[A-Za-z0-9_.@:-]+\.service$")

def logical_lines(text: str) -> list[str]:
    out=[]
    buf=""
    for raw in text.splitlines():
        line=(buf+raw) if buf else raw
        if line.rstrip().endswith("\\"):
            buf=line.rstrip()[:-1]
            continue
        out.append(line)
        buf=""
    if buf:
        out.append(buf)
    return out

def effective_execstartpre_from_cat(text: str) -> list[str]:
    commands=[]
    section=""
    for line in logical_lines(text):
        stripped=line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if stripped.startswith("[") and stripped.endswith("]"):
            section=stripped
            continue
        if section!="[Service]" or not stripped.startswith("ExecStartPre="):
            continue
        rhs=stripped.split("=",1)[1]
        if rhs=="":
            commands.clear()
        else:
            require("\n" not in rhs and "\r" not in rhs,"EXECSTARTPRE_MULTILINE_INVALID")
            commands.append(rhs)
    require(commands,"EXECSTARTPRE_EMPTY")
    return commands

def activation_path_from_command(command: str) -> str:
    match=re.search(r"--activation-path(?:=|\s+)(\S+)",command)
    require(match is not None,"ACTIVATION_PATH_ARG_MISSING")
    return match.group(1)

def canonical_gate_command(runner: str, sha: str, expected: str) -> str:
    require(re.fullmatch(r"[0-9a-f]{40}",sha) is not None,"RUNNER_SHA_INVALID:"+runner)
    release="/home/deploy/disdex-trading/releases/"+sha
    return (
        "+/usr/bin/node "+release+"/scripts/ops/root/disdex-live-operator-activation-gate.mjs "
        "--release-root "+release+" --sha "+sha+" --runner "+runner+" --activation-path "+expected
    )

def ensure_scoped_activation_gate(commands: list[str], runner: str, sha: str, allowed_old: str, expected: str) -> list[str]:
    indexes=[i for i,c in enumerate(commands) if "disdex-live-operator-activation-gate.mjs" in c]
    require(len(indexes)<=1,"ACTIVATION_GATE_COUNT:"+str(len(indexes)))
    if not indexes:
        return [*commands,canonical_gate_command(runner,sha,expected)]
    index=indexes[0]
    current=activation_path_from_command(commands[index])
    require(current in (allowed_old,expected),"ACTIVATION_OLD_PATH_UNEXPECTED:"+current)
    if current==expected:
        return list(commands)
    replaced=re.sub(r"(--activation-path(?:=|\s+))\S+",lambda m:m.group(1)+expected,commands[index],count=1)
    out=list(commands)
    out[index]=replaced
    return out

def render_dropin(commands: list[str]) -> str:
    require(commands,"DROPIN_COMMANDS_EMPTY")
    lines=["[Service]","ExecStartPre="]
    for command in commands:
        require("\n" not in command and "\r" not in command,"DROPIN_COMMAND_INVALID")
        lines.append("ExecStartPre="+command)
    return "\n".join(lines)+"\n"

def atomic_text(path: Path, text: str):
    path.parent.mkdir(parents=True,exist_ok=True,mode=0o755)
    require(not path.is_symlink(),"DROPIN_SYMLINK:"+str(path))
    fd,tmp=tempfile.mkstemp(prefix=path.name+".",dir=str(path.parent))
    try:
        with os.fdopen(fd,"w",encoding="utf-8",newline="\n") as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp,0o644)
        os.replace(tmp,path)
    finally:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass

def apply_dropin_transaction(changes: dict[Path,str], daemon_reload: Callable[[],None], post_validate: Callable[[],None]):
    existed={p:p.exists() for p in changes}
    backups={p:(p.read_bytes() if p.exists() else b"") for p in changes}
    try:
        for path,text in changes.items():
            atomic_text(path,text)
        daemon_reload()
        post_validate()
    except Exception:
        for path in changes:
            if existed[path]:
                fd,tmp=tempfile.mkstemp(prefix=path.name+".rollback.",dir=str(path.parent))
                try:
                    with os.fdopen(fd,"wb") as f:
                        f.write(backups[path])
                        f.flush()
                        os.fsync(f.fileno())
                    os.chmod(tmp,0o644)
                    os.replace(tmp,path)
                finally:
                    try:
                        os.unlink(tmp)
                    except FileNotFoundError:
                        pass
            else:
                try:
                    path.unlink()
                except FileNotFoundError:
                    pass
        daemon_reload()
        raise

def systemctl(*args: str) -> str:
    p=subprocess.run(["systemctl",*args],capture_output=True,text=True,timeout=30)
    require(p.returncode==0,"SYSTEMD_FAILED:"+":".join(args)+":"+p.stderr[-160:])
    return p.stdout

def daemon_reload():
    systemctl("daemon-reload")

def unit_cat(unit: str) -> str:
    require(UNIT_RE.fullmatch(unit) is not None,"UNIT_NAME_INVALID:"+unit)
    return systemctl("cat",unit)

def unit_state(unit: str) -> dict[str,str]:
    return {key:systemctl("show",unit,"--property="+key,"--value").strip()
            for key in ("MainPID","NRestarts","ActiveState","SubState")}

def activation_snapshot(plan: dict) -> dict[str,bytes|None]:
    snap={}
    for name,raw in plan["activationPaths"].items():
        path=Path(raw)
        require(not path.is_symlink(),"ACTIVATION_SYMLINK:"+name)
        snap[name]=path.read_bytes() if path.exists() else None
    return snap

def assert_activation_unchanged(before: dict[str,bytes|None], plan: dict):
    require(activation_snapshot(plan)==before,"ACTIVATION_JSON_CHANGED")

def dropin_path(unit: str) -> Path:
    require(UNIT_RE.fullmatch(unit) is not None,"UNIT_NAME_INVALID:"+unit)
    return Path("/etc/systemd/system")/(unit+".d")/DROPIN_NAME

def planned_dropins(plan: dict, runners: dict):
    changes={}
    units={}
    for runner in DEDICATED_RUNNERS:
        entry=runners[runner]
        unit=str(entry["serviceUnit"])
        expected=plan["activationPathsByRunner"][runner]
        release_root=Path(str(entry["releaseRoot"]))
        gate_path=release_root/"scripts/ops/root/disdex-live-operator-activation-gate.mjs"
        require(gate_path.is_file() and not gate_path.is_symlink(),"RELEASE_GATE_MISSING:"+runner)
        commands=effective_execstartpre_from_cat(unit_cat(unit))
        rewritten=ensure_scoped_activation_gate(commands,runner,str(entry["sha"]),GLOBAL_ACTIVATION,expected)
        units[runner]=unit
        if rewritten!=commands:
            changes[dropin_path(unit)]=render_dropin(rewritten)
    return changes,units

def validate_effective_wiring(plan: dict, runners: dict):
    for runner in DEDICATED_RUNNERS:
        unit=str(runners[runner]["serviceUnit"])
        commands=effective_execstartpre_from_cat(unit_cat(unit))
        gates=[c for c in commands if "disdex-live-operator-activation-gate.mjs" in c]
        require(len(gates)==1,"EFFECTIVE_GATE_COUNT:"+runner)
        require(activation_path_from_command(gates[0])==plan["activationPathsByRunner"][runner],
                "EFFECTIVE_ACTIVATION_PATH_MISMATCH:"+runner)

def assert_root_private(path: Path, directory=False):
    st=path.lstat()
    require((path.is_dir() if directory else path.is_file()) and not path.is_symlink(),
            "ROOT_PATH_INVALID:"+str(path))
    require(st.st_uid==0 and st.st_mode & 0o022==0,"ROOT_PATH_PERMISSIONS_INVALID:"+str(path))

def validate_installation(plan_path: Path, source_sha: str, plan_hash: str):
    require(os.geteuid()==0,"ROOT_REQUIRED")
    for path in (Path(__file__).resolve(),SCRIPT_DIR/"disdex_owner_approval.py",
                 SCRIPT_DIR/"disdex_allrunner_order_enable.py",WRAPPER,plan_path,SOURCE_SHA_FILE):
        assert_root_private(path)
    assert_root_private(NONCE_DIR,directory=True)
    assert_root_private(PUBLIC_KEY)
    require(SOURCE_SHA_FILE.read_text(encoding="ascii").strip()==source_sha,"INSTALLED_SOURCE_SHA_MISMATCH")
    require(plan_sha256(plan_path)==plan_hash,"PLAN_SHA_MISMATCH")

def verify_owner(token: str, source_sha: str, plan_hash: str, owner: str, consume: bool):
    return verify(token,PUBLIC_KEY,REPO,source_sha,SCOPE,owner,plan_hash,
                  nonce_dir=NONCE_DIR if consume else None,route="GITHUB_ACTIONS",
                  deployment_target=DEPLOYMENT_TARGET,operator_target=OPERATOR_TARGET,
                  orders_enabled=False)

def preflight(plan_path: Path, source_sha: str, plan_hash: str, owner: str, token: str):
    validate_installation(plan_path,source_sha,plan_hash)
    plan=load_plan(plan_path)
    runners=validate_pin_manifest(read_json(PINS),plan)
    changes,units=planned_dropins(plan,runners)
    states={runner:unit_state(unit) for runner,unit in units.items()}
    activations=activation_snapshot(plan)
    verify_owner(token,source_sha,plan_hash,owner,False)
    return plan,runners,changes,states,activations

def execute(plan_path: Path, source_sha: str, plan_hash: str, owner: str, token: str):
    plan,runners,changes,before_states,before_activations=preflight(plan_path,source_sha,plan_hash,owner,token)
    verify_owner(token,source_sha,plan_hash,owner,True)
    def validate_after():
        validate_effective_wiring(plan,runners)
        after_states={runner:unit_state(str(runners[runner]["serviceUnit"])) for runner in DEDICATED_RUNNERS}
        require(after_states==before_states,"SERVICE_STATE_CHANGED")
        assert_activation_unchanged(before_activations,plan)
    if changes:
        apply_dropin_transaction(changes,daemon_reload,validate_after)
    else:
        validate_after()
    return {"status":"ORDER_ENABLE_PREP_WIRING_READY","operation":OPERATION,"ordersEnabled":False,
            "dropinsChanged":len(changes),"serviceRestarts":0,"ordersSent":0,"cancelsSent":0,
            "positionChangesSent":0,"activationArtifactsChanged":0}

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--source-sha",required=True)
    p.add_argument("--plan-sha256",required=True)
    p.add_argument("--owner",required=True)
    p.add_argument("--plan",default=str(PLAN_DEFAULT))
    p.add_argument("--read-approval-stdin",action="store_true",required=True)
    mode=p.add_mutually_exclusive_group(required=True)
    mode.add_argument("--preflight-readonly",action="store_true")
    mode.add_argument("--execute",action="store_true")
    a=p.parse_args()
    token=sys.stdin.read().strip()
    require(token and len(token)<=16384,"APPROVAL_TOKEN_INVALID")
    try:
        if a.execute:
            result=execute(Path(a.plan),a.source_sha,a.plan_sha256,a.owner,token)
        else:
            preflight(Path(a.plan),a.source_sha,a.plan_sha256,a.owner,token)
            result={"status":"ORDER_ENABLE_PREP_PREFLIGHT_PASS","operation":OPERATION,"ordersEnabled":False}
        print(json.dumps(result,sort_keys=True))
        return 0
    except Exception as e:
        print("ALLRUNNER_ORDER_ENABLE_PREP_BLOCKED:"+type(e).__name__+":"+str(e)[:300],file=sys.stderr)
        return 1

if __name__=="__main__":
    raise SystemExit(main())
