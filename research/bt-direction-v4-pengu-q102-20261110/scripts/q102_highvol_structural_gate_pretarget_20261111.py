#!/usr/bin/env python3
from pathlib import Path
import json,datetime as dt,hashlib,itertools,math,collections

R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
PRE=R/"PREPERIOD_TRAIN_20240101_20251001"/"Q102_HIGHVOL_BINANCE_PROXY"/"q102-highvol-pretarget-proxy-exits.jsonl"
TARGET=R/"Q102_CURRENT_PRODUCTION_REPLAY_AUDIT_20261110"/"q102-high-vol-base-exits.jsonl"
OUT=R/"DIRECTION_RESEARCH_20261109"/"q102_highvol_structural_gate_pretarget_20261111.json"
COST=.003

pre0=[json.loads(x) for x in PRE.read_text(encoding="utf-8").splitlines() if x.strip()]
tar0=[json.loads(x) for x in TARGET.read_text(encoding="utf-8").splitlines() if x.strip() and isinstance(json.loads(x).get("grossReturn"),(int,float))]

def row(z,retkey):
 f=z["features"]
 s=int(z["side"])
 rsi=float(f["rsi14"])
 return {
  "entryTs":int(z["entryTs"]),"ret":float(z[retkey]),"side":s,"symbol":z["symbol"],
  "signedTrend14":s*float(f["ret14d"]),
  "reversionMagnitude24":-s*float(f["ret24"]),
  "rsiExtreme":(50-rsi) if s==1 else (rsi-50),
  "atrPct":float(f["atrPct"]),"volumeRatio":float(f["volumeRatio"])
 }
pre=[row(z,"rawReturn") for z in pre0]
tar=[row(z,"grossReturn") for z in tar0]
T1=int(dt.datetime(2025,6,1,tzinfo=dt.timezone.utc).timestamp()*1000)
T2=int(dt.datetime(2025,8,1,tzinfo=dt.timezone.utc).timestamp()*1000)
train=[z for z in pre if z["entryTs"]<T1]
valid=[z for z in pre if T1<=z["entryTs"]<T2]
prehold=[z for z in pre if z["entryTs"]>=T2]
parts={"train":train,"valid":valid,"prehold":prehold}

def met(a):
 v=[z["ret"]-COST for z in a];gp=sum(x for x in v if x>0);gl=-sum(x for x in v if x<0)
 return {"n":len(v),"wr":sum(x>0 for x in v)/len(v) if v else None,
         "mean":sum(v)/len(v) if v else None,"sum":sum(v),
         "pf":gp/gl if gl else (999.0 if gp>0 else None),
         "worst":min(v) if v else None}
base={k:met(v) for k,v in parts.items()}
features={
 "signedTrend14":">=",
 "reversionMagnitude24":">=",
 "rsiExtreme":">=",
 "atrPct":"<=",
 "volumeRatio":"<=",
}
quantiles=(.2,.35,.5,.65,.8)

def qval(a,f,q):
 xs=sorted(z[f] for z in a)
 return xs[round((len(xs)-1)*q)]
atoms=[]
for f,op in features.items():
 for q in quantiles:
  atoms.append({"feature":f,"op":op,"q":q,"threshold":qval(train,f,q)})

def passes(z,rules):
 for r in rules:
  x=z[r["feature"]];t=r["threshold"]
  if r["op"]==">=":
   if x<t:return False
  else:
   if x>t:return False
 return True
def eval_rule(rules):
 ms={}
 for k,a in parts.items(): ms[k]=met([z for z in a if passes(z,rules)])
 return ms
def retain_ok(ms):
 for k,a in parts.items():
  if ms[k]["n"]<max(5,math.ceil(len(a)*.30)):return False
 return True
