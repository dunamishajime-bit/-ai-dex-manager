#!/usr/bin/env python3
from pathlib import Path
import json,math,statistics,hashlib
R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
D=R/"DIRECTION_RESEARCH_20261109"/"NATIVE_CAUSAL_SOURCE_REPLAY_20261110"
pre=[json.loads(x) for x in (D/"pre-native-v12-source-exits-no-funding.jsonl").open(encoding="utf8") if x.strip()]
targetSrc=[json.loads(x) for x in (D/"asof-native-v12-source-signals-gross-enriched.jsonl").open(encoding="utf8") if x.strip()]
targetExit=[json.loads(x) for x in (D/"native_exit_h1_funding_independent_audit.jsonl").open(encoding="utf8") if x.strip() and json.loads(x)["family"]=="V12_NATIVE"]
emap={(int(x["decisionTs"]),x["symbol"],x["side"]):x for x in targetExit}
target=[]
for s in targetSrc:
 e=emap[(int(s["decisionTs"]),s["symbol"],s["side"])]
 target.append({**s,"grossDirectionalReturn":float(e["grossDirectionalReturn"]),
                "atrRatio":float(s["atr"])/float(e["entryPrice"]),"absMomentum":abs(float(s["momentum"]))})
assert len(pre)==962 and len(target)==2018
# Independently reconstruct source gross for PRE and verify target against exact Node enrichment.
def gross_features(r):
 price=float(r["entryPrice"] if "entryPrice" in r else r["entryReferenceOpen"])
 atr=float(r["atr"]);rank=int(r["rank"])
 distance=max(atr*2.477,price*.005)
 base=min(.0319/(distance/price),1.0)
 mult=1.0 if rank==3 else (1.75 if r["entryGateReason"]=="ALLOW_HC175" else 1.0)
 cap=.1 if rank==3 else 1.0*mult
 return min(base*mult,cap,1.0)
for r in pre:r["emptyPortfolioAcceptedGross"]=gross_features(r)
for r in target:
 g=gross_features(r)
 assert abs(g-float(r["emptyPortfolioAcceptedGross"]))<1e-11
# chronological PRE train/validation only
pre.sort(key=lambda x:(x["decisionTs"],x["symbol"],x["rank"]))
parts={"TRAIN":pre[:481],"VAL1":pre[481:721],"VAL2":pre[721:]}
numeric=["score","logVolumeRatio","absMomentum","logAtrRatio","emptyPortfolioAcceptedGross"]
def feat(r,f):
 if f=="logVolumeRatio":return math.log10(max(1e-12,float(r["volumeRatio"])))
 if f=="logAtrRatio":return math.log10(max(1e-12,float(r["atrRatio"])))
 return float(r[f])
def quant(a,p):
 v=sorted(a);x=(len(v)-1)*p;lo=int(math.floor(x));hi=int(math.ceil(x))
 return v[lo] if lo==hi else v[lo]*(hi-x)+v[hi]*(x-lo)
def metrics(a,pred,cost):
 blocked=[r for r in a if pred(r)];kept=[r for r in a if not pred(r)]
 base=[float(r["grossDirectionalReturn"])-cost/10000 for r in a]
 vals=[float(r["grossDirectionalReturn"])-cost/10000 for r in kept]
 def stat(v):
  gp=sum(x for x in v if x>0);gl=-sum(x for x in v if x<0)
  return {"n":len(v),"wr":sum(x>0 for x in v)/len(v) if v else None,
          "mean":statistics.mean(v) if v else None,"sum":sum(v),"pf":gp/gl if gl else None}
 b=stat(base);k=stat(vals)
 return {"blocked":len(blocked),"kept":len(kept),"base":b,"after":k,
         "deltaWR":k["wr"]-b["wr"] if vals else None,"deltaMean":k["mean"]-b["mean"] if vals else None,
         "deltaSum":k["sum"]-b["sum"] if vals else None}
rules=[]
train=parts["TRAIN"]
for f in numeric:
 ts=[quant([feat(r,f) for r in train],p) for p in (.25,.5,.75)]
 for t in ts:
  for op in ("LE","GE"):
   rules.append({"kind":"NUMERIC","feature":f,"op":op,"threshold":t})
