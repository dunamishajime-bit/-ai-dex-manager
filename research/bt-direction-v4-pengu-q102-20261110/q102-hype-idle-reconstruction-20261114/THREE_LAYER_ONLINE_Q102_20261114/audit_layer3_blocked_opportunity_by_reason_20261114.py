import json,csv,collections
from pathlib import Path
R=Path(r"C:\tmp\disdex-bt-20251001-20261001");D=R/"DIRECTION_RESEARCH_20261109"
rows=[json.loads(l) for l in (D/"three_layer_layer2_online_ensemble_20261114.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
byid={x["id"]:x for x in rows}
base=R/"S3_P3_HYPEWSIG_FORMALFREEENTRY_Q01365_RENDERWAIT_TAORISK12_CAUSAL_20261114"
dp=next(base.glob("*_30BPS_DECISIONS.csv"))
with open(dp,newline="",encoding="utf-8-sig") as f:dec={z["signal_id"]:z for z in csv.DictReader(f)}
def met(xs):
 ys=[x["realizedNet30"] for x in xs if x["realizedNet30"] is not None]
 if not ys:return {"n":0}
 gp=sum(y for y in ys if y>0);gl=-sum(y for y in ys if y<0)
 return {"n":len(ys),"wr":sum(y>0 for y in ys)/len(ys),"mean":sum(ys)/len(ys),"sum":sum(ys),"pf":gp/gl if gl else 999.,"worst":min(ys)}
z=[]
for x in rows:
 d=dec.get(x["id"])
 if x["layer1Kept"] and x["layer2Promote"] and d and d["decision"]=="BLOCK":
  y=dict(x);y["reason"]=d["reason"];z.append(y)
print("TOTAL",met(z))
for reason,n in collections.Counter(x["reason"] for x in z).most_common():
 q=[x for x in z if x["reason"]==reason]
 print("\nREASON",reason,met(q),"STRAT",collections.Counter(x["strategy"] for x in q))
safe_conflict={"RUNNER_SLOT_BUSY","SYMBOL_BUSY","CRYPTO_GROSS_CAP","TOTAL_GROSS_CAP","STOCK_GROSS_CAP","IDLE_BASELINE_OPEN_OR_PENDING"}
q=[x for x in z if x["reason"] in safe_conflict]
print("\nOPPORTUNITY_CONFLICT_ONLY",met(q),"N",len(q))
for s in sorted(set(x["strategy"] for x in q)):
 w=[x for x in q if x["strategy"]==s]
 print(s,met(w),"REASONS",collections.Counter(x["reason"] for x in w))