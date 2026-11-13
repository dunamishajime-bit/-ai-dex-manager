import runpy,contextlib,io,json,math,statistics,hashlib
from pathlib import Path
SRC=Path(r"C:\tmp\disdex-bt-20251001-20261001\hype_h48r4_market_regime_gate_pretarget_v1_20261113.py")
with contextlib.redirect_stdout(io.StringIO()):
 ns=runpy.run_path(str(SRC))
splits=ns["splits"];tar=ns["tar"];fwd=ns["fwd"];stat=ns["stat"]
D=Path(r"C:\tmp\disdex-bt-20251001-20261001\DIRECTION_RESEARCH_20261109")
OUT=D/"hype_h48_consensus_discovery_validation_v1_20261114.json"
features=["h6","h12","h24","h72","b6","b12","b24","b72","rel6","rel12","rel24","rel72","er24","pos24","rv24","brv24"]
def qv(vals,q):
 s=sorted(vals);p=(len(s)-1)*q;lo=int(p);hi=min(lo+1,len(s)-1);w=p-lo;return s[lo]*(1-w)+s[hi]*w
def hit_atom(x,a):
 f,op,v,q=a;z=x["f"][f];return z<=v if op=="<=" else z>=v
def hit_rule(x,r):return all(hit_atom(x,a) for a in r)
train=splits["TRAIN"];valid=splits["VALID"];hold=splits["PREHOLD"]
atoms=[]
for f in features:
 vals=[x["f"][f] for x in train]
 for q in (.15,.25,.35,.5,.65,.75,.85):
  v=qv(vals,q);atoms.append((f,"<=",v,q));atoms.append((f,">=",v,q))
rules=[(a,) for a in atoms]
for i,a in enumerate(atoms):
 for b in atoms[i+1:]:
  if a[0]!=b[0]:rules.append((a,b))
train_ok=[]
for r in rules:
 xs=[x for x in train if hit_rule(x,r)];m=stat(xs,.003)
 if m["n"]>=3 and m["mean"]>0 and m["pf"]>1 and m["wr"]>=.5:
  score=m["mean"]+.0001*m["n"]
  train_ok.append({"rule":r,"TRAIN30":m,"trainScore":score})
train_ok.sort(key=lambda z:z["trainScore"],reverse=True)
# Validation survival, not target.
valid_ok=[]
for z in train_ok[:500]:
 xs=[x for x in valid if hit_rule(x,z["rule"])];m=stat(xs,.003)
 if m["n"]>=2 and m["mean"]>0 and m["pf"]>1 and m["wr"]>=.5:
  zz=dict(z);zz["VALID30"]=m;zz["validScore"]=min(z["TRAIN30"]["mean"],m["mean"])-.5*abs(z["TRAIN30"]["mean"]-m["mean"])
  valid_ok.append(zz)
valid_ok.sort(key=lambda z:z["validScore"],reverse=True)
def ensemble_eval(pool,rows):
 out=[]
 for x in rows:
  votes=sum(hit_rule(x,z["rule"]) for z in pool)
  frac=votes/len(pool) if pool else 0
  if frac>=.5:
   y=dict(x);y["consensus"]=frac;out.append(y)
 return out
cases={}
for n in (10,20):
 pool=valid_ok[:n]
 h=ensemble_eval(pool,hold)
 t=ensemble_eval(pool,tar)
 f=ensemble_eval(pool,fwd)
 cases[f"TOP{n}_VOTE50"]={
  "ensembleSize":len(pool),"voteThreshold":.5,
  "TRAIN30":stat(ensemble_eval(pool,train),.003),
  "VALID30":stat(ensemble_eval(pool,valid),.003),
  "PREHOLD30":stat(h,.003),
  "TARGET30":stat(t,.003),"TARGET10":stat(t,.001),
  "FORWARD30":stat(f,.003),"FORWARD10":stat(f,.001),
  "targetRows":t,"forwardRows":f,
  "rules":[{"rule":[list(a) for a in z["rule"]],"TRAIN30":z["TRAIN30"],"VALID30":z["VALID30"],"validScore":z["validScore"]} for z in pool]
 }
obj={"status":"RESEARCH_ONLY_HYPE_CONSENSUS_DISCOVERY_VALIDATION","selectionUsesTarget":False,
 "pipeline":"TRAIN rule discovery -> VALID survivor/rank -> fixed 50% consensus -> PREHOLD holdout -> TARGET/FORWARD evaluation",
 "trainRuleN":len(train_ok),"validSurvivorN":len(valid_ok),"cases":cases}
OUT.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
print("SAVED",OUT,"SHA256",hashlib.sha256(OUT.read_bytes()).hexdigest(),"TRAINRULE",len(train_ok),"VALIDSURV",len(valid_ok))
for k,c in cases.items():
 print(k,"TRAIN",c["TRAIN30"],"VALID",c["VALID30"],"PREHOLD",c["PREHOLD30"],"TARGET",c["TARGET30"],"FORWARD",c["FORWARD30"])