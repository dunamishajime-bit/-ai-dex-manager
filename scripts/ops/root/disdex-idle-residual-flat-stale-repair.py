#!/usr/bin/env python3
"""Exceptional, one-use root recovery for a stale *flat* IDLE residual state.

Requires a stopped IDLE owner, a still-active Shared Kill Switch, the exact
owner SHA independently pinned by V52, three fresh authenticated Aster GETs,
a known protected DOGE V4 short, no residual LONG or unknown orders, and a
byte-exact root-only backup. No changes to LIVE services or orders.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import time

IDLE_SHA = "7688ed7c93a1918d8b44837339b7da5584a868f5"
V4_SHA = "53a0be396719f0284af4e11b35c66a4ac7d58f79"
V52_SHA = "97830672e2f139b39f7194166d7dc8c36e8c8933"
STATE = Path("/var/lib/disdex/idle-priority/residual-long-state.json")
KILL = Path("/var/lib/disdex/shared/kill-switch.json")
IDLE_UNIT = f"disdex-idle-priority-short@{IDLE_SHA}.service"
V52_UNIT = f"disdex-v52-aster-only@{V52_SHA}.service"
V4_RELEASE = Path("/home/deploy/disdex-trading/releases") / V4_SHA
BACKUP_ROOT = Path("/var/backups/disdex-idle-residual-state")
KNOWN_STOP = "v12-v4-98ded39746ed3502a4d7b0e26ef9"


def _service(unit):
    r = subprocess.run(
        ["/usr/bin/systemctl","show",unit,"--value","--property=ActiveState"],
        capture_output=True,text=True,check=False,timeout=12)
    if r.returncode:raise RuntimeError("SERVICE_STATE_UNAVAILABLE")
    return r.stdout.strip()


def _check_venue(d):
    if d.get("status") != "ASTER_READONLY_ACCOUNT_DIAGNOSTIC_PASS":
        raise ValueError("SIGNED_ACCOUNT_DIAGNOSTIC_FAILED")
    if any(d.get(k) != 0 for k in ("ordersSent","cancelsSent","positionChangesSent")):
        raise ValueError("VENUE_READONLY_VIOLATED")
    positions=d.get("positions") or []
    orders=d.get("openOrders") or []
    if len(positions)!=1 or len(orders)!=1:
        raise ValueError("UNEXPECTED_LIVE_POSITION_OR_OPEN_ORDER")
    p=positions[0];s=orders[0]
    result={
        "symbol":p.get("symbol"),"positionSide":p.get("positionSide"),
        "positionAmt":float(p.get("positionAmt",0)),
        "entryPrice":float(p.get("entryPrice",0)),
        "stopSymbol":s.get("symbol"),"clientOrderId":s.get("clientOrderId"),
        "stopType":s.get("type"),"stopSide":s.get("side"),
        "origQty":float(s.get("origQty",0)),
        "executedQty":float(s.get("executedQty",0)),
        "reduceOnly":s.get("reduceOnly"),"status":s.get("status"),
    }
    expected={
        "symbol":"DOGEUSDT","positionSide":"BOTH",
        "positionAmt":-226.0,"entryPrice":0.08052,
        "stopSymbol":"DOGEUSDT","clientOrderId":KNOWN_STOP,
        "stopType":"STOP_MARKET","stopSide":"BUY",
        "origQty":226.0,"executedQty":0.0,
        "reduceOnly":True,"status":"NEW",
    }
    if result != expected:
        raise ValueError("V4_RESIDENT_STOP_OR_POSITION_MISMATCH")
    return hashlib.sha256(json.dumps(result,sort_keys=True).encode()).hexdigest()


def _readstate():
    st = STATE.lstat()
    if not stat.S_ISREG(st.st_mode) or st.st_uid==0 or (st.st_mode & 0o077):
        raise ValueError("IDLE_STATE_UNSAFE_FILE_OWNER_OR_MODE")
    data = STATE.read_bytes()
    if len(data) > 65536:raise ValueError("IDLE_STATE_TOO_LARGE")
    obj = json.loads(data)
    if (set(obj) - {"schema","runtimeSha","updatedAt","position","pending",
                    "manualReview","failures","lastDecision"}):
        raise ValueError("IDLE_STATE_UNKNOWN_FIELDS")
    if obj.get("schema")!="disdex-idle-residual-long-state/v1" or obj.get("runtimeSha")!=IDLE_SHA:
        raise ValueError("IDLE_STATE_SCHEMA_OR_SHA_MISMATCH")
    if any(obj.get(k) is not None for k in ("position","pending","manualReview")):
        raise ValueError("IDLE_STATE_HAS_EXPOSURE_OR_REVIEW")
    if type(obj.get("updatedAt")) not in (int,float) or obj["updatedAt"]>time.time()*1000+1000:
        raise ValueError("IDLE_STATE_TIMESTAMP_INVALID")
    return st,data,obj


def _v52_owner_pin():
    r=subprocess.run(["/usr/bin/systemctl","show",V52_UNIT,"--value",
                      "--property=MainPID"],capture_output=True,text=True,timeout=12)
    if r.returncode or not r.stdout.strip().isdigit() or int(r.stdout.strip())<=100:
        raise ValueError("V52_NOT_ACTIVE")
    pid=r.stdout.strip()
    values=Path("/proc")/pid/"environ"
    env={}
    for pair in values.read_bytes().split(b"\0"):
        if b"=" in pair:
            k,v=pair.split(b"=",1)
            env[k]=v
    if env.get(b"DISDEX_IDLE_PRIORITY_RUNTIME_SHA",b"").decode()!=IDLE_SHA:
        raise ValueError("IDLE_OWNER_PIN_NOT_MATCHED_IN_LIVE_V52")
    return True


def _check_static():
    if os.geteuid()!=0:raise ValueError("ROOT_REQUIRED")
    if _service(IDLE_UNIT)!="failed":raise ValueError("IDLE_OWNER_NOT_FAILED")
    if _service(V52_UNIT)!="active":raise ValueError("V52_NOT_RUNNING")
    _v52_owner_pin()
    x=json.loads(KILL.read_text())
    if x.get("active") is not True:
        raise ValueError("SHARED_KILL_SWITCH_NOT_ACTIVE_DURING_REPAIR")


def _signed_get():
    source=(
        "set -ae; for f in "
        "/etc/disdex/disdex-v13d-v11eq-v96.env "
        "/etc/disdex/disdex-v12-pengu-v2-v52.env "
        "/etc/disdex/disdex-v12-v4.env; do . \"$f\"; done; set +a; "
        "exec /usr/bin/node "+str(V4_RELEASE/"node_modules/tsx/dist/cli.mjs")+
        " scripts/disdex-aster-readonly-account-diagnostic.ts"
    )
    r=subprocess.run(["/bin/bash","-c",source],cwd=V4_RELEASE,capture_output=True,
                     text=True,encoding="utf8",errors="replace",timeout=35)
    if r.returncode:raise ValueError("ASTER_SIGNED_GET_FAILED")
    data=[x for x in r.stdout.splitlines() if x.startswith("{")]
    if not data:raise ValueError("ASTER_SIGNED_GET_MISSING_RESULT")
    d=json.loads(data[-1])
    digest=_check_venue(d)
    return {"observedAt":d.get("observedAt"),"stopContractDigest":digest}


def _prove():
    observations=[]
    for _ in range(3):
        observations.append(_signed_get())
        time.sleep(1)
    times=[x["observedAt"] for x in observations]
    if any(type(x) is not int for x in times) or times!=sorted(set(times)):
        raise ValueError("ASTER_SIGNED_OBSERVATIONS_NOT_INCREASING")
    if len({x["stopContractDigest"] for x in observations}) != 1:
        raise ValueError("RESIDENT_STOP_NOT_STABLE")
    return observations


def run(commit=False):
    _check_static()
    stat_before, raw_before, state = _readstate()
    if time.time()*1000-state["updatedAt"] < 3*60*60*1000:
        raise ValueError("IDLE_STATE_NOT_STALE")
    proof=_prove()
    _check_static()
    now_stat, now_bytes, now_state = _readstate()
    if (now_bytes!=raw_before or now_stat.st_ino!=stat_before.st_ino or
        now_stat.st_mtime_ns!=stat_before.st_mtime_ns):
        raise ValueError("IDLE_STATE_CHANGED_DURING_VENUE_PROOF")
    result={
      "status":"READ_ONLY_PROOF_PASS_NO_CHANGE" if not commit else "IDLE_FLAT_STALE_RECOVERED",
      "oldSha256":hashlib.sha256(raw_before).hexdigest(),
      "stateOwnerSha":IDLE_SHA,
      "signedObservations":proof,
      "ordersSent":0,"cancelsSent":0,"positionChangesSent":0,
    }
    if not commit:return result
    BACKUP_ROOT.mkdir(mode=0o700,parents=True,exist_ok=True)
    if BACKUP_ROOT.stat().st_uid!=0 or BACKUP_ROOT.stat().st_mode & 0o077:
        raise ValueError("BACKUP_ROOT_UNTRUSTED")
    backup=BACKUP_ROOT/("idle-flat-"+str(int(time.time()*1000))+".json")
    with os.fdopen(os.open(backup,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600),"wb") as f:
        f.write(raw_before); f.flush(); os.fsync(f.fileno())
    if backup.read_bytes()!=raw_before:raise ValueError("BACKUP_NOT_EXACT")
    new=dict(state,updatedAt=int(time.time()*1000))
    tmp=STATE.parent/(".residual-flat-verified-"+str(os.getpid())+".tmp")
    if tmp.exists() or tmp.is_symlink():raise ValueError("TMP_PATH_EXISTS")
    new_bytes=(json.dumps(new,indent=2)+"\n").encode()
    try:
        with os.fdopen(os.open(tmp,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600),"wb") as f:
            f.write(new_bytes);f.flush();os.fsync(f.fileno())
        os.chown(tmp,stat_before.st_uid,stat_before.st_gid)
        if STATE.read_bytes()!=raw_before or STATE.lstat().st_ino!=stat_before.st_ino:
            raise ValueError("CONCURRENT_IDLE_STATE_WRITER")
        _check_static()
        os.replace(tmp,STATE)
        if STATE.read_bytes()!=new_bytes or STATE.stat().st_uid!=stat_before.st_uid:
            raise ValueError("STATE_READBACK_FAILED_REQUIRES_MANUAL_REVIEW")
    finally:
        if tmp.exists():tmp.unlink()
    result["backupPath"]=str(backup)
    result["newSha256"]=hashlib.sha256(new_bytes).hexdigest()
    result["stateUpdatedAt"]=new["updatedAt"]
    return result


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--execute-after-three-signed-gets",action="store_true")
    args=parser.parse_args()
    try:
        print(json.dumps(run(args.execute_after_three_signed_gets),sort_keys=True))
    except Exception as e:
        print(json.dumps({"status":"BLOCKED","reason":str(e)[:220],
                          "ordersSent":0,"cancelsSent":0,
                          "positionChangesSent":0}),file=sys.stderr)
        return 1
    return 0


if __name__=="__main__":
    raise SystemExit(main())
