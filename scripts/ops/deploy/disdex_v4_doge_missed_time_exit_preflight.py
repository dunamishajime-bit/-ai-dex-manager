#!/usr/bin/env python3
"""Read-only preflight for the single missed V4 DOGE TIME exit.

This tool never sends/cancels orders and never edits V4 state. It proves that
the durable V4 leg, planned TIME exit, protected STOP, shared risk state and
signed Aster venue state still match the incident being reviewed.
"""
from __future__ import annotations
import argparse, json, pathlib, subprocess, time

V4_SHA="53a0be396719f0284af4e11b35c66a4ac7d58f79"
MAIN_SHA="7688ed7c93a1918d8b44837339b7da5584a868f5"
LEG_ID="DOGEUSDT:REC_Y06_REV_D0_T72:SHORT:1793181600000"
STOP_ID="v12-v4-98ded39746ed3502a4d7b0e26ef9"
STORE=pathlib.Path("/var/lib/disdex/v12-v4/orders.json")
HEARTBEAT=pathlib.Path("/var/lib/disdex/v12-v4/heartbeat.json")
KILL=pathlib.Path("/var/lib/disdex/shared/kill-switch.json")
RISK=pathlib.Path("/var/lib/disdex/shared/crypto-daily-risk.json")
MARGIN=pathlib.Path("/var/lib/disdex/shared/margin-risk/guard-live.json")
PENDING=pathlib.Path("/var/lib/disdex/shared/pending-exposure.json")
V4_UNIT=f"disdex-v12-v4@{V4_SHA}.service"

def req(ok, why):
    if not ok: raise RuntimeError(why)

def same(a,b):
    return abs(float(a)-float(b)) <= max(1e-8,abs(float(b))*1e-7)

def service_state(unit):
    p=subprocess.run(["systemctl","is-active",unit],capture_output=True,text=True,timeout=10)
    state=p.stdout.strip() or "unknown"
    pid=subprocess.run(["systemctl","show",unit,"-p","MainPID","--value"],capture_output=True,text=True,timeout=10)
    try: main_pid=int((pid.stdout or "0").strip() or "0")
    except ValueError: main_pid=-1
    return state,main_pid

def read(path):
    req(path.is_file() and not path.is_symlink(),"UNTRUSTED_FILE:"+str(path))
    v=json.loads(path.read_text())
    req(isinstance(v,dict),"JSON_NOT_OBJECT:"+str(path))
    return v

