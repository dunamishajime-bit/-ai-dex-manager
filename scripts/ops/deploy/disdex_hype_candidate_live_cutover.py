#!/usr/bin/env python3
"""Exact HYPE candidate cutover for the approved all-runner recovery task.

The candidate is an immutable two-file descendant of the current 7688 runtime.
This helper:
- never edits the 7688 release in place,
- never sends a test order or directly changes venue orders/positions/STOPs,
- migrates only a flat HYPE state after signed Aster proof,
- creates a HYPE-only candidate activation artifact and exact systemd unit,
- starts the candidate and verifies stable ownership/protection.
Natural strategy orders after the LIVE daemon starts are not test orders.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone

BASE_SHA="7688ed7c93a1918d8b44837339b7da5584a868f5"
CANDIDATE_SHA="48cfa8a4045c7021281820e9e31bd8691423860c"
V4_SHA="53a0be396719f0284af4e11b35c66a4ac7d58f79"
V52_SHA="4d33d8244c0b50a7e461ffd8aaf493c32bfdfd81"
Q102_SHA="ef1ab178e26a7bf5bddb6473467765edba242e1d"
SOURCE_CERT_RUN="41253620557"
DOGE_STOP="v12-v4-98ded39746ed3502a4d7b0e26ef9"
EXPECTED_SOURCE_HASH="7a77350725b42649525acc2926557cd9ae78f008c9be82bce63ba31fc0773a36"
EXPECTED_TEST_HASH="d092264891de04d85cd9d031b1a09975e9c9cb6395c516462b67102060e64186"
TEMPLATE_HASH="9d0506d22b1668dbc37628d9a3a14c1c18a2f268e5798da2126a4b75e7309ba8"

RELEASES=Path("/home/deploy/disdex-trading/releases")
BASE=RELEASES/BASE_SHA
CANDIDATE=RELEASES/CANDIDATE_SHA
STAGING_ROOT=Path("/tmp")
ENV_ROOT=Path("/etc/disdex/current-runtime")
BASE_ENV=ENV_ROOT/f"{BASE_SHA}.env"
BASE_OPERATOR=ENV_ROOT/f"{BASE_SHA}.hype-operator.env"
CANDIDATE_ENV=ENV_ROOT/f"{CANDIDATE_SHA}.env"
CANDIDATE_OPERATOR=ENV_ROOT/f"{CANDIDATE_SHA}.hype-operator.env"
ACTIVATION=Path(f"/var/lib/disdex/shared/operator-activation/hype-{CANDIDATE_SHA}.json")
TEMPLATE=Path("/etc/systemd/system/disdex-hype-long@.service")
EXACT_UNIT_FILE=Path(f"/etc/systemd/system/disdex-hype-long@{CANDIDATE_SHA}.service")
OLD_UNIT=f"disdex-hype-long@{BASE_SHA}.service"
NEW_UNIT=f"disdex-hype-long@{CANDIDATE_SHA}.service"
STATE=Path("/var/lib/disdex/hype-zec-long/runner.json")
KILL=Path("/var/lib/disdex/shared/kill-switch.json")
RISK=Path("/var/lib/disdex/shared/crypto-daily-risk.json")
MARGIN=Path("/var/lib/disdex/shared/margin-risk/guard-live.json")
PENDING=Path("/var/lib/disdex/shared/pending-exposure.json")
BACKUP_ROOT=Path("/var/backups/disdex-hype-candidate-cutover")

PEER_UNITS=[
 f"disdex-v12-v4@{V4_SHA}.service",
 f"disdex-idle-priority-short@{BASE_SHA}.service",
 f"disdex-pengu-dual-ls-v2@{BASE_SHA}.service",
 f"disdex-fet-brk48@{BASE_SHA}.service",
 f"disdex-quality102-causal-v1@{Q102_SHA}.service",
 f"disdex-v52-aster-only@{V52_SHA}.service",
 f"disdex-v12-v52-margin-guard@{BASE_SHA}.service",
]

def require(value: bool, reason: str) -> None:
    if not value:
        raise RuntimeError(reason)

def sha256(path: Path) -> str:
    h=hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda:f.read(1024*1024),b""):
            h.update(chunk)
    return h.hexdigest()

def read_json(path: Path) -> dict:
    require(path.is_file() and not path.is_symlink(),"STATE_FILE_INVALID:"+str(path))
    value=json.loads(path.read_text())
    require(isinstance(value,dict),"STATE_NOT_OBJECT:"+str(path))
    return value

def run(argv: list[str], *, cwd: Path|None=None, timeout: int=60,
        env: dict[str,str]|None=None, check: bool=True) -> subprocess.CompletedProcess:
    p=subprocess.run(argv,cwd=str(cwd) if cwd else None,capture_output=True,text=True,
                     timeout=timeout,env=env)
    if check and p.returncode:
        raise RuntimeError("COMMAND_FAILED:"+argv[0]+":"+str(p.returncode)+":"+p.stderr[-180:])
    return p

def prop(unit: str,key: str) -> str:
    return run(["systemctl","show",unit,f"--property={key}","--value"],timeout=15).stdout.strip()

def active(unit: str) -> bool:
    return prop(unit,"ActiveState")=="active"

def enabled(unit: str) -> bool:
    p=run(["systemctl","is-enabled",unit],timeout=15,check=False)
    require(p.returncode in (0,1),"SYSTEMD_ENABLE_STATE_UNAVAILABLE:"+unit)
    return p.stdout.strip()=="enabled"

def shared_health() -> None:
    require(read_json(KILL).get("active") is False,"SHARED_KILL_SWITCH_ACTIVE")
    risk=read_json(RISK)
    require(risk.get("sourceComplete") is True and risk.get("tripped") is not True,
            "SHARED_RISK_NOT_HEALTHY")
    margin=read_json(MARGIN)
    now=int(time.time()*1000)
    require(margin.get("stage")=="HEALTHY" and margin.get("ordersAllowed") is True,
            "MARGIN_GUARD_NOT_HEALTHY")
    checked=margin.get("checkedAt")
    require(type(checked) in (int,float) and -1000 <= now-checked <= 15*60_000,
            "MARGIN_GUARD_STALE")
    pending=read_json(PENDING).get("entries")
    require(isinstance(pending,list),"PENDING_EXPOSURE_INVALID")
    require(not any(isinstance(e,dict) and str(e.get("status","")).upper()!="RELEASED"
                    for e in pending),"PENDING_EXPOSURE_ACTIVE")
    for unit in PEER_UNITS:
        require(active(unit),"REQUIRED_PEER_NOT_ACTIVE:"+unit)

def signed_account() -> dict:
    release=RELEASES/V4_SHA
    command=(
      "set -ae; for f in "
      "/etc/disdex/disdex-v13d-v11eq-v96.env "
      "/etc/disdex/disdex-v12-pengu-v2-v52.env "
      "/etc/disdex/disdex-v12-v4.env; do . \"$f\"; done; set +a; "
      f"exec /usr/bin/node {release}/node_modules/tsx/dist/cli.mjs "
      "scripts/disdex-aster-readonly-account-diagnostic.ts"
    )
    p=run(["/bin/bash","-c",command],cwd=release,timeout=55)
    rows=[line for line in p.stdout.splitlines() if line.startswith("{")]
    require(bool(rows),"ASTER_SIGNED_GET_EMPTY")
    d=json.loads(rows[-1])
    require(d.get("status")=="ASTER_READONLY_ACCOUNT_DIAGNOSTIC_PASS",
            "ASTER_SIGNED_GET_NOT_PASS")
    require(all(d.get(k)==0 for k in ("ordersSent","cancelsSent","positionChangesSent")),
            "SIGNED_ACCOUNT_READ_NOT_READONLY")
    positions=d.get("positions") or []
    orders=d.get("openOrders") or []
    doge=[p for p in positions if p.get("symbol")=="DOGEUSDT"
          and float(p.get("positionAmt",0))==-226.0
          and float(p.get("entryPrice",0))==0.08052]
    stop=[o for o in orders if o.get("symbol")=="DOGEUSDT"
          and o.get("clientOrderId")==DOGE_STOP and o.get("side")=="BUY"
          and o.get("type")=="STOP_MARKET" and float(o.get("origQty",0))==226.0
          and float(o.get("executedQty",0))==0.0 and o.get("reduceOnly") is True
          and o.get("status")=="NEW"]
    require(len(doge)==1 and len(stop)==1,"DOGE_RESIDENT_PROTECTION_MISMATCH")
    return d

def no_hype_sidecar(d: dict) -> bool:
    for p in d.get("positions") or []:
        if p.get("symbol") in ("HYPEUSDT","ZECUSDT") and abs(float(p.get("positionAmt",0)))>1e-9:
            return False
    for o in d.get("openOrders") or []:
        if o.get("symbol") in ("HYPEUSDT","ZECUSDT") and str(o.get("status","")).upper() in ("NEW","PARTIALLY_FILLED","PENDING_NEW"):
            return False
    return True

def preflight_state() -> bytes:
    raw=STATE.read_bytes()
    state=json.loads(raw)
    require(state.get("schema")=="disdex-hype-zec-long/v1","HYPE_STATE_SCHEMA_INVALID")
    require(state.get("runtimeCommitSha") in (BASE_SHA,CANDIDATE_SHA),"HYPE_STATE_SOURCE_SHA_CHANGED")
    require(state.get("mode")=="LIVE","HYPE_STATE_MODE_INVALID")
    require(not (state.get("positions") or []),"HYPE_STATE_POSITIONS_PRESENT")
    require(state.get("pending") is None,"HYPE_STATE_PENDING_PRESENT")
    require(state.get("manualReview") is None,"HYPE_STATE_MANUAL_REVIEW_PRESENT")
    return raw

def verify_staging(staging: Path) -> tuple[Path,Path]:
    source=staging/"hype-zec-long-runner.ts"
    test=staging/"hype-zec-runner-gate.test.ts"
    require(source.is_file() and not source.is_symlink(),"STAGED_SOURCE_INVALID")
    require(test.is_file() and not test.is_symlink(),"STAGED_TEST_INVALID")
    require(sha256(source)==EXPECTED_SOURCE_HASH,"STAGED_SOURCE_HASH_MISMATCH")
    require(sha256(test)==EXPECTED_TEST_HASH,"STAGED_TEST_HASH_MISMATCH")
    return source,test

def stage_release(staging: Path, run_id: str) -> None:
    source,test=verify_staging(staging)
    require((BASE/".disdex-release-sha").read_text().strip()==BASE_SHA,
            "BASE_RELEASE_MARKER_INVALID")
    if CANDIDATE.exists():
        require(CANDIDATE.is_dir() and not CANDIDATE.is_symlink(),"CANDIDATE_RELEASE_INVALID")
        require((CANDIDATE/".disdex-release-sha").read_text().strip()==CANDIDATE_SHA,
                "CANDIDATE_RELEASE_MARKER_MISMATCH")
        require(sha256(CANDIDATE/"lib/hype-zec-long-runner.ts")==EXPECTED_SOURCE_HASH,
                "EXISTING_CANDIDATE_SOURCE_MISMATCH")
        require(sha256(CANDIDATE/"tests/hype-zec-runner-gate.test.ts")==EXPECTED_TEST_HASH,
                "EXISTING_CANDIDATE_TEST_MISMATCH")
        return
    free=shutil.disk_usage(RELEASES).free
    require(free > 600*1024*1024,"INSUFFICIENT_DISK_FOR_CANDIDATE_RELEASE")
    temp=RELEASES/f".hype-{CANDIDATE_SHA}-{run_id}.staging"
    require(not temp.exists() and not temp.is_symlink(),"RELEASE_STAGING_EXISTS")
    try:
        run(["cp","-a","--reflink=auto",str(BASE),str(temp)],timeout=150)
        for rel,src in [
            ("lib/hype-zec-long-runner.ts",source),
            ("tests/hype-zec-runner-gate.test.ts",test),
        ]:
            dst=temp/rel
            base_file=BASE/rel
            meta=base_file.stat()
            if dst.exists() or dst.is_symlink():
                dst.unlink()
            shutil.copyfile(src,dst)
            os.chown(dst,meta.st_uid,meta.st_gid)
            os.chmod(dst,stat.S_IMODE(meta.st_mode))
        marker=temp/".disdex-release-sha"
        mm=(BASE/".disdex-release-sha").stat()
        marker.write_text(CANDIDATE_SHA+"\n")
        os.chown(marker,mm.st_uid,mm.st_gid)
        os.chmod(marker,stat.S_IMODE(mm.st_mode))
        require(sha256(temp/"lib/hype-zec-long-runner.ts")==EXPECTED_SOURCE_HASH,
                "CANDIDATE_SOURCE_COPY_MISMATCH")
        require(sha256(temp/"tests/hype-zec-runner-gate.test.ts")==EXPECTED_TEST_HASH,
                "CANDIDATE_TEST_COPY_MISMATCH")
        require((temp/".disdex-release-sha").read_text().strip()==CANDIDATE_SHA,
                "CANDIDATE_MARKER_WRITE_MISMATCH")
        os.rename(temp,CANDIDATE)
    finally:
        if temp.exists():
            shutil.rmtree(temp)

def atomic_root_file(path: Path, data: bytes, mode: int) -> None:
    path.parent.mkdir(parents=True,exist_ok=True)
    fd,tmp=tempfile.mkstemp(dir=str(path.parent),prefix="."+path.name+".")
    try:
        with os.fdopen(fd,"wb") as f:
            os.fchmod(f.fileno(),mode)
            f.write(data);f.flush();os.fsync(f.fileno())
        os.chown(tmp,0,0)
        os.replace(tmp,path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)

def candidate_env_bytes() -> bytes:
    lines=BASE_ENV.read_text().splitlines()
    replacements={
      "DISDEX_RELEASE_SHA":CANDIDATE_SHA,
      "DISDEX_RUNTIME_SHA":CANDIDATE_SHA,
      "DISDEX_RELEASE_ROOT":str(CANDIDATE),
      "DISDEX_RUNTIME_COMMIT_SHA":CANDIDATE_SHA,
    }
    seen=set()
    out=[]
    for line in lines:
        key=line.split("=",1)[0] if "=" in line else ""
        if key in replacements:
            expected={
              "DISDEX_RELEASE_SHA":BASE_SHA,
              "DISDEX_RUNTIME_SHA":BASE_SHA,
              "DISDEX_RELEASE_ROOT":str(BASE),
              "DISDEX_RUNTIME_COMMIT_SHA":BASE_SHA,
            }[key]
            require(line==f"{key}={expected}","BASE_RUNTIME_ENV_UNEXPECTED:"+key)
            out.append(f"{key}={replacements[key]}")
            seen.add(key)
        else:
            out.append(line)
    require(seen==set(replacements),"BASE_RUNTIME_ENV_KEYS_MISSING")
    return ("\n".join(out)+"\n").encode()

def install_runtime_files(task_id: str, run_id: str) -> None:
    env_bytes=candidate_env_bytes()
    if CANDIDATE_ENV.exists():
        require(CANDIDATE_ENV.read_bytes()==env_bytes,"CANDIDATE_ENV_MISMATCH")
    else:
        atomic_root_file(CANDIDATE_ENV,env_bytes,0o644)
    operator_bytes=BASE_OPERATOR.read_bytes()
    if CANDIDATE_OPERATOR.exists():
        require(CANDIDATE_OPERATOR.read_bytes()==operator_bytes,"CANDIDATE_OPERATOR_ENV_MISMATCH")
    else:
        atomic_root_file(CANDIDATE_OPERATOR,operator_bytes,0o644)

    readiness=read_json(CANDIDATE/"docs/production/current-implementation-readiness.json")
    blockers=[x for x in readiness.get("blockers",[]) if x!="OPERATOR_LIVE_ACTIVATION_REQUIRED"]
    require(readiness.get("schema")=="disdex-current-implementation-readiness/v1"
            and readiness.get("implementationStatus")=="READY" and not blockers,
            "CANDIDATE_IMPLEMENTATION_NOT_READY")
    require(readiness.get("target")=="DD1296_FINAL_ALLIN_10BPS","CANDIDATE_TARGET_MISMATCH")
    activation={
      "schema":"disdex-live-operator-activation/v1",
      "target":"DD1296_FINAL_ALLIN_10BPS",
      "approvedSha":CANDIDATE_SHA,
      "approvedRunners":["HYPE_TREND_LONG"],
      "ordersEnabled":True,
      "activationClass":"FULL_LIVE",
      "operatorAcknowledgement":"I_ACK_REAL_MONEY_LIVE_ACTIVATION",
      "approvedAt":datetime.now(timezone.utc).isoformat(),
      "allRunnerTaskId":task_id,
      "githubRunId":run_id,
      "sourceCertRunId":SOURCE_CERT_RUN,
      "maintenanceBaseSha":BASE_SHA,
      "maintenanceDiffFiles":[
        "lib/hype-zec-long-runner.ts",
        "tests/hype-zec-runner-gate.test.ts",
      ],
    }
    atomic_root_file(ACTIVATION,(json.dumps(activation,indent=2,sort_keys=True)+"\n").encode(),0o600)

    require(sha256(TEMPLATE)==TEMPLATE_HASH,"HYPE_SYSTEMD_TEMPLATE_CHANGED")
    template=TEMPLATE.read_text()
    exact=template.replace("%i",CANDIDATE_SHA)
    exact=exact.replace(
      "/var/lib/disdex/shared/operator-activation/current.json",
      str(ACTIVATION),
    )
    require("%i" not in exact,"EXACT_UNIT_TEMPLATE_SUBSTITUTION_INCOMPLETE")
    exact_bytes=exact.encode()
    if EXACT_UNIT_FILE.exists():
        require(EXACT_UNIT_FILE.is_file() and not EXACT_UNIT_FILE.is_symlink(),
                "EXACT_UNIT_FILE_INVALID")
        require(EXACT_UNIT_FILE.read_bytes()==exact_bytes,"EXACT_UNIT_FILE_MISMATCH")
    else:
        atomic_root_file(EXACT_UNIT_FILE,exact_bytes,0o644)
    run(["systemctl","daemon-reload"],timeout=35)

def live_env() -> dict[str,str]:
    env=dict(os.environ)
    for file in (Path("/etc/disdex/disdex-v13d-v11eq-v96.env"),
                 Path("/etc/disdex/disdex-v12-pengu-v2-v52.env"),
                 Path("/etc/disdex/disdex-quality102-causal-v1.env"),
                 CANDIDATE_ENV,CANDIDATE_OPERATOR):
        if not file.exists():
            continue
        for line in file.read_text().splitlines():
            if not line or line.lstrip().startswith("#") or "=" not in line:
                continue
            key,value=line.split("=",1)
            env[key]=value
    env.update({
      "NODE_ENV":"production",
      "DISDEX_RUNTIME_COMMIT_SHA":CANDIDATE_SHA,
      "DISDEX_RELEASE_SHA":CANDIDATE_SHA,
      "DISDEX_HYPE_ZEC_MODE":"LIVE",
      "DISDEX_HYPE_ZEC_ENABLED":"true",
      "DISDEX_HYPE_ZEC_LIVE_EXECUTION_ENABLED":"true",
      "DISDEX_HYPE_ZEC_PRODUCTION_CONFIG_LIVE_ENABLED":"true",
      "DISDEX_HYPE_ZEC_SIGNAL_MODE":"TREND",
      "DISDEX_HYPE_ZEC_SYMBOLS":"HYPEUSDT",
      "DISDEX_HYPE_ZEC_RUNTIME_SHA":CANDIDATE_SHA,
    })
    return env

def verify_activation_and_selftest() -> None:
    gate=run([
      "/usr/bin/node",str(CANDIDATE/"scripts/ops/root/disdex-live-operator-activation-gate.mjs"),
      "--release-root",str(CANDIDATE),"--sha",CANDIDATE_SHA,
      "--runner","HYPE_TREND_LONG","--activation-path",str(ACTIVATION),
    ],timeout=30)
    rows=[x for x in gate.stdout.splitlines() if x.startswith("{")]
    require(rows and json.loads(rows[-1]).get("status")=="OPERATOR_ACTIVATION_READY",
            "CANDIDATE_OPERATOR_GATE_NOT_READY")
    selftest=run([
      str(CANDIDATE/"node_modules/.bin/tsx"),
      "scripts/disdex-hype-zec-long-live-runner.ts","--self-test",
    ],cwd=CANDIDATE,timeout=45,env=live_env())
    require("PASS" in selftest.stdout,"HYPE_CANDIDATE_SELFTEST_NOT_PASS")

def migrate_state(run_id: str) -> Path|None:
    BACKUP_ROOT.mkdir(mode=0o700,parents=True,exist_ok=True)
    os.chown(BACKUP_ROOT,0,0);os.chmod(BACKUP_ROOT,0o700)
    state=read_json(STATE)
    if state.get("runtimeCommitSha")==CANDIDATE_SHA:
        require(not (state.get("positions") or []) and state.get("pending") is None
                and state.get("manualReview") is None,"CANDIDATE_STATE_NOT_FLAT")
        return None
    require(state.get("runtimeCommitSha")==BASE_SHA,"HYPE_STATE_SHA_UNEXPECTED_BEFORE_MIGRATION")
    require(not (state.get("positions") or []) and state.get("pending") is None
            and state.get("manualReview") is None,"HYPE_STATE_NOT_FLAT_BEFORE_MIGRATION")
    backup=BACKUP_ROOT/f"runner-before-{CANDIDATE_SHA}-{run_id}.json"
    require(not backup.exists() and not backup.is_symlink(),"HYPE_MIGRATION_BACKUP_EXISTS")
    p=run([
      str(CANDIDATE/"node_modules/.bin/tsx"),
      "scripts/disdex-hype-zec-long-state-migrate.ts",
      "--apply","--state-path",str(STATE),"--to-sha",CANDIDATE_SHA,
      "--backup-path",str(backup),
    ],cwd=CANDIDATE,timeout=50)
    rows=[x for x in p.stdout.splitlines() if x.startswith("{")]
    require(rows,"HYPE_STATE_MIGRATION_RESULT_MISSING")
    result=json.loads(rows[-1])
    require(result.get("status") in ("HYPE_ZEC_LONG_STATE_MIGRATE_PASS",
                                     "HYPE_ZEC_LONG_STATE_MIGRATE_ALREADY_CURRENT"),
            "HYPE_STATE_MIGRATION_NOT_PASS")
    require(read_json(STATE).get("runtimeCommitSha")==CANDIDATE_SHA,
            "HYPE_STATE_MIGRATION_READBACK_SHA_MISMATCH")
    return backup if backup.exists() else None

def journal_bad(start_epoch: int) -> str|None:
    p=run(["journalctl","-u",NEW_UNIT,"--since",f"@{start_epoch}",
           "--no-pager","-o","cat"],timeout=25,check=False)
    text=(p.stdout+"\n"+p.stderr)
    for needle in (
      "HYPE_ZEC_UNMANAGED_OPEN_ORDER_BLOCK",
      '"status":"manual-review"',
      "HYPE_ZEC_RUNNER_FAIL_CLOSED",
    ):
        if needle in text:
            return needle
    return None

def state_and_venue_consistent(account: dict) -> None:
    state=read_json(STATE)
    require(state.get("runtimeCommitSha")==CANDIDATE_SHA,"HYPE_STATE_NOT_CANDIDATE_SHA")
    require(state.get("mode")=="LIVE","HYPE_STATE_NOT_LIVE")
    require(state.get("manualReview") is None,"HYPE_STATE_MANUAL_REVIEW")
    require(state.get("pending") is None,"HYPE_STATE_PENDING_NOT_CLEAR")
    venue_positions=[p for p in account.get("positions") or []
                     if p.get("symbol") in ("HYPEUSDT","ZECUSDT")
                     and abs(float(p.get("positionAmt",0)))>1e-9]
    venue_orders=[o for o in account.get("openOrders") or []
                  if o.get("symbol") in ("HYPEUSDT","ZECUSDT")
                  and str(o.get("status","")).upper() in ("NEW","PARTIALLY_FILLED","PENDING_NEW")]
    require(not any(p.get("symbol")=="ZECUSDT" for p in venue_positions),"UNEXPECTED_ZEC_POSITION")
    require(not any(o.get("symbol")=="ZECUSDT" for o in venue_orders),"UNEXPECTED_ZEC_ORDER")
    owned=state.get("positions") or []
    if not owned:
        require(not venue_positions and not venue_orders,"HYPE_VENUE_EXPOSURE_WITH_FLAT_STATE")
        return
    require(len(owned)==1,"HYPE_STATE_POSITION_COUNT_UNEXPECTED")
    row=owned[0]
    require(row.get("symbol")=="HYPEUSDT","HYPE_STATE_SYMBOL_UNEXPECTED")
    quantity=float(row.get("quantity",0))
    require(quantity>0,"HYPE_STATE_QUANTITY_INVALID")
    hp=[p for p in venue_positions if p.get("symbol")=="HYPEUSDT" and float(p.get("positionAmt",0))>0]
    require(len(hp)==1,"HYPE_VENUE_POSITION_MISSING")
    require(abs(float(hp[0].get("positionAmt",0))-quantity) <= max(1e-8,quantity*0.01),
            "HYPE_POSITION_QUANTITY_MISMATCH")
    stop_id=row.get("stopClientOrderId")
    tp_id=row.get("takeProfitClientOrderId")
    require(isinstance(stop_id,str) and stop_id and isinstance(tp_id,str) and tp_id,
            "HYPE_PROTECTIVE_IDS_MISSING")
    require(float(row.get("stopReadBackAt",0))>0,"HYPE_STOP_READBACK_MISSING")
    matching=[o for o in venue_orders if o.get("clientOrderId") in (stop_id,tp_id)]
    require(len(matching)==2,"HYPE_PROTECTIVE_ORDERS_MISSING")
    for o in matching:
        require(o.get("side")=="SELL" and o.get("reduceOnly") is True,
                "HYPE_PROTECTIVE_ORDER_SHAPE_INVALID")
    require({o.get("type") for o in matching}=={"STOP_MARKET","TAKE_PROFIT_MARKET"},
            "HYPE_PROTECTIVE_ORDER_TYPES_INVALID")

def restore_state(backup: Path|None) -> None:
    if not backup or not backup.exists():
        return
    current=read_json(STATE)
    if current.get("runtimeCommitSha")!=CANDIDATE_SHA:
        return
    meta=STATE.stat()
    data=backup.read_bytes()
    fd,tmp=tempfile.mkstemp(dir=str(STATE.parent),prefix=".hype-rollback-")
    try:
        with os.fdopen(fd,"wb") as f:
            os.fchmod(f.fileno(),stat.S_IMODE(meta.st_mode));f.write(data);f.flush();os.fsync(f.fileno())
        os.chown(tmp,meta.st_uid,meta.st_gid)
        os.replace(tmp,STATE)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)

def start_candidate(backup: Path|None) -> None:
    require(not active(OLD_UNIT),"OLD_HYPE_UNIT_STILL_ACTIVE")
    old_enabled=enabled(OLD_UNIT)
    candidate_enabled=enabled(NEW_UNIT)
    if old_enabled:
        run(["systemctl","disable",OLD_UNIT],timeout=35)
    start_epoch=int(time.time())-1
    try:
        run(["systemctl","reset-failed",NEW_UNIT],timeout=15,check=False)
        run(["systemctl","start",NEW_UNIT],timeout=110)
        deadline=time.monotonic()+80
        pid=0;stable=None
        while time.monotonic()<deadline:
            if active(NEW_UNIT):
                current=int(prop(NEW_UNIT,"MainPID") or "0")
                if current>100:
                    if current!=pid:
                        pid=current;stable=time.monotonic()
                    if stable is not None and time.monotonic()-stable>=30:
                        break
            else:
                stable=None
            time.sleep(2)
        else:
            raise RuntimeError("HYPE_CANDIDATE_NOT_STABLE_30_SECONDS")
        bad=journal_bad(start_epoch)
        require(bad is None,"HYPE_CANDIDATE_BAD_JOURNAL:"+str(bad))
        # Let any first-tick pending lifecycle reconcile before final state check.
        for _ in range(20):
            st=read_json(STATE)
            if st.get("manualReview") is not None:
                raise RuntimeError("HYPE_CANDIDATE_MANUAL_REVIEW:"+str(st.get("manualReview"))[:120])
            if st.get("pending") is None:
                break
            time.sleep(2)
        account=signed_account()
        state_and_venue_consistent(account)
        shared_health()
        require(active(NEW_UNIT),"HYPE_CANDIDATE_NOT_ACTIVE_FINAL")
        if not candidate_enabled:
            run(["systemctl","enable",NEW_UNIT],timeout=35)
    except Exception:
        # Only roll back the state/service when the venue is still HYPE/ZEC-flat.
        try:
            account=signed_account()
            if no_hype_sidecar(account):
                run(["systemctl","stop",NEW_UNIT],timeout=65,check=False)
                if not candidate_enabled:
                    run(["systemctl","disable",NEW_UNIT],timeout=35,check=False)
                if old_enabled:
                    run(["systemctl","enable",OLD_UNIT],timeout=35,check=False)
                restore_state(backup)
                print("HYPE_CANDIDATE_ROLLBACK=SAFE_FLAT_ROLLBACK_COMPLETED",file=sys.stderr)
            else:
                run(["systemctl","enable",NEW_UNIT],timeout=35,check=False)
                print("HYPE_CANDIDATE_ROLLBACK=NOT_ATTEMPTED_EXPOSURE_PRESENT_KEEP_CANDIDATE_OWNER",file=sys.stderr)
        except Exception as rollback_error:
            print("HYPE_CANDIDATE_ROLLBACK=INCOMPLETE:"+type(rollback_error).__name__,file=sys.stderr)
        raise

def main(staging: Path, run_id: str, task_id: str) -> None:
    require(os.geteuid()==0,"ROOT_REQUIRED")
    require(run_id.isdecimal() and 1<=len(run_id)<=20,"RUN_ID_INVALID")
    require(len(task_id)==36 and task_id.count("-")==4,"TASK_ID_INVALID")
    require(sha256(TEMPLATE)==TEMPLATE_HASH,"HYPE_SYSTEMD_TEMPLATE_CHANGED")
    shared_health()
    require(not active(OLD_UNIT),"OLD_HYPE_MUST_BE_INACTIVE_BEFORE_CUTOVER")
    if active(NEW_UNIT):
        stage_release(staging,run_id)
        install_runtime_files(task_id,run_id)
        verify_activation_and_selftest()
        account=signed_account()
        state_and_venue_consistent(account)
        require(enabled(NEW_UNIT),"CANDIDATE_HYPE_ACTIVE_BUT_NOT_ENABLED")
        print("HYPE_CANDIDATE_LIVE_CUTOVER=ALREADY_ACTIVE_VERIFIED")
        print("HYPE_ACTIVE_SHA="+CANDIDATE_SHA)
        print("SOURCE_CERT_RUN="+SOURCE_CERT_RUN)
        print("RESIDENT_DOGE_STOP_PRESERVED=TRUE")
        print("HELPER_TEST_ORDERS_SENT=0 HELPER_CANCELS_SENT=0 HELPER_STOP_CHANGES=0")
        return
    before=signed_account()
    require(no_hype_sidecar(before),"HYPE_OR_ZEC_VENUE_NOT_FLAT_BEFORE_CUTOVER")
    preflight_state()
    stage_release(staging,run_id)
    install_runtime_files(task_id,run_id)
    verify_activation_and_selftest()
    backup=migrate_state(run_id)
    after_migration=signed_account()
    if not no_hype_sidecar(after_migration):
        restore_state(backup)
        raise RuntimeError("HYPE_OR_ZEC_VENUE_CHANGED_DURING_STATE_MIGRATION")
    start_candidate(backup)
    print("HYPE_CANDIDATE_LIVE_CUTOVER=SUCCESS")
    print("HYPE_ACTIVE_SHA="+CANDIDATE_SHA)
    print("HYPE_BASE_SHA="+BASE_SHA)
    print("SOURCE_CERT_RUN="+SOURCE_CERT_RUN)
    print("OLD_HYPE_ACTIVE=FALSE")
    print("RESIDENT_DOGE_STOP_PRESERVED=TRUE")
    print("HELPER_TEST_ORDERS_SENT=0 HELPER_CANCELS_SENT=0 HELPER_STOP_CHANGES=0")

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--staging-dir",required=True)
    parser.add_argument("--run-id",required=True)
    parser.add_argument("--task-id",required=True)
    args=parser.parse_args()
    try:
        main(Path(args.staging_dir),args.run_id,args.task_id)
    except Exception as exc:
        print("HYPE_CANDIDATE_LIVE_CUTOVER=BLOCKED:"+type(exc).__name__+":"+str(exc)[:240],file=sys.stderr)
        raise
