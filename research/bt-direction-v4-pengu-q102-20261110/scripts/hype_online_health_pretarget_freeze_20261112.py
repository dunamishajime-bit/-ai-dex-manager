#!/usr/bin/env python3
from pathlib import Path
import json,datetime as dt,hashlib,itertools

R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
P=R/"PREPERIOD_TRAIN_20250501_20251001"/"HYPE_BINANCE_PROXY"/"hype-preperiod-proxy-candidates-with-m5-exits.jsonl"
TARGET=R/"hype-aster-historical"/"hype-trend-pinned-candidates.json"
OUT=R/"DIRECTION_RESEARCH_20261109"/"hype_online_health_pretarget_freeze_20261112.json"
COST=.003;DAY=86400000

pre=[json.loads(x) for x in P.read_text(encoding="utf-8").splitlines() if x.strip()]
pre=[{"entryTs":int(z["entryTs"]),"exitTs":int(z["exitTs"]),"ret":float(z["rawReturn"])} for z in pre]
pre.sort(key=lambda z:z["entryTs"])
target=json.loads(TARGET.read_text(encoding="utf-8"))
target=[{"entryTs":int(z["entry_ts_ms"]),"exitTs":int(z["exit_ts_ms"]),"ret":float(z["unit_price_return"])} for z in target]
target.sort(key=lambda z:z["entryTs"])

def metric(rows):
 vals=[z["ret"]-COST for z in rows];gp=sum(x for x in vals if x>0);gl=-sum(x for x in vals if x<0)
 return {"n":len(vals),"wr":sum(x>0 for x in vals)/len(vals) if vals else None,
         "mean":sum(vals)/len(vals) if vals else None,"sum":sum(vals),
         "pf":gp/gl if gl else (999.0 if gp>0 else None)}

def simulate(rows,lookback,min_n,pf_cut,mean_cut=0):
 admitted=[];blocked=[];decisions=[]
 for z in rows:
  t=z["entryTs"]
  hist=[h for h in rows if h["exitTs"]<=t and h["exitTs"]>=t-lookback*DAY]
  hm=metric(hist)
  block=(hm["n"]>=min_n and hm["mean"] is not None and hm["mean"]<mean_cut and (hm["pf"] or 0)<pf_cut)
  decisions.append({"entryTs":t,"block":block,"health":hm})
  (blocked if block else admitted).append(z)
 return {"baseline":metric(rows),"admitted":metric(admitted),"blocked":metric(blocked),
         "blockedN":len(blocked),"admittedN":len(admitted),"decisions":decisions}

def month(z):return dt.datetime.fromtimestamp(z["entryTs"]/1000,dt.timezone.utc).strftime("%Y-%m")
discover=[z for z in pre if month(z)<="2025-07"]
valid=[z for z in pre if month(z)=="2025-08"]
prehold=[z for z in pre if month(z)=="2025-09"]
grid=[]
for lb,mn,pf in itertools.product((30,45,60,90),(3,4,5),(.6,.8,1.0)):
 d=simulate(discover,lb,mn,pf);v=simulate(valid,lb,mn,pf);h=simulate(prehold,lb,mn,pf)
 # IMPORTANT: per-split simulate alone has no prior state crossing split boundaries, so for validation
 # and prehold we must evaluate on full prehistory and slice decisions/results.
 full=simulate(pre,lb,mn,pf)
 dec={x["entryTs"]:x for x in full["decisions"]}
 def slice_eval(rows2):
  adm=[z for z in rows2 if not dec[z["entryTs"]]["block"]];blk=[z for z in rows2 if dec[z["entryTs"]]["block"]]
  return {"baseline":metric(rows2),"admitted":metric(adm),"blocked":metric(blk),"blockedN":len(blk),"admittedN":len(adm)}
 v=slice_eval(valid);h=slice_eval(prehold);d=slice_eval(discover)
 train_ok=(d["blockedN"]>=1 and d["admitted"]["mean"]>=d["baseline"]["mean"] and (d["admitted"]["pf"] or 0)>=(d["baseline"]["pf"] or 0))
 oos_ok=(v["blockedN"]>=1 and h["blockedN"]>=1 and
         v["admitted"]["n"]>=1 and h["admitted"]["n"]>=1 and
         v["admitted"]["mean"] is not None and h["admitted"]["mean"] is not None and
         v["admitted"]["mean"]>=v["baseline"]["mean"] and h["admitted"]["mean"]>=h["baseline"]["mean"] and
         (v["admitted"]["pf"] or 0)>=(v["baseline"]["pf"] or 0) and
         (h["admitted"]["pf"] or 0)>=(h["baseline"]["pf"] or 0))
 grid.append({"policy":{"lookbackDays":lb,"minN":mn,"pfCut":pf,"meanCut":0},
              "discover":d,"validation":v,"prehold":h,"trainQualified":train_ok,"oosRobust":train_ok and oos_ok})
rob=[x for x in grid if x["oosRobust"]]
# Freeze based only pretarget; prefer broad admittedN, then min OOS PF improvement.
def score(x):
 ratios=[]
 for k in ("validation","prehold"):
  b=x[k]["baseline"];a=x[k]["admitted"]
  ratios.append((a["pf"] or 0)-(b["pf"] or 0))
 return (x["validation"]["admittedN"]+x["prehold"]["admittedN"],min(ratios),-x["policy"]["lookbackDays"])
rob.sort(key=score,reverse=True)
selected=rob[0] if rob else None

# one-shot target only after freeze
target_eval=None
if selected:
 p=selected["policy"];full=simulate(pre+target,p["lookbackDays"],p["minN"],p["pfCut"],p["meanCut"])
 # decisions for target use full chronological shadow outcomes including blocked cases
 dec={x["entryTs"]:x for x in full["decisions"]}
 adm=[z for z in target if not dec[z["entryTs"]]["block"]];blk=[z for z in target if dec[z["entryTs"]]["block"]]
 target_eval={"baseline":metric(target),"admitted":metric(adm),"blocked":metric(blk),"blockedN":len(blk),"admittedN":len(adm)}

out={"status":"HYPE_ONLINE_HEALTH_PRETARGET_FREEZE_TARGET_ONE_SHOT",
     "counts":{"discover":len(discover),"validation":len(valid),"prehold":len(prehold),"target":len(target)},
     "policyGridN":len(grid),"robustN":len(rob),"selectedPretargetOnly":selected,
     "targetOneShot":target_eval,
     "method":"Online health uses only completed prior HYPE shadow outcomes. Policy grid is deliberately small. June-July discover; August validation; September prehold. Target 2025-10..2026-10 is evaluated once only after pretarget freeze.",
     "hashes":{"pre":hashlib.sha256(P.read_bytes()).hexdigest(),"target":hashlib.sha256(TARGET.read_bytes()).hexdigest()}}
OUT.write_text(json.dumps(out,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
print("COUNTS",out["counts"],"GRID",len(grid),"ROB",len(rob))
for z in rob[:10]:print("ROB",json.dumps(z,separators=(",",":")))
print("SELECTED",json.dumps(selected,separators=(",",":")) if selected else None)
print("TARGET",json.dumps(target_eval,separators=(",",":")) if target_eval else None)
print("OUT",OUT,"SHA256",hashlib.sha256(OUT.read_bytes()).hexdigest())
