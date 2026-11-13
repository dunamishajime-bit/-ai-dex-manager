import json,csv,datetime as dt
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
qrows=sorted([x for x in rows if x["strategy"]=="Q102" and x["realizedNet30"] is not None],key=lambda x:x["entryTs"])
for win in (3,4,5,6,8,10):
 sel=[]
 for x in qrows:
  if x["layer1Kept"] or not x["layer2Promote"]:continue
  rc=(x.get("components") or {}).get("route")
  if not rc or rc.get("n",0)<5 or rc.get("mean",0)<=0 or rc.get("pwin",0)<.60:continue
  prior=[z for z in qrows if z["route"]==x["route"] and z["exitTs"]<x["entryTs"]]
  recent=prior[-win:]
  if len(recent)<win:continue
  m=sum(z["realizedNet30"] for z in recent)/win
  if m<=.002:continue
  am=active_max(int(x["entryTs"]))
  if am is not None and x["opportunityScore"]<=am:continue
  sel.append((x["id"],x["route"],m,x["realizedNet30"]))
 print("WIN",win,"N",len(sel),"IDS",[x[0] for x in sel])
 print(" DETAILS",[(a,b,round(c,4),round(d,4)) for a,b,c,d in sel])