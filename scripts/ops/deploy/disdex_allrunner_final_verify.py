#!/usr/bin/env python3
"""Read-only verification for remaining all-runner task stages and final audit."""
from __future__ import annotations
import argparse,json,os,subprocess,time
from pathlib import Path

MAIN="7688ed7c93a1918d8b44837339b7da5584a868f5"
V4="53a0be396719f0284af4e11b35c66a4ac7d58f79"
V52="4d33d8244c0b50a7e461ffd8aaf493c32bfdfd81"
Q102="ef1ab178e26a7bf5bddb6473467765edba242e1d"
HYPE_OVERLAY_SHA="d13b3e12ca833fc139ebbb5860fae0669700674b421c3ded9665935b31f9d55f"
STOP_ID="v12-v4-98ded39746ed3502a4d7b0e26ef9"
BASE=Path("/home/deploy/disdex-trading/releases")
CURRENT=Path("/home/deploy/disdex-trading/current")

SERVICES={
 "V52_VERIFY":(f"disdex-v52-aster-only@{V52}.service",BASE/V52),
 "PENGU_LIVE_VERIFY":(f"disdex-pengu-dual-ls-v2@{MAIN}.service",BASE/MAIN),
 "Q102_LIVE_VERIFY":(f"disdex-quality102-causal-v1@{Q102}.service",BASE/Q102),
 "FET_LIVE_VERIFY":(f"disdex-fet-brk48@{MAIN}.service",BASE/MAIN),
}
ALL_SERVICES={
 "V4":(f"disdex-v12-v4@{V4}.service",BASE/V4),
 "IDLE":(f"disdex-idle-priority-short@{MAIN}.service",BASE/MAIN),
 "HYPE":(f"disdex-hype-long@{MAIN}.service",BASE/MAIN),
 "PENGU":SERVICES["PENGU_LIVE_VERIFY"],
 "FET":SERVICES["FET_LIVE_VERIFY"],
 "Q102":SERVICES["Q102_LIVE_VERIFY"],
 "V52":SERVICES["V52_VERIFY"],
}
KILL=Path("/var/lib/disdex/shared/kill-switch.json")
RISK=Path("/var/lib/disdex/shared/crypto-daily-risk.json")
MARGIN=Path("/var/lib/disdex/shared/margin-risk/guard-live.json")
PENDING=Path("/var/lib/disdex/shared/pending-exposure.json")
HYPE_SELFTEST=Path("/var/lib/disdex/hype-zec-long/runtime-overlays/v4-stop-ownership-v1/selftest.ts")
HYPE_SOURCE=BASE/MAIN/"lib/hype-zec-long-runner.ts"

def req(ok,msg):
    if not ok: raise RuntimeError(msg)

def prop(unit,key):
    p=subprocess.run(["systemctl","show",unit,f"--property={key}","--value"],
                     capture_output=True,text=True,timeout=12)
    req(p.returncode==0,"SYSTEMD_SHOW_FAILED:"+unit)
    return p.stdout.strip()

def verify_service(name,unit,root):
    req(prop(unit,"ActiveState")=="active","RUNNER_NOT_ACTIVE:"+name)
    req(prop(unit,"SubState")=="running","RUNNER_NOT_RUNNING:"+name)
    pid=int(prop(unit,"MainPID") or "0")
    req(pid>100,"RUNNER_PID_INVALID:"+name)
    cwd=os.path.realpath(f"/proc/{pid}/cwd")
    req(cwd==str(root),"RUNNER_CWD_MISMATCH:"+name+":"+cwd)
    return pid

def readj(path):
    req(path.is_file() and not path.is_symlink(),"STATE_INVALID:"+str(path))
    x=json.loads(path.read_text());req(isinstance(x,dict),"STATE_NOT_OBJECT")
    return x

def shared_health():
    req(os.path.realpath(CURRENT)==str(BASE/MAIN),"CURRENT_SHA_MISMATCH")
    k=readj(KILL);req(k.get("active") is False,"KILL_SWITCH_ACTIVE")
    r=readj(RISK);req(r.get("sourceComplete") is True and r.get("tripped") is not True,"SHARED_RISK_BAD")
    m=readj(MARGIN);req(m.get("stage")=="HEALTHY" and m.get("ordersAllowed") is True,"MARGIN_BAD")
    now=int(time.time()*1000);checked=m.get("checkedAt")
    req(type(checked) in (int,float) and -1000 <= now-checked <= 15*60_000,"MARGIN_STALE")
    p=readj(PENDING);entries=p.get("entries")
    req(isinstance(entries,list),"PENDING_INVALID")
    req(not any(isinstance(e,dict) and str(e.get("status","")).upper()!="RELEASED" for e in entries),
        "PENDING_ACTIVE")

