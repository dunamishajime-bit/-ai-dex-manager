import runpy,contextlib,io,json,statistics,math,hashlib
from pathlib import Path
R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
D=R/"DIRECTION_RESEARCH_20261109"
SRC=R/"hype_h48r4_market_regime_gate_pretarget_v1_20261113.py"
with contextlib.redirect_stdout(io.StringIO()):
 ns=runpy.run_path(str(SRC))
splits=ns["splits"];tar=ns["tar"];fwd=ns["fwd"];stat=ns["stat"]
cj=json.load(open(D/"hype_h48_consensus_discovery_validation_v1_20261114.json",encoding="utf-8"))
rules=cj["cases"]["TOP10_VOTE50"]["rules"]
def hit_rule(x,r):
 for a in r:
  f,op,v,q=a;z=x["f"][f]
  if op=="<=" and z>v:return False
  if op==">=" and z<v:return False
 return True
def consensus(rows):
 out=[]
 for x in rows:
  frac=sum(hit_rule(x,z["rule"]) for z in rules)/len(rules)
  if frac>=.5:
   y=dict(x);y["consensus"]=frac;out.append(y)
 return out
pre={k:consensus(v) for k,v in splits.items()}
target=consensus(tar);forward=consensus(fwd)
allrows=sorted(pre["TRAIN"]+pre["VALID"]+pre["PREHOLD"]+target+forward,key=lambda x:x["entryTs"])
# shadow outcomes exist for every consensus candidate, even when blocked.
def health_select(rows,policy):
 out=[]
 for x in rows:
  hist=[z for z in allrows if z["exitTs"]<=x["entryTs"] and z["entryTs"]<x["entryTs"]]
  hist=hist[-policy["n"]:]
  if len(hist)<policy["minHist"]:
   allow=policy["warmupAllow"]
  else:
   vals=[z["raw"]-.003 for z in hist]
   wr=sum(v>0 for v in vals)/len(vals)
   mean=sum(vals)/len(vals)
   # loss streak computed from end
   streak=0
   for v in reversed(vals):
    if v<=0:streak+=1
    else:break
   allow=(mean>=policy["minMean"] and wr>=policy["minWR"] and streak<=policy["maxLossStreak"])
  if allow:
   y=dict(x);y["healthHistN"]=len(hist);out.append(y)
 return out
pols=[]
for n in (2,3,4,5):
 for minHist in (2,3):
  if minHist>n:continue
  for minMean in (-.01,0,.01):
   for minWR in (.34,.5,.67):
    for maxLS in (1,2):
     for warm in (True,):
      pols.append({"n":n,"minHist":minHist,"minMean":minMean,"minWR":minWR,"maxLossStreak":maxLS,"warmupAllow":warm})
cand=[]
for p in pols:
 tr=health_select(pre["TRAIN"],p);va=health_select(pre["VALID"],p);ph=health_select(pre["PREHOLD"],p)
 mt={k:stat(v,.003) for k,v in [("TRAIN",tr),("VALID",va),("PREHOLD",ph)]}
 # discover/rank by TRAIN+VALID only; PREHOLD is independent pass/fail.
 if mt["TRAIN"]["n"]<2 or mt["VALID"]["n"]<1:continue
 if mt["TRAIN"]["mean"]<=0 or mt["VALID"]["mean"]<=0:continue
 if mt["TRAIN"]["pf"]<=1 or mt["VALID"]["pf"]<=1:continue
 score=min(mt["TRAIN"]["mean"],mt["VALID"]["mean"])-.5*abs(mt["TRAIN"]["mean"]-mt["VALID"]["mean"])+.0001*(mt["TRAIN"]["n"]+mt["VALID"]["n"])
 cand.append({"policy":p,"TRAIN30":mt["TRAIN"],"VALID30":mt["VALID"],"PREHOLD30":mt["PREHOLD"],"score":score})
cand.sort(key=lambda x:x["score"],reverse=True)
# freeze highest TRAIN+VALID ranked policy that passes PREHOLD; target never used in selection.
selected=None
for c in cand:
 ph=c["PREHOLD30"]
 if ph.get("n",0)>=1 and ph.get("mean",-1)>0 and ph.get("pf",0)>1 and ph.get("wr",0)>=.5:
  selected=c;break
if selected:
 p=selected["policy"]
 tx=health_select(target,p);fx=health_select(forward,p)
 selected["TARGET30"]=stat(tx,.003);selected["TARGET10"]=stat(tx,.001)
 selected["FORWARD30"]=stat(fx,.003);selected["FORWARD10"]=stat(fx,.001)
 selected["targetRows"]=tx;selected["forwardRows"]=fx
obj={"status":"RESEARCH_ONLY_HYPE_CONSENSUS_SHADOW_ONLINE_HEALTH","selectionUsesTarget":False,
 "healthSource":"all consensus candidate 48h shadow outcomes completed before current entry",
 "pipeline":"TRAIN+VALID rank -> PREHOLD pass -> frozen -> TARGET/FORWARD evaluation",
 "baseCounts":{"TRAIN":len(pre["TRAIN"]),"VALID":len(pre["VALID"]),"PREHOLD":len(pre["PREHOLD"]),"TARGET":len(target),"FORWARD":len(forward)},
 "policyCandidatesRankedByTrainValid":cand[:50],"selected":selected}
OUT=D/"hype_consensus_shadow_online_health_v1_20261114.json"
OUT.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
print("SAVED",OUT,"SHA256",hashlib.sha256(OUT.read_bytes()).hexdigest(),"CAND",len(cand))
print("BASE",obj["baseCounts"])
if selected:
 print("SELECTED",json.dumps({k:selected[k] for k in ("policy","TRAIN30","VALID30","PREHOLD30","TARGET30","FORWARD30")},ensure_ascii=False))
 print("TARGET_ROWS",[(x["entryTs"],round(x["raw"]-.003,5),x["healthHistN"]) for x in selected["targetRows"]])