def robust(ms):
 if not retain_ok(ms):return False
 # No split may become economically negative.
 if any(ms[k]["mean"] is None or ms[k]["mean"]<=0 or (ms[k]["pf"] or 0)<=1 for k in parts):return False
 # True pretarget out-of-sample validation and prehold must not lose win-rate and must improve mean by at least 5%.
 for k in ("valid","prehold"):
  if ms[k]["wr"]+1e-15 < base[k]["wr"]:return False
  if ms[k]["mean"]+1e-15 < base[k]["mean"]*1.05:return False
 return True

cands=[]
# Single-feature rules only first.
for a in atoms:
 ms=eval_rule([a]); cands.append({"rules":[a],"metrics":ms,"robust":robust(ms)})
# Predeclared structural pairs only; no arbitrary combinatorial data mining.
allowed_pairs={
 frozenset(("signedTrend14","atrPct")),
 frozenset(("signedTrend14","reversionMagnitude24")),
 frozenset(("signedTrend14","rsiExtreme")),
 frozenset(("reversionMagnitude24","atrPct")),
 frozenset(("rsiExtreme","atrPct")),
}
for a,b in itertools.combinations(atoms,2):
 if a["feature"]==b["feature"]:continue
 if frozenset((a["feature"],b["feature"])) not in allowed_pairs:continue
 ms=eval_rule([a,b]);cands.append({"rules":[a,b],"metrics":ms,"robust":robust(ms)})

rob=[x for x in cands if x["robust"]]
# Stability: a rule family must have at least 2 robust nearby quantile variants.
family_counts=collections.Counter()
for x in rob:
 fam=tuple(sorted(r["feature"] for r in x["rules"]));family_counts[fam]+=1
rob=[x for x in rob if family_counts[tuple(sorted(r["feature"] for r in x["rules"]))]>=2]

def rank(x):
 m=x["metrics"]
 return (-len(x["rules"]),min(m["valid"]["pf"],m["prehold"]["pf"]),
         min(m["valid"]["mean"],m["prehold"]["mean"]),
         m["valid"]["n"]+m["prehold"]["n"])
rob.sort(key=rank,reverse=True)
selected=rob[0] if rob else None

target_eval=None
if selected:
 sel=[z for z in tar if passes(z,selected["rules"])]
 target_eval={"baseline":met(tar),"selected":met(sel),"removed":met([z for z in tar if not passes(z,selected["rules"])]),
              "keptN":len(sel),"removedN":len(tar)-len(sel)}
out={
 "status":"Q102_HIGHVOL_STRUCTURAL_PRETARGET_TRAIN_VALID_PREHOLD_ONE_SHOT_TARGET",
 "split":{"train":"2025-01-01..2025-05-31","validation":"2025-06-01..2025-07-31","prehold":"2025-08-01..2025-09-30"},
 "costBps":30,"baseline30":base,"candidateRules":len(cands),"robustRules":len(rob),
 "familyRobustCounts":{"|".join(k):v for k,v in family_counts.items()},
 "selectedPretargetOnly":selected,
 "targetOneShot":target_eval,
 "method":[
   "Thresholds are train quantiles only.",
   "Only five predeclared structural features and five predeclared feature-pair families are tested.",
   "Validation and prehold must both remain positive, retain >=30%, not lose win rate, and improve mean >=5%.",
   "Target 2025-10..2026-10 is read only after the pretarget rule is frozen."
 ],
 "hashes":{"pre":hashlib.sha256(PRE.read_bytes()).hexdigest(),"target":hashlib.sha256(TARGET.read_bytes()).hexdigest()},
 "warning":"Binance UM pretarget is a venue proxy; target is Aster bar replay, not signed fills."
}
OUT.write_text(json.dumps(out,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
print("BASE",json.dumps(base,separators=(",",":")))
print("CANDIDATES",len(cands),"ROBUST",len(rob),"FAMILIES",family_counts)
if selected:
 print("SELECTED",json.dumps(selected,separators=(",",":")))
 print("TARGET",json.dumps(target_eval,separators=(",",":")))
else:print("SELECTED None")
print("OUT",OUT,"SHA256",hashlib.sha256(OUT.read_bytes()).hexdigest())
