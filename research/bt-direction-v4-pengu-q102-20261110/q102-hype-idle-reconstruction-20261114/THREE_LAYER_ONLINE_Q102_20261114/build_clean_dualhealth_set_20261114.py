import json,csv,datetime as dt,hashlib
from pathlib import Path
R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
D=R/"DIRECTION_RESEARCH_20261109"
rows=[json.loads(l) for l in (D/"three_layer_layer2_online_ensemble_20261114.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
byid={x["id"]:x for x in rows}
base=R/"S3_P3_HYPEWSIG_FORMALFREEENTRY_Q01365_RENDERWAIT_TAORISK12_CAUSAL_20261114"
fp=next(base.glob("*_30BPS_FILLS.csv"))
def ms(s): return int(dt.datetime.fromisoformat(s.replace("Z","+00:00")).timestamp()*1000)
with open(fp,newline="",encoding="utf-8-sig") as f: fills=list(csv.DictReader(f))
def active_max(t):
 vals=[]
 for z in fills:
  if ms(z["entry_utc"])<=t<ms(z["exit_utc"]):
   sc=byid.get(z["source_signal_id"])
   if sc and isinstance(sc.get("opportunityScore"),(int,float)): vals.append(sc["opportunityScore"])
 return max(vals) if vals else None

q=sorted([x for x in rows if x["strategy"]=="Q102" and x["realizedNet30"] is not None],key=lambda x:x["entryTs"])
sel=[]
for x in q:
 if x["layer1Kept"]: continue
 if x["predEV30"] is None or x["predWinProb"]<.60 or x["predEV30"]<=.002 or x["confidence"]<.45 or x["analogs"]<6: continue
 rc=(x.get("components") or {}).get("route")
 if not rc or rc.get("n",0)<6 or rc.get("mean",0)<=0 or rc.get("pwin",0)<.60: continue
 prior=[z for z in q if z["route"]==x["route"] and z["exitTs"]<x["entryTs"]]
 if len(prior)<6: continue
 m5=sum(z["realizedNet30"] for z in prior[-5:])/5
 m6=sum(z["realizedNet30"] for z in prior[-6:])/6
 w5=sum(z["realizedNet30"]>0 for z in prior[-5:])/5
 w6=sum(z["realizedNet30"]>0 for z in prior[-6:])/6
 if m5<=.002 or m6<=.002: continue
 am=active_max(int(x["entryTs"]))
 if am is not None and x["opportunityScore"]<=am: continue
 y=dict(x); y["recent5MeanNet30"]=m5; y["recent6MeanNet30"]=m6
 y["recent5WinRate"]=w5; y["recent6WinRate"]=w6; y["activeMaxOpportunity"]=am
 sel.append(y)

obj={
 "status":"RESEARCH_ONLY_THREE_LAYER_Q102_DUALHEALTH_CLEAN",
 "productionMutation":False,
 "selectionUsesCandidateOwnFutureOutcome":False,
 "policy":{
   "layer1":"existing Q102 candidate generation; suppressed routes remain shadow-only unless all later gates pass",
   "layer2":{"predWinProbMin":0.60,"predEV30MinExclusive":0.002,"confidenceMin":0.45,"analogsMin":6,
             "sameRouteCompletedMin":6,"sameRoutePwinMin":0.60,"sameRouteMeanNet30MinExclusive":0.0},
   "onlineRouteHealth":{"recentCompletedWindows":[5,6],"bothMeanNet30MinExclusive":0.002},
   "layer3":"candidate opportunityScore must exceed max scored baseline active opportunityScore when any exists",
   "gross":"preserve native candidate gross; cap at 1.0x only if higher",
   "safety":"existing Shared Risk, gross, Q102 one-slot, symbol ownership and fail-closed gates remain authoritative"
 },
 "ids":[x["id"] for x in sel],
 "candidates":sel
}
p=D/"three_layer_layer3_q102_dualhealth_clean_set_20261114.json"
p.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
print("SELECTED_N",len(sel),"IDS",obj["ids"])
for x in sel:
 print(x["id"],x["symbol"],x["side"],x["route"],
       "predEV",x["predEV30"],"p",x["predWinProb"],"conf",x["confidence"],
       "route_n",x["components"]["route"]["n"],"route_p",x["components"]["route"]["pwin"],
       "m5",x["recent5MeanNet30"],"m6",x["recent6MeanNet30"],
       "opp",x["opportunityScore"],"activeMax",x["activeMaxOpportunity"],
       "shadowReal",x["realizedNet30"])
print("SHA256",hashlib.sha256(p.read_bytes()).hexdigest())