#!/usr/bin/env python3
from __future__ import annotations
import json, math, os, subprocess, sys, time
from datetime import datetime, timezone
from pathlib import Path

IDLE_SHA="7688ed7c93a1918d8b44837339b7da5584a868f5"
V4_SHA="3ad65403013b701db5d9e53e8814e6ab827a28e8"
IDLE_UNIT=f"disdex-idle-priority-short@{IDLE_SHA}.service"
STATE=Path("/var/lib/disdex/idle-priority/residual-long-state.json")
CORE_STATE=Path("/var/lib/disdex/idle-priority/state.json")
TIMEOUT_REVIEW="IDLE_RUNNER_FAIL_CLOSED:Aster request timeout after 10000ms"
KILL=Path("/var/lib/disdex/shared/kill-switch.json")
RISK=Path("/var/lib/disdex/shared/crypto-daily-risk.json")
MARGIN=Path("/var/lib/disdex/shared/margin-risk/guard-live.json")
PENDING=Path("/var/lib/disdex/shared/pending-exposure.json")
PIN=Path("/etc/disdex/runner-pins.json")
ACT=Path("/var/lib/disdex/shared/operator-activation/current.json")
BASE=Path("/home/deploy/disdex-trading/releases")

def req(ok,reason):
    if not ok: raise RuntimeError(reason)

def readj(p):
    req(p.is_file() and not p.is_symlink(),"FILE_INVALID:"+str(p))
    v=json.loads(p.read_text()); req(isinstance(v,dict),"JSON_INVALID:"+str(p)); return v

def prop(unit,key):
    p=subprocess.run(["systemctl","show",unit,f"--property={key}","--value"],capture_output=True,text=True,timeout=15)
    req(p.returncode==0,"SYSTEMD_SHOW_FAILED"); return p.stdout.strip()

def active(unit): return prop(unit,"ActiveState")=="active"

def health():
    now=int(time.time()*1000)
    req(readj(KILL).get("active") is False,"KILL_SWITCH_ACTIVE")
    risk=readj(RISK)
    req(risk.get("sourceComplete") is True and risk.get("tripped") is False,"SHARED_RISK_NOT_HEALTHY")
    req(risk.get("utcDay")==datetime.fromtimestamp(now/1000,timezone.utc).date().isoformat(),"RISK_DAY")
    req(type(risk.get("updatedAt")) is int and -1000<=now-risk["updatedAt"]<=15*60_000,"RISK_STALE")
    req(abs(float(risk.get("maximumLossPct"))-7.5)<1e-9,"RISK_LIMIT")
    margin=readj(MARGIN)
    req(margin.get("stage")=="HEALTHY" and margin.get("ordersAllowed") is True,"MARGIN_NOT_HEALTHY")
    req(type(margin.get("checkedAt")) is int and -1000<=now-margin["checkedAt"]<=15*60_000,"MARGIN_STALE")
    pending=readj(PENDING)
    req(type(pending.get("updatedAt")) is int and -1000<=now-pending["updatedAt"]<=5*60_000,"PENDING_STALE")
    rows=pending.get("entries"); req(isinstance(rows,list),"PENDING_INVALID")
    req(not any(str(x.get("status","")).upper()!="RELEASED" for x in rows if isinstance(x,dict)),"PENDING_ACTIVE")

def gate():
    pins=readj(PIN); row=pins.get("runners",{}).get("IDLE_PRIORITY_SHORT",{})
    req(row.get("sha")==IDLE_SHA and row.get("serviceUnit")==IDLE_UNIT,"IDLE_PIN_MISMATCH")
    marker=BASE/IDLE_SHA/".disdex-release-sha"
    req(marker.is_file() and marker.read_text().strip()==IDLE_SHA,"IDLE_RELEASE_MISMATCH")
    g=BASE/IDLE_SHA/"scripts/ops/root/disdex-live-operator-activation-gate.mjs"
    p=subprocess.run(["/usr/bin/node",str(g),"--release-root",str(BASE/IDLE_SHA),"--sha",IDLE_SHA,
        "--runner","IDLE_PRIORITY_SHORT","--activation-path",str(ACT)],capture_output=True,text=True,timeout=30)
    req(p.returncode==0,"IDLE_ACTIVATION_BLOCKED:"+(p.stderr or p.stdout)[-180:])

