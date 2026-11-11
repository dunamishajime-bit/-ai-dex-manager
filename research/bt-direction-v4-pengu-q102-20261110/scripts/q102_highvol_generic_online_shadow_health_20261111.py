#!/usr/bin/env python3
from pathlib import Path
import json,hashlib,itertools

R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
PRE=R/"PREPERIOD_TRAIN_20240101_20251001"/"Q102_HIGHVOL_BINANCE_PROXY"/"q102-highvol-pretarget-proxy-exits.jsonl"
TARGET=R/"Q102_CURRENT_PRODUCTION_REPLAY_AUDIT_20261110"/"q102-high-vol-base-exits.jsonl"
OUT=R/"DIRECTION_RESEARCH_20261109"/"q102_highvol_generic_online_shadow_health_20261111.json"
COST=.003;DAY=86400000
pre=[json.loads(x) for x in PRE.read_text(encoding="utf-8").splitlines() if x.strip()]
tar0=[json.loads(x) for x in TARGET.read_text(encoding="utf-8").splitlines() if x.strip()]
tar=[z for z in tar0 if isinstance(z.get("grossReturn"),(int,float)) and z.get("exitTs") is not None]

def norm(z,src):
 return {"id":z.get("id") or f"{z['symbol']}:{z['entryTs']}","entryTs":int(z["entryTs"]),"exitTs":int(z["exitTs"]),
         "rawReturn":float(z["rawReturn"] if "rawReturn" in z else z["grossReturn"]),
         "symbol":z["symbol"],"side":int(z["side"]),"source":src}
pre=[norm(z,"PRE_BINANCE_PROXY") for z in pre];tar=[norm(z,"TARGET_ASTER_REPLAY") for z in tar]
pre.sort(key=lambda z:(z["entryTs"],z["id"]));tar.sort(key=lambda z:(z["entryTs"],z["id"]))

def met(rows):
 v=[z["rawReturn"]-COST for z in rows];gp=sum(x for x in v if x>0);gl=-sum(x for x in v if x<0)
 return {"n":len(v),"wr":sum(x>0 for x in v)/len(v) if v else None,"mean":sum(v)/len(v) if v else None,
         "sum":sum(v),"pf":gp/gl if gl else (999.0 if gp>0 else None)}
def sim(rows,lb,mn,pf):
 adm=[];blk=[];dec=[]
 for z in rows:
  t=z["entryTs"];h=[x for x in rows if x["exitTs"]<=t and x["exitTs"]>=t-lb*DAY];m=met(h)
  b=bool(m["n"]>=mn and m["mean"] is not None and m["mean"]<0 and m["pf"] is not None and m["pf"]<pf)
  dec.append({**z,"health":m,"blocked":b});(blk if b else adm).append(z)
 return {"baseline":met(rows),"admitted":met(adm),"blockedShadow":met(blk),"blockedN":len(blk),"admittedN":len(adm),"decisions":dec}

f={"lookbackDays":90,"minN":5,"pfMax":.6}
A=sim(pre,f["lookbackDays"],f["minN"],f["pfMax"]);B=sim(tar,f["lookbackDays"],f["minN"],f["pfMax"])
grid=[]
for lb,mn,pf in itertools.product((60,90,120),(5,6,8),(.5,.6,.7)):
 a=sim(pre,lb,mn,pf);b=sim(tar,lb,mn,pf)
 grid.append({"policy":{"lookbackDays":lb,"minN":mn,"pfMax":pf},
              "pre":{"admitted":a["admitted"],"blockedN":a["blockedN"]},
              "target":{"admitted":b["admitted"],"blockedN":b["blockedN"]}})
out={"status":"Q102_HIGHVOL_GENERIC_PRETARGET_FROZEN_ONLINE_SHADOW_HEALTH_RESEARCH_ONLY",
 "frozenPolicy":f,
 "policyOrigin":"Same cross-route pretarget-only 90d/min5/PF<0.60 policy; no Q102 target-year tuning.",
 "semantics":"Only completed shadow outcomes with exitTs <= current entryTs enter health. Blocked candidates remain shadow-monitored.",
 "pretarget":{k:v for k,v in A.items() if k!="decisions"},
 "targetOneShot":{k:v for k,v in B.items() if k!="decisions"},
 "targetBlocked":[{"id":z["id"],"entryTs":z["entryTs"],"symbol":z["symbol"],"side":z["side"],"health":z["health"]} for z in B["decisions"] if z["blocked"]],
 "neighborGridFalsificationOnly":grid,
 "hashes":{"pre":hashlib.sha256(PRE.read_bytes()).hexdigest(),"target":hashlib.sha256(TARGET.read_bytes()).hexdigest()},
 "warnings":["Pretarget is Binance UM proxy.","Target results are one-shot evaluation only.","Neighbor target grid must not be mined for a better parameter."]}
OUT.write_text(json.dumps(out,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
print("PRE",json.dumps(out["pretarget"],separators=(",",":")))
print("TARGET",json.dumps(out["targetOneShot"],separators=(",",":")))
print("BLOCKED",[(x["symbol"],x["side"],x["entryTs"]) for x in out["targetBlocked"]])
improve=sum(1 for x in grid if x["target"]["admitted"]["mean"] is not None and x["target"]["admitted"]["mean"]>B["baseline"]["mean"])
print("NEIGHBOR_TARGET_MEAN_ABOVE_BASE",improve,"/",len(grid))
print("OUT",OUT,"SHA256",hashlib.sha256(OUT.read_bytes()).hexdigest())