rules += [
 {"kind":"CATEGORY","feature":"side","op":"EQ","threshold":"LONG"},
 {"kind":"CATEGORY","feature":"side","op":"EQ","threshold":"SHORT"},
 {"kind":"CATEGORY","feature":"entryGateReason","op":"EQ","threshold":"ALLOW_HC175"},
 {"kind":"CATEGORY","feature":"entryGateReason","op":"EQ","threshold":"ALLOW_STANDARD"},
 {"kind":"CATEGORY","feature":"rank","op":"EQ","threshold":1},
 {"kind":"CATEGORY","feature":"rank","op":"GE","threshold":2},
 {"kind":"CATEGORY","feature":"rank","op":"EQ","threshold":3},
]
def predicate(rule):
 if rule["kind"]=="NUMERIC":
  f,t,op=rule["feature"],rule["threshold"],rule["op"]
  return lambda r:(feat(r,f)<=t if op=="LE" else feat(r,f)>=t)
 f,t,op=rule["feature"],rule["threshold"],rule["op"]
 return lambda r:((r[f]==t) if op=="EQ" else (float(r[f])>=float(t)))
candidates=[]
for rule in rules:
 pred=predicate(rule);rec={**rule,"split":{}}
 for name,a in parts.items():rec["split"][name]={str(c):metrics(a,pred,c) for c in (10,30)}
 tr=rec["split"]["TRAIN"]["30"]
 frac=tr["blocked"]/tr["base"]["n"]
 if not (.10<=frac<=.50):continue
 # train: improve both hit rate and mean expectancy; don't retain a tiny book
 if any(rec["split"]["TRAIN"][str(c)]["deltaWR"]<.02 or rec["split"]["TRAIN"][str(c)]["deltaMean"]<=0
        for c in (10,30)):continue
 # validation must be non-vacuous and independently non-worse on WR/mean at both costs
 valid=True
 for name in ("VAL1","VAL2"):
  if rec["split"][name]["30"]["blocked"]<12:valid=False
  for c in (10,30):
   m=rec["split"][name][str(c)]
   if m["deltaWR"]<-1e-12 or m["deltaMean"]<-1e-12:valid=False
 rec["validationPass"]=valid
 if valid:
  # PRE-only selection score: weakest WR improvement across 3 slices.
  rec["preScore"]=min(rec["split"][name][str(c)]["deltaWR"] for name in ("TRAIN","VAL1","VAL2") for c in (10,30))
  candidates.append(rec)
candidates.sort(key=lambda z:(-z["preScore"],z["kind"],z["feature"],str(z["threshold"]),z["op"]))
selected=candidates[0] if candidates else None
# TARGET is opened only after selected PRE rule is fixed. Do not select a target winner.
targetResult=None
if selected:
 pred=predicate(selected)
 targetResult={str(c):metrics(target,pred,c) for c in (10,30)}
report={"status":"PRE_ONLY_SINGLE_GATE_SELECTION_TARGET_FALSIFICATION","preN":len(pre),"targetN":len(target),
 "preSplitSizes":{k:len(v) for k,v in parts.items()},
 "candidateRuleCountRaw":len(rules),"stablePreRuleCount":len(candidates),
 "selectedPreOnlyRule":selected,"targetResultForSelected":targetResult,
 "selectionContract":"thresholds from TRAIN quartiles; single condition only; block 10-50%; TRAIN +2pp WR and positive mean delta; VAL1/VAL2 >=12 triggers and non-worse WR/mean; choose best worst-fold WR delta BEFORE target",
 "limitations":["PRE funding unavailable: labels use price-return minus fee only","Frozen 2026 source policy replayed retrospectively into PRE/TARGET","TARGET result is standalone candidate falsification, not integrated account result"],
 "hashes":{"preExit":hashlib.sha256((D/"pre-native-v12-source-exits-no-funding.jsonl").read_bytes()).hexdigest(),
 "targetSource":hashlib.sha256((D/"asof-native-v12-source-signals-gross-enriched.jsonl").read_bytes()).hexdigest(),
 "targetExit":hashlib.sha256((D/"native_exit_h1_funding_independent_audit.jsonl").read_bytes()).hexdigest()}}
out=R/"DIRECTION_RESEARCH_20261109"/"native_v12_pretrained_single_gate_target_falsification_20261110.json"
out.write_text(json.dumps(report,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
print("STABLE",len(candidates))
for z in candidates[:15]:
 print("RULE",z["kind"],z["feature"],z["op"],z["threshold"],"score",z["preScore"],
       "blocks",[z["split"][n]["30"]["blocked"] for n in ("TRAIN","VAL1","VAL2")],
       "dwr",[round(z["split"][n]["30"]["deltaWR"],4) for n in ("TRAIN","VAL1","VAL2")])
if selected:
 print("SELECTED",selected["kind"],selected["feature"],selected["op"],selected["threshold"])
 print("TARGET10",targetResult["10"]);print("TARGET30",targetResult["30"])
print("OUT",out)
