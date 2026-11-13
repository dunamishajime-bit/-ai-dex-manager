#!/usr/bin/env python3
from __future__ import annotations
import json, pathlib, subprocess

V4_SHA="53a0be396719f0284af4e11b35c66a4ac7d58f79"
LEG_ID="DOGEUSDT:REC_Y06_REV_D0_T72:SHORT:1793181600000"
STOP_ID="v12-v4-98ded39746ed3502a4d7b0e26ef9"
STORE=pathlib.Path("/var/lib/disdex/v12-v4/orders.json")

def req(ok,msg):
    if not ok: raise SystemExit(msg)

def same(a,b):
    try: return abs(float(a)-float(b))<=max(1e-8,abs(float(b))*1e-7)
    except Exception: return False

def read(path):
    req(path.is_file() and not path.is_symlink(),"UNTRUSTED_FILE:"+str(path))
    d=json.loads(path.read_text())
    req(isinstance(d,dict),"JSON_NOT_OBJECT:"+str(path))
    return d

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
    req(all(d.get(k)==0 for k in ("ordersSent","cancelsSent","positionChangesSent")),"ASTER_DIAGNOSTIC_MUTATED_ACCOUNT")
    return d

def main():
    store=read(STORE)
    req(store.get("releaseSha")==V4_SHA,"STORE_SHA_CHANGED")
    leg=(store.get("state") or {}).get("legs",{}).get(LEG_ID)
    req(isinstance(leg,dict),"DOGE_LEG_MISSING")
    req(leg.get("status")=="CLOSED" and same(leg.get("qty"),0),"DOGE_DURABLE_LEG_NOT_CLOSED_ZERO")
    protection=(store.get("protections") or {}).get(LEG_ID) or {}
    req(protection.get("phase")=="CLOSED" and same(protection.get("protectedQty"),0),"DOGE_PROTECTION_NOT_CLOSED")
    exits=[x for x in (store.get("intents") or {}).values()
           if isinstance(x,dict) and x.get("legId")==LEG_ID and x.get("action")=="EXIT"]
    req(len(exits)==1,"DOGE_EXIT_INTENT_COUNT_MISMATCH")
    req(exits[0].get("stage")=="TERMINAL","DOGE_EXIT_INTENT_NOT_TERMINAL")

    venue=signed_get()
    positions=venue.get("positions") or []
    orders=venue.get("openOrders") or []
    doge_net=sum(float(x.get("positionAmt",0)) for x in positions if x.get("symbol")=="DOGEUSDT")
    req(abs(doge_net)<=1e-8,"DOGE_VENUE_NOT_FLAT")
    req(not any(x.get("symbol")=="DOGEUSDT" and x.get("clientOrderId")==STOP_ID for x in orders),
        "DOGE_RESIDENT_STOP_STILL_PRESENT")

    print(json.dumps({
      "status":"V4_DOGE_OPERATOR_POSTFLIGHT_PASS",
      "legId":LEG_ID,
      "durableStatus":"CLOSED",
      "durableQty":0,
      "exitIntentStage":"TERMINAL",
      "venueNetQty":doge_net,
      "residentStopPresent":False,
      "venueObservedAt":venue.get("observedAt"),
      "ordersSent":0,
      "cancelsSent":0,
      "positionChangesSent":0,
    },separators=(",",":")))

if __name__=="__main__":
    main()
