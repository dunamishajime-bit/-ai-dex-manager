import runpy,contextlib,io,json,datetime as dt,hashlib
from pathlib import Path
R=Path(r"C:\tmp\disdex-bt-20251001-20261001");D=R/"DIRECTION_RESEARCH_20261109"
with contextlib.redirect_stdout(io.StringIO()):
 ns=runpy.run_path(str(R/"hype_h48r4_market_regime_gate_pretarget_v1_20261113.py"))
cj=json.load(open(D/"hype_h48_consensus_discovery_validation_v1_20261114.json",encoding="utf-8"))
rules=cj["cases"]["TOP10_VOTE50"]["rules"]
policy={"n":2,"minHist":2,"minMean":-0.01,"minWR":0.34,"maxLossStreak":1,"warmupAllow":True}
def hit_rule(x,r):
 for a in r:
  f,op,v,q=a;z=x["f"][f]
  if op=="<=" and z>v:return False
  if op==">=" and z<v:return False
 return True
def cons(rows):
 out=[]
 for x in rows:
  frac=sum(hit_rule(x,z["rule"]) for z in rules)/len(rules)
  if frac>=.5:
   y=dict(x);y["consensus"]=frac;out.append(y)
 return out
pre={k:cons(v) for k,v in ns["splits"].items()};tar=cons(ns["tar"]);fwd=cons(ns["fwd"])
allrows=sorted(pre["TRAIN"]+pre["VALID"]+pre["PREHOLD"]+tar+fwd,key=lambda x:x["entryTs"])
def base_health(x):
 hist=[z for z in allrows if z["exitTs"]<=x["entryTs"] and z["entryTs"]<x["entryTs"]][-policy["n"]:]
 if len(hist)<policy["minHist"]:return True,len(hist)
 vals=[z["raw"]-.003 for z in hist];wr=sum(v>0 for v in vals)/len(vals);mean=sum(vals)/len(vals)
 streak=0
 for v in reversed(vals):
  if v<=0:streak+=1
  else:break
 return (mean>=policy["minMean"] and wr>=policy["minWR"] and streak<=policy["maxLossStreak"]),len(hist)
def sel(rows,ttl):
 out=[];prev=None
 # previous consensus candidate globally, not just admitted.
 for x in rows:
  # find prior candidate from allrows
  prior=[z for z in allrows if z["entryTs"]<x["entryTs"]]
  prev=prior[-1] if prior else None
  gap=None if prev is None else (x["entryTs"]-prev["entryTs"])/86400000
  stale=gap is not None and gap>ttl
  ok,hn=base_health(x)
  if ok and not stale:
   y=dict(x);y["healthHistN"]=hn;y["gapDays"]=gap;out.append(y)
 return out
def stat(xs,c=.003):
 r=[x["raw"]-c for x in xs]
 if not r:return {"n":0}
 gp=sum(v for v in r if v>0);gl=-sum(v for v in r if v<0)
 return {"n":len(r),"wr":sum(v>0 for v in r)/len(r),"mean":sum(r)/len(r),"sum":sum(r),"pf":gp/gl if gl else 999.,"worst":min(r)}
cases={}
for ttl in (45,60,90):
 tx=sel(tar,ttl);fx=sel(fwd,ttl)
 cases[str(ttl)]={"ttlDays":ttl,"TARGET30":stat(tx),"FORWARD30":stat(fx),"targetRows":tx,"forwardRows":fx}
 print("TTL",ttl,"T",cases[str(ttl)]["TARGET30"],"F",cases[str(ttl)]["FORWARD30"])
 print("rows",[(dt.datetime.fromtimestamp(x["entryTs"]/1000,dt.timezone.utc).date().isoformat(),round(x["raw"]-.003,4),round(x["gapDays"],1) if x["gapDays"] is not None else None) for x in tx])
obj={"status":"RESEARCH_ONLY_HYPE_ONLINE_HEALTH_STALE_TTL_SENSITIVITY","selectionUsesTarget":False,
     "baseOnlinePolicy":policy,"ttlDefinition":"block current HYPE when gap since prior consensus candidate exceeds TTL; blocked candidate still becomes shadow evidence after completion",
     "pretargetMaxGapDays":max((b["entryTs"]-a["entryTs"])/86400000 for a,b in zip(sorted(pre["TRAIN"]+pre["VALID"]+pre["PREHOLD"],key=lambda x:x["entryTs"]),sorted(pre["TRAIN"]+pre["VALID"]+pre["PREHOLD"],key=lambda x:x["entryTs"])[1:])),
     "cases":cases}
p=D/"hype_consensus_onlinehealth_stale_ttl_sensitivity_v1_20261114.json";p.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
print("SAVED",p,"SHA256",hashlib.sha256(p.read_bytes()).hexdigest())