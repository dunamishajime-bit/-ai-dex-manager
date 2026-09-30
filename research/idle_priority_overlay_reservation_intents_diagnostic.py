#!/usr/bin/env python3
from __future__ import annotations
import argparse,json
from pathlib import Path
from collections import Counter

CRYPTO_CAP=3.0
TOTAL_CAP=4.25
IDLE_GROSS=1.0
BASE={"V12","PENGU","Q102","FET","V52"}

def jl(p):
    return [json.loads(x) for x in Path(p).read_text(encoding="utf-8").splitlines() if x.strip()]

def gross(t):
    for k in ("accepted_gross","candidate_requested_gross","requested_gross"):
        if t.get(k) is not None:
            v=float(t[k])
            if v>0:return v
    raise RuntimeError("GROSS_MISSING:"+json.dumps({k:t.get(k) for k in ("candidate_id","position_id","strategy_id","symbol")}))

def main():
    a=argparse.ArgumentParser()
    a.add_argument("--baseline-trades",required=True)
    a.add_argument("--idle-intents",required=True)
    a.add_argument("--output",required=True)
    z=a.parse_args()
    base=jl(z.baseline_trades)
    idle=json.loads(Path(z.idle_intents).read_text(encoding="utf-8"))
    if len(base)!=1284: raise SystemExit(f"BASELINE_ROWS:{len(base)}")
    if len(idle)!=61: raise SystemExit(f"IDLE_ROWS:{len(idle)}")

    events=[]
    for i,t in enumerate(base):
        if t.get("strategy_id") not in BASE: raise SystemExit("BAD_STRAT")
        events += [(int(t["exit_ts_ms"]),0,"BX",i,t),(int(t["entry_ts_ms"]),2,"BE",i,t)]
    for i,t in enumerate(idle):
        events += [(int(t["exit_ts_ms"]),1,"IX",i,t),(int(t["entry_ts_ms"]),3,"IE",i,t)]
    events.sort(key=lambda e:(e[0],e[1],e[2],e[3]))

    ab={}; ai={}; br=[]; ir=[]; ba=[]; ia=[]
    for ts,_,kind,i,t in events:
        if kind=="BX": ab.pop(i,None); continue
        if kind=="IX": ai.pop(i,None); continue
        cg=sum(gross(x) for x in ab.values() if x["strategy_id"]!="V52")+len(ai)
        tg=sum(gross(x) for x in ab.values())+len(ai)
        if kind=="BE":
            g=gross(t); addc=0 if t["strategy_id"]=="V52" else g
            audit={"candidate_id":t.get("candidate_id"),"position_id":t.get("position_id"),
              "strategy_id":t["strategy_id"],"symbol":t["symbol"],"entry_ts_ms":int(t["entry_ts_ms"]),
              "exit_ts_ms":int(t["exit_ts_ms"]),"accepted_gross":g,
              "crypto_before":cg,"total_before":tg,"crypto_after":cg+addc,"total_after":tg+g}
            if cg+addc<=CRYPTO_CAP+1e-12 and tg+g<=TOTAL_CAP+1e-12:
                ab[i]=t;ba.append(audit)
            else:
                audit["reason"]="RESERVATION_CAP";br.append(audit)
        else:
            audit={"symbol":t["symbol"],"route":t["route"],"entry_ts_ms":int(t["entry_ts_ms"]),
              "exit_ts_ms":int(t["exit_ts_ms"]),"crypto_before":cg,"total_before":tg,
              "crypto_after":cg+1.0,"total_after":tg+1.0}
            if cg+1.0<=CRYPTO_CAP+1e-12 and tg+1.0<=TOTAL_CAP+1e-12:
                ai[i]=t;ia.append(audit)
            else:
                audit["reason"]="IDLE_RESERVATION_CAP";ir.append(audit)
    out={"status":"DIAGNOSTIC","model":"ACCEPTED_GROSS_RESERVATION",
      "baseline_input":len(base),"idle_input":len(idle),
      "baseline_retained":len(ba),"baseline_rejected":len(br),
      "idle_retained":len(ia),"idle_rejected":len(ir),
      "integrated_count":len(ba)+len(ia),"no_cap_control":len(base)+len(idle),
      "baseline_rejections_by_strategy":dict(Counter(x["strategy_id"] for x in br)),
      "baseline_rejections":br,"idle_rejections":ir}
    Path(z.output).write_text(json.dumps(out,indent=2,sort_keys=True)+"\n",encoding="utf-8")
    print(json.dumps({k:out[k] for k in ["baseline_input","idle_input","baseline_retained","baseline_rejected","idle_retained","idle_rejected","integrated_count","no_cap_control","baseline_rejections_by_strategy"]},sort_keys=True))
    print("BASELINE_REJECTIONS="+json.dumps(br,sort_keys=True))
    print("IDLE_REJECTIONS="+json.dumps(ir,sort_keys=True))
if __name__=="__main__":main()
