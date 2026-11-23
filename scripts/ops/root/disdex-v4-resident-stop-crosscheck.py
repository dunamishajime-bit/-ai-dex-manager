#!/usr/bin/env python3
"""Read-only V12 V4 STOP cross-check against shared Aster observation.
Never submits, cancels, reduces, or modifies a position/STOP.
Fail-closed: UNKNOWN remains unprotected unless all independent owner evidence matches.
"""
from pathlib import Path
from datetime import datetime,timezone
import argparse,json,os,re,stat,subprocess,time

# The original 53a0 source pin is stale; the root-owned signed-pins manifest
# is the authoritative runtime binding. Never infer a release from the ledger.
PINS=Path("/etc/disdex/runner-pins.json")
SHA_RE=re.compile(r"^[0-9a-f]{40}$")
BASE=Path("/var/lib/disdex")
OBS=BASE/"shared/resident-stop-observation.json"
LEDGER=BASE/"v12-v4/orders.json"
HB=BASE/"runner-health/heartbeats/v12-v4.json"
OUT=BASE/"shared/resident-stop-v4-verification.json"


def require(ok,reason):
    if not ok:raise RuntimeError(reason)

def load_v4_pin(pin_manifest=PINS,require_root_owned=True):
    pin_manifest=Path(pin_manifest)
    st=pin_manifest.lstat()
    require(stat.S_ISREG(st.st_mode) and not pin_manifest.is_symlink(),
            "V4_ROOT_PIN_FILE_NOT_REGULAR")
    if os.name == "nt":
        # Windows file modes do not represent Linux root-owned permissions.
        # Only offline fixture checks can run on Windows.
        require(not require_root_owned,"V4_ROOT_PIN_PRODUCTION_REQUIRES_POSIX")
    else:
        require((st.st_mode & 0o022)==0,"V4_ROOT_PIN_FILE_WRITABLE_BY_PEERS")
        if require_root_owned:
            require(st.st_uid==0,"V4_ROOT_PIN_FILE_OWNER_INVALID")
    raw=json.loads(pin_manifest.read_text(encoding="utf8"))
    require(raw.get("schema") in ("disdex-runner-pin-manifest/v1","disdex-runner-pin-manifest/v2")
            and raw.get("target")=="professional-dismanager.net", "V4_ROOT_PIN_MANIFEST_INVALID")
    if raw["schema"]=="disdex-runner-pin-manifest/v2":
        require(raw.get("operatorTarget")=="DD1296_FINAL_ALLIN_10BPS",
                "V4_ROOT_PIN_OPERATOR_SCOPE_INVALID")
    pin=(raw.get("runners") or {}).get("V12_V4")
    require(isinstance(pin,dict),"V4_ROOT_PIN_ENTRY_MISSING")
    sha=pin.get("sha")
    require(isinstance(sha,str) and SHA_RE.fullmatch(sha) is not None,
            "V4_ROOT_PIN_SHA_INVALID")
    expected_root="/home/deploy/disdex-trading/releases/"+sha
    expected_unit="disdex-v12-v4@"+sha+".service"
    require(pin.get("releaseRoot")==expected_root,"V4_ROOT_PIN_RELEASE_ROOT_INVALID")
    require(pin.get("serviceUnit")==expected_unit,"V4_ROOT_PIN_UNIT_INVALID")
    return sha,Path(expected_root),expected_unit


def run(now_ms=None,obs_path=OBS,ledger_path=LEDGER,hb_path=HB,
        verify_service=True,pin_manifest=PINS):
    v4_sha,release,unit=load_v4_pin(pin_manifest,require_root_owned=verify_service)
    now_ms=int(now_ms or time.time()*1000)
    obs=json.loads(Path(obs_path).read_text())
    ledger=json.loads(Path(ledger_path).read_text())
    hb=json.loads(Path(hb_path).read_text())
    require(obs.get("schema")=="resident-stop-observation/v1" and obs.get("ok") is True and obs.get("readOnly") is True,"VENUE_OBSERVATION_INCOMPLETE")
    require(0<=now_ms-int(obs.get("checkedAt",0))<180000,"VENUE_OBSERVATION_STALE")
    require(ledger.get("releaseSha")==v4_sha,"V4_LEDGER_RELEASE_MISMATCH")
    require(hb.get("runtimeSha")==v4_sha and hb.get("expectedSha")==v4_sha,"V4_HEARTBEAT_SHA_MISMATCH")
    require(hb.get("serviceUnit")==unit and hb.get("mode")=="LIVE" and hb.get("safetyState")=="HEALTHY","V4_HEARTBEAT_NOT_LIVE")
    tick=int(hb.get("lastTickAt") or 0)
    require(0<=now_ms-tick<180000,"V4_HEARTBEAT_STALE")
    if verify_service:
        require((release/".disdex-release-sha").read_text().strip()==v4_sha,"V4_SOURCE_NOT_PINNED")
        require(subprocess.run(["systemctl","is-active","--quiet",unit],check=False,timeout=8).returncode==0,"V4_SERVICE_NOT_ACTIVE")
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
      "readOnly":True,"checkedAt":now_ms,"v4Sha":v4_sha,"venueObservationAt":obs["checkedAt"],
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