def signed_flat():
    rel=BASE/V4_SHA
    cmd=(
      "set -ae; for f in /etc/disdex/disdex-v13d-v11eq-v96.env /etc/disdex/disdex-v12-pengu-v2-v52.env "
      "/etc/disdex/disdex-v12-v4.env "
      f"/etc/disdex/current-runtime/{V4_SHA}.env; do . \"$f\"; done; set +a; "
      "export DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH=/var/lib/disdex/shared/aster-rate-budget.json; "
      f"cd {rel}; exec /usr/sbin/runuser -u deploy --preserve-environment -- /usr/bin/node "
      f"{rel}/node_modules/tsx/dist/cli.mjs scripts/disdex-aster-readonly-account-diagnostic.ts"
    )
    last=""
    for i in range(6):
        p=subprocess.run(["/bin/bash","-c",cmd],capture_output=True,text=True,timeout=55)
        last=(p.stdout or "")+"\n"+(p.stderr or "")
        if p.returncode==0:
            rows=[x for x in p.stdout.splitlines() if x.startswith("{")]
            req(rows,"ASTER_EMPTY")
            v=json.loads(rows[-1]); req(v.get("status")=="ASTER_READONLY_ACCOUNT_DIAGNOSTIC_PASS","ASTER_NOT_PASS")
            req(v.get("ordersSent")==v.get("cancelsSent")==v.get("positionChangesSent")==0,"ASTER_NOT_READONLY")
            req(v.get("positions")==[] and v.get("openOrders")==[],"ASTER_NOT_FLAT")
            return v.get("observedAt")
        if "ASTER_GLOBAL_RATE_BUDGET" not in last or i==5: break
        time.sleep(1.5)
    raise RuntimeError("ASTER_SIGNED_FLAT_FAILED:"+last[-220:].replace("\n"," "))

def repair(run_id):
    raw=STATE.read_bytes(); st=STATE.stat(); d=json.loads(raw)
    req(d.get("schema")=="disdex-idle-residual-long-state/v1","IDLE_SCHEMA")
    req(d.get("runtimeSha")==IDLE_SHA,"IDLE_SHA")
    req(all(d.get(k) is None for k in ("position","pending","manualReview")),"IDLE_NOT_FLAT")
    now=int(time.time()*1000)
    old=d.get("updatedAt"); req(type(old) is int and old>0 and old<=now+1000,"IDLE_UPDATED_INVALID")
    backup=STATE.with_name(STATE.name+f".before-current-flat-stale-repair-{run_id}")
    fd=os.open(backup,os.O_CREAT|os.O_EXCL|os.O_WRONLY,st.st_mode & 0o777)
    try:
        os.write(fd,raw); os.fsync(fd)
    finally: os.close(fd)
    os.chown(backup,st.st_uid,st.st_gid)
    d["updatedAt"]=now
    out=(json.dumps(d,indent=2)+"\n").encode()
    tmp=STATE.with_name(STATE.name+f".{run_id}.tmp")
    fd=os.open(tmp,os.O_CREAT|os.O_EXCL|os.O_WRONLY,st.st_mode & 0o777)
    try:
        os.write(fd,out); os.fsync(fd)
    finally: os.close(fd)
    os.chown(tmp,st.st_uid,st.st_gid)
    req(STATE.read_bytes()==raw,"IDLE_STATE_CAS")
    os.replace(tmp,STATE)
    req(readj(STATE).get("updatedAt")==now,"IDLE_REPAIR_READBACK")
    return old,now,str(backup)

