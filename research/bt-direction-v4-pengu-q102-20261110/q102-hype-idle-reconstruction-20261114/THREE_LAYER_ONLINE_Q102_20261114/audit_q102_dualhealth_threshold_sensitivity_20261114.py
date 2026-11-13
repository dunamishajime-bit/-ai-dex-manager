import json,csv,datetime as dt,itertools
from pathlib import Path
R=Path(r"C:\tmp\disdex-bt-20251001-20261001");D=R/"DIRECTION_RESEARCH_20261109"
rows=[json.loads(l) for l in (D/"three_layer_layer2_online_ensemble_20261114.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
byid={x["id"]:x for x in rows}
base=R/"S3_P3_HYPEWSIG_FORMALFREEENTRY_Q01365_RENDERWAIT_TAORISK12_CAUSAL_20261114"
fp=next(base.glob("*_30BPS_FILLS.csv"))
def ms(s):return int(dt.datetime.fromisoformat(s.replace("Z","+00:00")).timestamp()*1000)
with open(fp,newline="",encoding="utf-8-sig") as f:fills=list(csv.DictReader(f))
def active_max(t):
 vals=[]
 for z in fills:
  if ms(z["entry_utc"])<=t<ms(z["exit_utc"]):
   sc=byid.get(z["source_signal_id"])
   if sc and isinstance(sc.get("opportunityScore"),(int,float)):vals.append(sc["opportunityScore"])
 return max(vals) if vals else None
q=sorted([x for x in rows if x["strategy"]=="Q102" and x["realizedNet30"] is not None],key=lambda x:x["entryTs"])
for pmin,evmin,cmin in itertools.product((.58,.60,.62),(.001,.002,.003),(.40,.45,.50)):
 ids=[]
 for x in q:
  if x["layer1Kept"]:continue
  if x["predEV30"] is None or x["predWinProb"]<pmin or x["predEV30"]<=evmin or x["confidence"]<cmin or x["analogs"]<6:continue
  rc=(x.get("components") or {}).get("route")
  if not rc or rc.get("n",0)<6 or rc.get("mean",0)<=0 or rc.get("pwin",0)<pmin:continue
  prior=[z for z in q if z["route"]==x["route"] and z["exitTs"]<x["entryTs"]]
  if len(prior)<6:continue
  m5=sum(z["realizedNet30"] for z in prior[-5:])/5
  m6=sum(z["realizedNet30"] for z in prior[-6:])/6
  if m5<=evmin or m6<=evmin:continue
  am=active_max(int(x["entryTs"]))
  if am is not None and x["opportunityScore"]<=am:continue
  ids.append(x["id"])
 print(f"p={pmin:.2f} ev={evmin:.3f} c={cmin:.2f} -> {ids}")