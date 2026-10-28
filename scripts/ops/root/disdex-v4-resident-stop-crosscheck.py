#!/usr/bin/env python3
"""Read-only V12 V4 STOP cross-check against shared Aster observation.
Never submits, cancels, reduces, or modifies a position/STOP.
Fail-closed: UNKNOWN remains unprotected unless all independent owner evidence matches.
"""
from pathlib import Path
from datetime import datetime,timezone
import argparse,json,os,re,subprocess,time

V4_SHA="53a0be396719f0284af4e11b35c66a4ac7d58f79"
BASE=Path("/var/lib/disdex")
OBS=BASE/"shared/resident-stop-observation.json"
LEDGER=BASE/"v12-v4/orders.json"
HB=BASE/"runner-health/heartbeats/v12-v4.json"
OUT=BASE/"shared/resident-stop-v4-verification.json"
RELEASE=Path("/home/deploy/disdex-trading/releases")/V4_SHA
UNIT=f"disdex-v12-v4@{V4_SHA}.service"

def require(ok,reason):
    if not ok:raise RuntimeError(reason)

def run(now_ms=None,obs_path=OBS,ledger_path=LEDGER,hb_path=HB,verify_service=True):
    now_ms=int(now_ms or time.time()*1000)
    obs=json.loads(Path(obs_path).read_text())
    ledger=json.loads(Path(ledger_path).read_text())
    hb=json.loads(Path(hb_path).read_text())
    require(obs.get("schema")=="resident-stop-observation/v1" and obs.get("ok") is True and obs.get("readOnly") is True,"VENUE_OBSERVATION_INCOMPLETE")
    require(0<=now_ms-int(obs.get("checkedAt",0))<180000,"VENUE_OBSERVATION_STALE")
    require(ledger.get("releaseSha")==V4_SHA,"V4_LEDGER_RELEASE_MISMATCH")
    require(hb.get("runtimeSha")==V4_SHA and hb.get("expectedSha")==V4_SHA,"V4_HEARTBEAT_SHA_MISMATCH")
    require(hb.get("serviceUnit")==UNIT and hb.get("mode")=="LIVE" and hb.get("safetyState")=="HEALTHY","V4_HEARTBEAT_NOT_LIVE")
    tick=int(hb.get("lastTickAt") or 0)
    require(0<=now_ms-tick<180000,"V4_HEARTBEAT_STALE")
    if verify_service:
        require((RELEASE/".disdex-release-sha").read_text().strip()==V4_SHA,"V4_SOURCE_NOT_PINNED")
        require(subprocess.run(["systemctl","is-active","--quiet",UNIT],check=False,timeout=8).returncode==0,"V4_SERVICE_NOT_ACTIVE")
    legs=(ledger.get("state") or {}).get("legs") or {}
    protections=ledger.get("protections") or {}
    require(isinstance(legs,dict) and isinstance(protections,dict),"V4_LEDGER_INVALID")
    verified=[];unresolved=[]
    for row in obs.get("positions") or []:
        if row.get("protected") is not False:
            continue
        symbol=str(row.get("symbol",""))
        side=str(row.get("positionSide",""))
        q=float(row.get("quantity") or 0)
        candidates=[]
        if side not in ("LONG","SHORT") or q<=0:unresolved.append({"symbol":symbol,"reason":"INVALID_POSITION"});continue
        for key,leg in legs.items():
            if leg.get("status")!="OPEN" or not key.startswith(symbol+":") or (":SHORT:" if side=="SHORT" else ":LONG:") not in key:
                continue
            candidates.append((key,leg))
        if len(candidates)!=1:
            unresolved.append({"symbol":symbol,"reason":"V4_OWNERSHIP_MISSING_OR_AMBIGUOUS"});continue
        key,leg=candidates[0]
        pro=protections.get(key) or {}
        stops=row.get("orders") or []
        closing_side="BUY" if side=="SHORT" else "SELL"
        entry_q=float(leg.get("qty") or 0)
        entry_price=float(leg.get("entryNotional") or 0)/entry_q if entry_q>0 else 0
        qty_tol=max(1e-8,q*1e-9)
        condition=(pro.get("phase")=="STOP_CONFIRMED"
          and len(stops)==1 and isinstance(stops[0],dict)
          and re.fullmatch(r"v12-v4-[0-9a-f]+",str(pro.get("stopClientOrderId") or "")) is not None
          and pro.get("stopClientOrderId")==stops[0].get("clientOrderId")
          and abs(float(pro.get("protectedQty") or 0)-q)<=qty_tol
          and abs(entry_q-q)<=qty_tol
          and stops[0].get("side")==closing_side
          and stops[0].get("reduceOnly") is True
          and stops[0].get("status") in ("NEW","PARTIALLY_FILLED")
          and abs(float(stops[0].get("quantity") or 0)-q)<=qty_tol
          and int(stops[0].get("orderId") or 0)>0
          and float(stops[0].get("stopPrice") or 0)>0
          and entry_price>0)
        if condition:
            stop=float(stops[0]["stopPrice"])
            # The accepted V4 initial hard loss is 8%. A dynamically tightened STOP
            # may be closer or already in profit, but never less protective.
            if side=="SHORT":condition=stop<=entry_price*1.08+max(1e-8,entry_price*0.0002)
            else:condition=stop>=entry_price*0.92-max(1e-8,entry_price*0.0002)
        if not condition:
            unresolved.append({"symbol":symbol,"reason":"STOP_LEDGER_VENUE_MISMATCH"});continue
        verified.append({"symbol":symbol,"strategy":"V12_V4","route":key.split(":")[1],"positionSide":side,
          "quantity":q,"stopOrderId":stops[0]["orderId"],"stopPrice":stops[0]["stopPrice"],
          "clientOrderId":stops[0]["clientOrderId"],"source":"EXCHANGE_STOP_READBACK_PLUS_V4_CONFIRMED_LEDGER"})
    existing_unprotected=int(obs.get("unprotectedCount",0))
    effective=max(0,existing_unprotected-len(verified))
    return {"schema":"resident-stop-v4-verification/v1","status":"HEALTHY" if not unresolved and effective==0 else "BLOCKED",
      "readOnly":True,"checkedAt":now_ms,"v4Sha":V4_SHA,"venueObservationAt":obs["checkedAt"],
      "originalUnprotectedCount":existing_unprotected,"v4Verified":verified,"unresolved":unresolved,
      "effectiveUnprotectedCount":effective,
      "ordersSent":0,"cancelsSent":0,"positionChangesSent":0}

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--out",default=str(OUT))
    args=parser.parse_args()
    try:result=run()
    except Exception as ex:
        result={"schema":"resident-stop-v4-verification/v1","status":"BLOCKED","readOnly":True,
          "checkedAt":int(time.time()*1000),"reason":str(ex)[:160],
          "ordersSent":0,"cancelsSent":0,"positionChangesSent":0}
    # Atomic output, owner root, no credential content
    path=Path(args.out)
    tmp=path.with_name(path.name+".new."+str(os.getpid()))
    tmp.write_text(json.dumps(result,ensure_ascii=False)+"\n")
    tmp.chmod(0o640)
    os.replace(tmp,path)
    print(json.dumps(result,ensure_ascii=False))
    return 0 if result["status"]=="HEALTHY" else 2

if __name__=="__main__":raise SystemExit(main())