def signed_get():
    root=f"/home/deploy/disdex-trading/releases/{V4_SHA}"
    cmd=(
        "set -ae; "
        "for f in /etc/disdex/disdex-v13d-v11eq-v96.env "
        "/etc/disdex/disdex-v12-pengu-v2-v52.env "
        "/etc/disdex/disdex-v12-v4.env; do . \"$f\"; done; set +a; "
        f"cd {root}; exec /usr/bin/node node_modules/tsx/dist/cli.mjs "
        "scripts/disdex-aster-readonly-account-diagnostic.ts"
    )
    p=subprocess.run(["/bin/bash","-c",cmd],capture_output=True,text=True,timeout=55)
    req(p.returncode==0,"ASTER_READONLY_FAILED")
    rows=[x for x in p.stdout.splitlines() if x.startswith("{")]
    req(rows,"ASTER_READONLY_EMPTY")
    d=json.loads(rows[-1])
    req(d.get("status")=="ASTER_READONLY_ACCOUNT_DIAGNOSTIC_PASS","ASTER_NOT_PASS")
    req(all(d.get(k)==0 for k in ("ordersSent","cancelsSent","positionChangesSent")),
        "ASTER_DIAGNOSTIC_MUTATED_ACCOUNT")
    return d

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--allow-quiesced",action="store_true",
        help="Allow inactive/failed exact V4 unit only when MainPID is zero. Read-only recovery handoff mode.")
    args=parser.parse_args()
    v4_state,v4_pid=service_state(V4_UNIT)
    if args.allow_quiesced:
        req(v4_state=="active" or (v4_state in {"inactive","failed"} and v4_pid==0),
            "V4_NOT_ACTIVE_OR_SAFELY_QUIESCED")
    else:
        req(v4_state=="active","V4_NOT_ACTIVE")
    req(pathlib.Path("/home/deploy/disdex-trading/current/.disdex-release-sha").read_text().strip()==MAIN_SHA,
        "CURRENT_SHA_CHANGED")
    store=read(STORE)
    req(store.get("releaseSha")==V4_SHA,"STORE_SHA_CHANGED")
    leg=(store.get("state") or {}).get("legs",{}).get(LEG_ID)
    req(isinstance(leg,dict) and leg.get("status")=="OPEN" and same(leg.get("qty"),226),
        "DOGE_LEG_NOT_EXACT_OPEN_226")
    c=leg.get("candidate") or {}
    req(c.get("symbol")=="DOGEUSDT" and c.get("route")=="REC_Y06_REV_D0_T72"
        and c.get("effectiveSide")=="SHORT","DOGE_LEG_IDENTITY_CHANGED")
    planned=leg.get("plannedExit") or {}
    req(planned.get("reason")=="TIME" and planned.get("priceModelOnly") is True,
        "PLANNED_EXIT_REASON_CHANGED")
    req(int(planned.get("exitTs",0))==1793440800000 and same(planned.get("price"),0.07505),
        "PLANNED_EXIT_TIME_OR_PRICE_CHANGED")
    prot=(store.get("protections") or {}).get(LEG_ID) or {}
    req(prot.get("phase")=="STOP_CONFIRMED" and prot.get("stopClientOrderId")==STOP_ID
        and same(prot.get("protectedQty"),226),"DURABLE_STOP_CHANGED")
    hb=read(HEARTBEAT)
    req(hb.get("status")=="blocked" and "V4_STALE_EXIT_REVIEW_REQUIRED" in str(hb.get("reason",""))
        and LEG_ID in str(hb.get("reason","")),"HEARTBEAT_NOT_STALE_EXIT_REVIEW")
    req(read(KILL).get("active") is False,"KILL_SWITCH_ACTIVE")
    risk=read(RISK)
    req(risk.get("sourceComplete") is True and risk.get("tripped") is not True,"DAILY_RISK_NOT_HEALTHY")
    margin=read(MARGIN)
    req(margin.get("stage")=="HEALTHY" and margin.get("ordersAllowed") is True,"MARGIN_NOT_HEALTHY")
    entries=read(PENDING).get("entries")
    req(isinstance(entries,list) and not any(isinstance(x,dict) and str(x.get("status","")).upper()!="RELEASED" for x in entries),
        "PENDING_EXPOSURE_ACTIVE")
    venue=signed_get()
    positions=venue.get("positions") or []
    orders=venue.get("openOrders") or []
    pos=[x for x in positions if x.get("symbol")=="DOGEUSDT" and same(x.get("positionAmt"),-226) and same(x.get("entryPrice"),0.08052)]
    stop=[x for x in orders if x.get("clientOrderId")==STOP_ID and x.get("symbol")=="DOGEUSDT"
          and x.get("side")=="BUY" and x.get("type")=="STOP_MARKET" and x.get("reduceOnly") is True
          and x.get("status")=="NEW" and same(x.get("origQty"),226) and same(x.get("executedQty"),0)]
    req(len(pos)==1 and len(stop)==1,"VENUE_POSITION_OR_STOP_CHANGED")
    print(json.dumps({
        "status":"V4_DOGE_MISSED_TIME_EXIT_PREFLIGHT_PASS",
        "legId":LEG_ID,
        "route":"REC_Y06_REV_D0_T72",
        "position":"DOGEUSDT SHORT 226",
        "entryPrice":0.08052,
        "plannedExitTs":1793440800000,
        "plannedExitPrice":0.07505,
        "plannedExitReason":"TIME",
        "heartbeatReason":hb.get("reason"),
        "v4ServiceState":v4_state,
        "v4MainPid":v4_pid,
        "allowQuiesced":args.allow_quiesced,
        "venueObservedAt":venue.get("observedAt"),
        "markPrice":pos[0].get("markPrice"),
        "residentStopClientOrderId":STOP_ID,
        "ordersSent":0,
        "cancelsSent":0,
        "positionChangesSent":0
    },separators=(",",":")))

if __name__=="__main__":
    main()
