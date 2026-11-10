#!/usr/bin/env python3
"""Screen preregistered price-only market-state flags against target and forward outcomes.
No thresholds are tuned here; all definitions come from preperiod price quantiles.
This is diagnostic/multiple-testing, not rule acceptance.
"""
from pathlib import Path
import csv,datetime as dt,json,statistics,collections,hashlib
R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
D=R/"DIRECTION_RESEARCH_20261109"
S=D/"MARKET_STATE_CAUSAL_20261110"
states=[json.loads(x) for x in (S/"candidate_entry_market_states.jsonl").open(encoding="utf8") if x.strip()]
sm={int(x["decisionTs"]):x for x in states}
FLAGS=sorted(next(iter(sm.values()))["flags"])
def ts(s):return int(dt.datetime.fromisoformat(s.replace("Z","+00:00")).timestamp()*1000)
def stats(vals):
 if not vals:return {"n":0}
 w=[x for x in vals if x>0];l=[x for x in vals if x<=0]
 return {"n":len(vals),"wr":len(w)/len(vals),"sum":sum(vals),"mean":statistics.mean(vals),
  "pf":sum(w)/-sum(l) if sum(l)<0 else None}
# Integrated target baseline, normalize each trade net PnL by original notional to compare across compounding.
target={}
for cost in [10,30]:
 p=R/"VPS_DD_V4_SORT_PINNED_STOCK15_20261110"/f"Y06_NATIVE_LIFECYCLE_M5_AB_{cost}BPS_FILLS.csv"
 with p.open(encoding="utf-8-sig",newline="") as f:a=list(csv.DictReader(f))
 rows=[]
 for z in a:
  t=ts(z["entry_utc"]);st=sm.get(t)
  assert st is not None,(cost,z["entry_utc"],z["strategy"])
  ret=float(z["net_pnl_jpy"])/float(z["notional_jpy"])
  rows.append((z,st,ret))
 target[str(cost)]={"ALL":stats([r for _,_,r in rows])}
 for flag in FLAGS:
  yes=[r for _,st,r in rows if st["flags"][flag]]
  no=[r for _,st,r in rows if not st["flags"][flag]]
  target[str(cost)][flag]={"flagged":stats(yes),"unflagged":stats(no),
   "flaggedByRunner":dict(collections.Counter(z["strategy"] for z,st,r in rows if st["flags"][flag]))}
 # crisis interval
 if cost==30:
  lo=ts("2026-06-03T04:00:00Z");hi=ts("2026-09-11T14:00:00Z")
  crisis=[(z,st,r) for z,st,r in rows if lo<=ts(z["entry_utc"])<=hi]
  target[str(cost)]["CRISIS_ALL"]=stats([r for _,_,r in crisis])
  target[str(cost)]["CRISIS_FLAGS"]={}
  for flag in FLAGS:
   target[str(cost)]["CRISIS_FLAGS"][flag]={
    "flagged":stats([r for _,st,r in crisis if st["flags"][flag]]),
    "unflagged":stats([r for _,st,r in crisis if not st["flags"][flag]])}
# Forward standalone native outcomes, union four strategies. Deduplicate IDLE dual modes by native-only.
forward=[]
specs=[
 ("IDLE",R/"FORWARD_HOLDOUT_20261001_20261108"/"IDLE_DUALSIDE_LIFECYCLE"/"idle-forward-dualside.jsonl","mode","NATIVE_SHORT"),
 ("PENGU",R/"FORWARD_HOLDOUT_20261001_20261108"/"PENGU_NATIVE_LIFECYCLE"/"pengu-native-lifecycle-modeled-exits.jsonl",None,None),
 ("Q102",R/"FORWARD_HOLDOUT_20261001_20261108"/"Q102_SELECTED_BASE"/"q102-s34-selected-native-exits.jsonl",None,None),
 ("V4",R/"FORWARD_HOLDOUT_20261001_20261108"/"V4_DUALSIDE_LIFECYCLE"/"v4-forward-dualside-modeled-exits.jsonl","mode","NATIVE")]
for strat,p,k,v in specs:
 for line in p.open(encoding="utf8"):
  z=json.loads(line)
  if k and z.get(k)!=v:continue
  t=int(z["entryTs"]);st=sm.get(t)
  assert st is not None,(strat,t)
  forward.append((strat,z,st))
fwd={}
for cost in [10,30]:
 rows=[(s,z,st,float(z["rawReturn"])-cost/10000) for s,z,st in forward]
 fwd[str(cost)]={"ALL":stats([r for *_,r in rows])}
 for flag in FLAGS:
  yes=[r for _,_,st,r in rows if st["flags"][flag]]
  no=[r for _,_,st,r in rows if not st["flags"][flag]]
  fwd[str(cost)][flag]={"flagged":stats(yes),"unflagged":stats(no),
    "flaggedByRunner":dict(collections.Counter(s for s,z,st,r in rows if st["flags"][flag]))}
report={"status":"DIAGNOSTIC_FIXED_FLAGS_MULTIPLE_TESTING_TARGET_FORWARD_ALREADY_INSPECTED",
 "thresholdSource":"2025-03-01..2025-10-01 price-only distribution; no outcome thresholds",
 "stateTapeSha256":hashlib.sha256((S/"candidate_entry_market_states.jsonl").read_bytes()).hexdigest(),
 "flags":FLAGS,"target":target,"forward":fwd,
 "caveats":["A flag that looks good here is not clean OOS because target and forward outcomes have now been inspected.",
            "Integrated target returns are net PnL divided by entry notional; forward is standalone raw return minus fixed cost.",
            "Portfolio blocking must be replayed because freed Gross/slots can admit other trades."]}
out=D/"market_state_fixed_flag_target_forward_screen_20261110.json"
out.write_text(json.dumps(report,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
print("BASE TARGET 30",target["30"]["ALL"],"CRISIS",target["30"]["CRISIS_ALL"],"FWD",fwd["30"]["ALL"])
for flag in FLAGS:
 a=target["30"][flag]["flagged"];c=target["30"]["CRISIS_FLAGS"][flag]["flagged"];f=fwd["30"][flag]["flagged"]
 if a["n"] and (a.get("mean",0)<0 or c.get("mean",0)<0 or f.get("mean",0)<0):
  print("FLAG",flag,"TARGET",a,"CRISIS",c,"FWD",f)
print("OUTPUT",out)