def signed_get():
    release=BASE/V4
    cmd=("set -ae; for f in /etc/disdex/disdex-v13d-v11eq-v96.env "
         "/etc/disdex/disdex-v12-pengu-v2-v52.env /etc/disdex/disdex-v12-v4.env; "
         "do . \"$f\"; done; set +a; "
         f"exec /usr/bin/node {release}/node_modules/tsx/dist/cli.mjs "
         "scripts/disdex-aster-readonly-account-diagnostic.ts")
    p=subprocess.run(["/bin/bash","-c",cmd],cwd=release,capture_output=True,text=True,timeout=55)
    req(p.returncode==0,"ASTER_GET_FAILED")
    rows=[x for x in p.stdout.splitlines() if x.startswith("{")];req(rows,"ASTER_GET_EMPTY")
    x=json.loads(rows[-1])
    req(x.get("status")=="ASTER_READONLY_ACCOUNT_DIAGNOSTIC_PASS","ASTER_GET_NOT_PASS")
    req(all(x.get(k)==0 for k in ("ordersSent","cancelsSent","positionChangesSent")),"ASTER_GET_MUTATED")
    pos=x.get("positions") or [];orders=x.get("openOrders") or []
    doge=[p for p in pos if p.get("symbol")=="DOGEUSDT"]
    stop=[o for o in orders if o.get("clientOrderId")==STOP_ID]
    if doge:
        req(len(doge)==1 and float(doge[0].get("positionAmt",0))==-226.0,"DOGE_POSITION_IDENTITY_CHANGED")
        req(len(stop)==1 and stop[0].get("symbol")=="DOGEUSDT" and stop[0].get("side")=="BUY"
            and stop[0].get("type")=="STOP_MARKET" and stop[0].get("reduceOnly") is True
            and float(stop[0].get("origQty",0))==226.0 and float(stop[0].get("executedQty",0))==0.0
            and stop[0].get("status")=="NEW","DOGE_STOP_NOT_PROTECTED")
    else:
        req(not stop,"ORPHAN_DOGE_STOP")
    return x.get("observedAt")

def hype_overlay_verify(pid):
    drop=Path(f"/etc/systemd/system/disdex-hype-long@{MAIN}.service.d/zzzzzzzzzz-v4-stop-ownership-hotfix.conf")
    req(drop.is_file() and not drop.is_symlink(),"HYPE_OVERLAY_DROPIN_MISSING")
    p=subprocess.run(["nsenter","-t",str(pid),"-m","--","sha256sum",str(HYPE_SOURCE)],
                     capture_output=True,text=True,timeout=15)
    req(p.returncode==0 and p.stdout.split()[0]==HYPE_OVERLAY_SHA,"HYPE_OVERLAY_HASH_MISMATCH")
    req(HYPE_SELFTEST.is_file(),"HYPE_SELFTEST_MISSING")
    t=subprocess.run(["nsenter","-t",str(pid),"-m","--",
                      str(BASE/MAIN/"node_modules/.bin/tsx"),"--tsconfig",str(BASE/MAIN/"tsconfig.json"),
                      str(HYPE_SELFTEST)],cwd=BASE/MAIN,capture_output=True,text=True,timeout=45)
    req(t.returncode==0 and "HYPE_V4_STOP_OWNERSHIP_SELFTEST=PASS" in t.stdout,
        "HYPE_OVERLAY_SELFTEST_FAILED")

def verify_step(step):
    shared_health()
    if step in SERVICES:
        unit,root=SERVICES[step];pid=verify_service(step,unit,root)
        print("VERIFIED_UNIT="+unit);print("PID="+str(pid));return
    req(step=="FINAL_ALL_RUNNERS_AUDIT","STEP_NOT_ALLOWED")
    pids={}
    for name,(unit,root) in ALL_SERVICES.items():
        pids[name]=verify_service(name,unit,root)
    req(prop(f"disdex-v52-aster-only@97830672e2f139b39f7194166d7dc8c36e8c8933.service","ActiveState")!="active",
        "OLD_V52_ACTIVE")
    req(prop(f"disdex-v12-v52-margin-guard@{V52}.service","ActiveState")!="active",
        "BROKEN_MARGIN_GUARD_ACTIVE")
    req(prop(f"disdex-v12-v52-margin-guard@{MAIN}.service","ActiveState")=="active",
        "CANONICAL_MARGIN_GUARD_NOT_ACTIVE")
    req(prop(f"disdex-shared-crypto-risk@{MAIN}.service","ActiveState")=="active",
        "SHARED_RISK_SERVICE_NOT_ACTIVE")
    hype_overlay_verify(pids["HYPE"])
    observations=[signed_get() for _ in range(3)]
    req(all(isinstance(x,(int,float)) for x in observations) and len(set(observations))==3,
        "ASTER_OBSERVATIONS_NOT_DISTINCT")
    print("ALL_SEVEN_RUNNERS_ACTIVE=TRUE")
    print("HYPE_V4_STOP_OVERLAY_VERIFIED=TRUE")
    print("SIGNED_ASTER_GETS=3")
    print("KILL_SWITCH_ACTIVE=FALSE")
    print("PENDING_EXPOSURE_ACTIVE=0")
    print("READ_ONLY_FINAL_AUDIT=PASS")

if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--step",choices=[*SERVICES.keys(),"FINAL_ALL_RUNNERS_AUDIT"],required=True)
    a=p.parse_args()
    try:
        verify_step(a.step)
    except Exception as e:
        print("ALLRUNNER_VERIFY_BLOCKED:"+type(e).__name__+":"+str(e)[:250])
        raise
