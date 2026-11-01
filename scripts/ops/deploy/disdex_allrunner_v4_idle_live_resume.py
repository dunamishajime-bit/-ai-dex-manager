#!/usr/bin/env python3
"""Start an already-certified V4, IDLE, or HYPE runner under the all-runner task.

This helper never places a test order and never changes venue orders, positions,
STOPs, Kill Switch state, operator activation, strategy files, or risk limits.
It relies on the existing systemd ExecStartPre gates and independently proves
shared risk and a fresh signed venue-flat snapshot before and after start.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time

BASE=Path("/home/deploy/disdex-trading/releases")
MAIN="7688ed7c93a1918d8b44837339b7da5584a868f5"
V4="53a0be396719f0284af4e11b35c66a4ac7d58f79"
V52="4d33d8244c0b50a7e461ffd8aaf493c32bfdfd81"
KILL=Path("/var/lib/disdex/shared/kill-switch.json")
RISK=Path("/var/lib/disdex/shared/crypto-daily-risk.json")
MARGIN=Path("/var/lib/disdex/shared/margin-risk/guard-live.json")
PENDING=Path("/var/lib/disdex/shared/pending-exposure.json")
IDLE_STATE=Path("/var/lib/disdex/idle-priority/residual-long-state.json")
V52_UNIT=f"disdex-v52-aster-only@{V52}.service"
MARGIN_UNIT=f"disdex-v12-v52-margin-guard@{MAIN}.service"

RUNNERS={
    "V4":{
        "unit":f"disdex-v12-v4@{V4}.service",
        "sha":V4,
        "root":BASE/V4,
        "activation":Path("/var/lib/disdex/shared/operator-activation/v12-v4-full.json"),
        "activation_runner":"V12_V4",
    },
    "IDLE":{
        "unit":f"disdex-idle-priority-short@{MAIN}.service",
        "sha":MAIN,
        "root":Path("/home/deploy/disdex-trading/current"),
        "activation":Path("/var/lib/disdex/shared/operator-activation/current.json"),
        "activation_runner":"IDLE_PRIORITY_SHORT",
    },
    "HYPE":{
        "unit":f"disdex-hype-long@{MAIN}.service",
        "sha":MAIN,
        "root":BASE/MAIN,
        "activation":Path("/var/lib/disdex/shared/operator-activation/current.json"),
        "activation_runner":"HYPE_TREND_LONG",
    },
}

def require(ok: bool, reason: str) -> None:
    if not ok:
        raise RuntimeError(reason)

def json_file(path: Path) -> dict:
    require(path.is_file() and not path.is_symlink(),"STATE_FILE_INVALID:"+str(path))
    value=json.loads(path.read_text())
    require(isinstance(value,dict),"STATE_NOT_OBJECT:"+str(path))
    return value

def prop(unit: str,key: str) -> str:
    p=subprocess.run(["systemctl","show",unit,f"--property={key}","--value"],
                     capture_output=True,text=True,timeout=15)
    require(p.returncode==0,"SYSTEMD_PROPERTY_FAILED:"+unit)
    return p.stdout.strip()

def active(unit: str) -> bool:
    return prop(unit,"ActiveState")=="active"

def shared_health(runner: str) -> None:
    kill=json_file(KILL)
    require(kill.get("active") is False,"SHARED_KILL_SWITCH_ACTIVE")
    risk=json_file(RISK)
    require(risk.get("sourceComplete") is True and risk.get("tripped") is not True,
            "SHARED_RISK_NOT_HEALTHY")
    margin=json_file(MARGIN)
    require(margin.get("stage")=="HEALTHY" and margin.get("ordersAllowed") is True,
            "MARGIN_GUARD_NOT_HEALTHY")
    checked=margin.get("checkedAt")
    now=int(time.time()*1000)
    require(type(checked) in (int,float) and -1000 <= now-checked <= 15*60_000,
            "MARGIN_GUARD_STALE")
    pending=json_file(PENDING)
    entries=pending.get("entries")
    require(isinstance(entries,list),"PENDING_EXPOSURE_INVALID")
    require(not any(isinstance(e,dict) and str(e.get("status","")).upper()!="RELEASED" for e in entries),
            "PENDING_EXPOSURE_ACTIVE")
    require(active(V52_UNIT),"V52_NOT_ACTIVE")
    require(active(MARGIN_UNIT),"CANONICAL_MARGIN_GUARD_NOT_ACTIVE")
    if runner=="IDLE":
        state=json_file(IDLE_STATE)
        require(state.get("schema")=="disdex-idle-residual-long-state/v1","IDLE_SCHEMA_INVALID")
        require(state.get("runtimeSha")==MAIN,"IDLE_OWNER_SHA_INVALID")
        require(all(state.get(k) is None for k in ("position","pending","manualReview")),
                "IDLE_STATE_NOT_FLAT")
        updated=state.get("updatedAt")
        require(type(updated) in (int,float) and -1000 <= now-updated <= 20*60_000,
                "IDLE_STATE_STALE_REPAIR_REQUIRED")

def activation_ready(spec: dict) -> None:
    gate=spec["root"]/ "scripts/ops/root/disdex-live-operator-activation-gate.mjs"
    require(gate.is_file(),"ACTIVATION_GATE_MISSING")
    p=subprocess.run([
        "/usr/bin/node",str(gate),
        "--release-root",str(spec["root"]),
        "--sha",spec["sha"],
        "--runner",spec["activation_runner"],
        "--activation-path",str(spec["activation"]),
    ],capture_output=True,text=True,timeout=30)
    require(p.returncode==0,"OPERATOR_ACTIVATION_BLOCKED:"+p.stderr[-180:])

def signed_get() -> dict:
    release=BASE/V4
    command=(
      "set -ae; for f in "
      "/etc/disdex/disdex-v13d-v11eq-v96.env "
      "/etc/disdex/disdex-v12-pengu-v2-v52.env "
      "/etc/disdex/disdex-v12-v4.env; do . \"$f\"; done; set +a; "
      f"exec /usr/bin/node {release}/node_modules/tsx/dist/cli.mjs "
      "scripts/disdex-aster-readonly-account-diagnostic.ts"
    )
    p=subprocess.run(["/bin/bash","-c",command],cwd=release,
                     capture_output=True,text=True,timeout=55)
    require(p.returncode==0,"ASTER_SIGNED_GET_FAILED")
    rows=[line for line in p.stdout.splitlines() if line.startswith("{")]
    require(rows,"ASTER_SIGNED_GET_EMPTY")
    value=json.loads(rows[-1])
    require(isinstance(value,dict),"ASTER_SIGNED_GET_NOT_OBJECT")
    require(value.get("status")=="ASTER_READONLY_ACCOUNT_DIAGNOSTIC_PASS",
            "ASTER_SIGNED_GET_NOT_PASS")
    now=int(time.time()*1000)
    for key in ("observedAt","venueTime"):
        observed=value.get(key)
        require(type(observed) is int and observed>0 and -5000<=now-observed<=30000,
                "ASTER_SIGNED_GET_STALE_OR_INVALID:"+key)
    require(all(type(value.get(k)) is int and value[k]==0
                for k in ("ordersSent","cancelsSent","positionChangesSent")),
            "DIAGNOSTIC_WAS_NOT_READ_ONLY")
    positions=value.get("positions")
    orders=value.get("openOrders")
    require(isinstance(positions,list) and all(isinstance(row,dict) for row in positions),
            "ASTER_SIGNED_GET_POSITIONS_INVALID")
    require(isinstance(orders,list) and all(isinstance(row,dict) for row in orders),
            "ASTER_SIGNED_GET_ORDERS_INVALID")
    require(len(positions)==0 and len(orders)==0, "ASTER_ACCOUNT_NOT_FLAT")
    return {
      "observedAt":value.get("observedAt"),
      "positionCount":len(positions),
      "openOrderCount":len(orders),
    }

def stable_start(spec: dict) -> tuple[int,bool]:
    unit=spec["unit"]
    already=active(unit)
    if already:
        pid=int(prop(unit,"MainPID") or "0")
        require(pid>100,"ACTIVE_RUNNER_PID_INVALID")
        return pid,True
    subprocess.run(["systemctl","reset-failed",unit],check=False,timeout=15)
    p=subprocess.run(["systemctl","start",unit],capture_output=True,text=True,timeout=110)
    require(p.returncode==0,"SYSTEMD_START_FAILED:"+p.stderr[-160:])
    deadline=time.monotonic()+65
    pid=0
    stable_since=None
    while time.monotonic()<deadline:
        state=prop(unit,"ActiveState")
        current=int(prop(unit,"MainPID") or "0")
        if state=="active" and current>100:
            if current!=pid:
                pid=current;stable_since=time.monotonic()
            if stable_since is not None and time.monotonic()-stable_since>=25:
                return pid,False
        else:
            stable_since=None
        time.sleep(2)
    raise RuntimeError("RUNNER_NOT_STABLE_25_SECONDS")

def main(runner: str,run_id: str) -> None:
    require(os.geteuid()==0,"ROOT_REQUIRED")
    require(run_id.isdecimal() and len(run_id)<21,"RUN_ID_INVALID")
    require(runner in RUNNERS,"RUNNER_NOT_ALLOWED")
    spec=RUNNERS[runner]
    shared_health(runner)
    activation_ready(spec)
    before=signed_get()
    pid,already=stable_start(spec)
    shared_health(runner)
    after=signed_get()
    require(active(spec["unit"]) and int(prop(spec["unit"],"MainPID"))==pid,
            "RUNNER_CHANGED_AFTER_VENUE_PROOF")
    print("ALLRUNNER_LIVE_RESUME=ALREADY_ACTIVE_VERIFIED" if already
          else "ALLRUNNER_LIVE_RESUME=SUCCESS")
    print("RUNNER="+runner)
    print("UNIT="+spec["unit"])
    print("PID="+str(pid))
    print("ASTER_PRE_OBSERVED="+str(before["observedAt"]))
    print("ASTER_POST_OBSERVED="+str(after["observedAt"]))
    print("ASTER_FLAT_BEFORE_AFTER=TRUE")
    print("ORDERS_SENT_BY_HELPER=0 CANCELS_SENT_BY_HELPER=0 STOP_CHANGES_BY_HELPER=0")

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--runner",choices=sorted(RUNNERS),required=True)
    parser.add_argument("--run-id",required=True)
    args=parser.parse_args()
    try:
        main(args.runner,args.run_id)
    except Exception as exc:
        print("ALLRUNNER_LIVE_RESUME=BLOCKED:"+type(exc).__name__+":"+str(exc)[:220],
              file=sys.stderr)
        raise