def repair_core_timeout(run_id):
    raw=CORE_STATE.read_bytes(); st=CORE_STATE.stat(); d=json.loads(raw)
    req(d.get("schema")=="disdex-idle-priority-state/v2","IDLE_CORE_SCHEMA")
    req(d.get("runtimeSha")==IDLE_SHA,"IDLE_CORE_SHA")
    req(d.get("positions")==[] and d.get("pending") is None,"IDLE_CORE_NOT_FLAT")
    review=d.get("manualReview")
    if review is None:
        return False,None
    req(review==TIMEOUT_REVIEW,"IDLE_CORE_REVIEW_NOT_EXACT_TIMEOUT")
    failures=d.get("failures"); req(isinstance(failures,list),"IDLE_CORE_FAILURES_INVALID")
    now=int(time.time()*1000)
    backup=CORE_STATE.with_name(CORE_STATE.name+f".before-signed-flat-timeout-recovery-{run_id}")
    fd=os.open(backup,os.O_CREAT|os.O_EXCL|os.O_WRONLY,st.st_mode & 0o777)
    try:
        os.write(fd,raw); os.fsync(fd)
    finally: os.close(fd)
    os.chown(backup,st.st_uid,st.st_gid)
    d["manualReview"]=None
    d["updatedAt"]=now
    d["failures"]=[*failures,{"message":"IDLE_BENIGN_SIGNED_FLAT_TIMEOUT_RECOVERY","occurredAt":now}][-100:]
    out=(json.dumps(d,indent=2)+"\n").encode()
    tmp=CORE_STATE.with_name(CORE_STATE.name+f".{run_id}.timeout-recovery.tmp")
    fd=os.open(tmp,os.O_CREAT|os.O_EXCL|os.O_WRONLY,st.st_mode & 0o777)
    try:
        os.write(fd,out); os.fsync(fd)
    finally: os.close(fd)
    os.chown(tmp,st.st_uid,st.st_gid)
    req(CORE_STATE.read_bytes()==raw,"IDLE_CORE_STATE_CAS")
    os.replace(tmp,CORE_STATE)
    after=readj(CORE_STATE)
    req(after.get("manualReview") is None and after.get("updatedAt")==now,"IDLE_CORE_RECOVERY_READBACK")
    return True,str(backup)

def main(run_id):
    req(os.geteuid()==0,"ROOT_REQUIRED"); req(run_id.isdecimal(),"RUN_ID")
    health(); gate(); before=signed_flat()
    coreRecovered,coreBackup=repair_core_timeout(run_id)
    old,new,backup=repair(run_id)
    health(); gate()
    p=subprocess.run(["systemctl","reset-failed",IDLE_UNIT],capture_output=True,text=True,timeout=15)
    req(p.returncode==0,"IDLE_RESET_FAILED")
    time.sleep(3)
    if not active(IDLE_UNIT):
        p=subprocess.run(["systemctl","start",IDLE_UNIT],capture_output=True,text=True,timeout=75)
        req(p.returncode==0,"IDLE_START_FAILED:"+(p.stderr or p.stdout)[-180:])
    deadline=time.time()+30
    while time.time()<deadline and not active(IDLE_UNIT): time.sleep(1)
    req(active(IDLE_UNIT),"IDLE_NOT_ACTIVE")
    pid=int(prop(IDLE_UNIT,"MainPID") or "0"); req(pid>100,"IDLE_PID_INVALID")
    time.sleep(5); req(active(IDLE_UNIT) and int(prop(IDLE_UNIT,"MainPID") or "0")==pid,"IDLE_NOT_STABLE")
    after=signed_flat()
    print(json.dumps({"status":"IDLE_CURRENT_FLAT_STALE_REPAIR_LIVE_PASS","pid":pid,"oldUpdatedAt":old,
      "newUpdatedAt":new,"backup":backup,"coreTimeoutRecovered":coreRecovered,"coreBackup":coreBackup,
      "signedBefore":before,"signedAfter":after,
      "ordersSentByHelper":0,"cancelsSentByHelper":0,"stopChangesByHelper":0},sort_keys=True))

if __name__=="__main__":
    try: main(sys.argv[1])
    except Exception as e:
        print("IDLE_CURRENT_FLAT_STALE_REPAIR=BLOCKED:"+type(e).__name__+":"+str(e)[:300],file=sys.stderr); raise
