#!/usr/bin/env python3
"""Read-only Y06 native-exit-aware risk study. Closed H1 signal => next H1 OPEN hypothetical fill.
Replay does not simulate orders, stops, funding, portfolio competition or gross exposure."""
import collections, datetime as dt, gzip, hashlib, json, math, os
from pathlib import Path

ROOT=Path(os.environ.get("DISDEX_BT_ROOT",r"C:\tmp\disdex-bt-20251001-20261001"))
SOURCE=ROOT/"V4_Y06_HISTORICAL_DUALSIDE_20261109"/"y06-dualside-modeled.jsonl"
OUT=ROOT/"DIRECTION_RESEARCH_20261109"
H=3600000
def digest(p):
 h=hashlib.sha256()
 with open(p,"rb") as z:
  for part in iter(lambda:z.read(2**20),b""): h.update(part)
 return h.hexdigest()
allrows=[json.loads(t) for t in SOURCE.open(encoding="utf-8") if t.strip()]
events=sorted((r for r in allrows if r["mode"]=="NATIVE"),key=lambda r:(r["entryTs"],r["candidateIndex"]))
assert len(events)==352
data={}
for sym in sorted({r["symbol"] for r in events}):
 p=ROOT/"aster-public-v3-h1"/f"{sym}-1h-20250924-20261001.jsonl.gz"
 with gzip.open(p,"rt",encoding="utf8") as g:
  data[sym]={int(a[0]):tuple(float(v) for v in a[1:5]) for a in (json.loads(z) for z in g if z.strip())}
warnings=collections.Counter()
paths=[]
for r in events:
 candles=data[r["symbol"]];entry=r["entryTs"];end=r["exitTs"]
 if entry in candles:
  if abs(candles[entry][0]-r["entryPrice"])>1e-9:warnings["entry_open_diff"]+=1
 else:warnings["entry_bar_missing"]+=1
 if end in candles:
  if abs(candles[end][0]-r["exitPrice"])>1e-9:warnings["exit_open_diff"]+=1
 else:warnings["exit_bar_missing"]+=1
 if abs((r["entryPrice"]-r["exitPrice"])/r["entryPrice"]-r["rawReturn"])>1e-9:
  warnings["pnl_formula_diff"]+=1
 steps=[]
 for h in range(1,(end-entry)//H):
  prior=candles.get(entry+(h-1)*H)
  nxt=candles.get(entry+h*H)
  if prior is None or nxt is None:
   steps.append(None);continue
  close_unreal=(r["entryPrice"]-prior[3])/r["entryPrice"]
  open_exit=(r["entryPrice"]-nxt[0])/r["entryPrice"]
  steps.append((h,close_unreal,open_exit))
 paths.append(steps)
splits={"train":list(range(211)),"validation":list(range(211,281)),"test":list(range(281,352))}
fit_mature=[i for i in splits["train"] if events[i]["exitTs"]<events[211]["entryTs"]]
cal_mature=[i for i in splits["validation"] if events[i]["exitTs"]<events[281]["entryTs"]]
assert len(fit_mature)>100 and len(cal_mature)>25
def label(i):return events[i]["rawReturn"]
def summary(ids):
 sub=[events[i] for i in ids]
 return dict(n=len(ids),win=sum(r["rawReturn"]>0 for r in sub),raw_return_sum=sum(r["rawReturn"] for r in sub),
  losses_below_5pct=sum(r["rawReturn"]<=-.05 for r in sub),losses_below_10pct=sum(r["rawReturn"]<=-.10 for r in sub),
  by_exit_reason=dict(collections.Counter(r["exitReason"] for r in sub)),
  return_by_reason={reason:dict(n=len(z),raw_sum=sum(r["rawReturn"] for r in z),
     win=sum(r["rawReturn"]>0 for r in z))
    for reason in sorted({r["exitReason"] for r in sub})
    for z in [[r for r in sub if r["exitReason"]==reason]]})
base={k:summary(v) for k,v in splits.items()}
horizon={}
for h in [1,2,3,4,6,12,24,48]:
 horizon[str(h)]={}
 for name,ids in splits.items():
  observed=[i for i in ids if len(paths[i])>=h and paths[i][h-1] is not None]
  under=[i for i in observed if paths[i][h-1][1]<0]
  later_positive=[i for i in under if events[i]["rawReturn"]>0]
  horizon[str(h)][name]=dict(observable=len(observed),unrealized_loss=len(under),
   originally_correct_recoveries=len(later_positive),later_native_losses=len(under)-len(later_positive))
def first_hit(i,kind,minh,th,ret_floor):
 peak=-1e9;prev=None
 for step in paths[i]:
  if step is None:prev=None;continue
  h,p,early=step
  if kind=="adverse":trigger=h>=minh and p<=-th
  elif kind=="confirm2":trigger=h>=minh and prev is not None and p<=-th and prev<=-th
  else:trigger=h>=minh and peak>=th and p<=ret_floor
  if trigger:return h,early
  peak=max(peak,p);prev=p
 return None
rules=[]
for mh in [2,4,6,12,24]:
 for th in [.005,.01,.015,.02,.03,.04,.05]:
  for kind in ["adverse","confirm2"]:rules.append((kind,mh,th,None))
for mh in [2,4,6,12]:
 for peak in [.01,.02,.03]:
  for floor in [-.005,0,.005,.01]:
   if floor<peak:rules.append(("giveback",mh,peak,floor))
results=[]
def part(ids,diffs,fire):
 obs=[i for i in ids if fire[i]]
 deltas=[diffs[i] for i in ids]
 return dict(n=len(ids),triggered=len(obs),beneficial=sum(d>1e-9 for d in deltas),
  harmed=sum(d< -1e-9 for d in deltas),delta_sum=sum(deltas),
  damaged_original_winners=sum(events[i]["rawReturn"]>0 and diffs[i]<-1e-9 for i in obs),
  originally_correct=sum(events[i]["rawReturn"]>0 for i in ids),
  worst_trade_delta=min(deltas),best_trade_delta=max(deltas))
for kind,mh,th,floor in rules:
 diffs=[0.0]*len(events);fire=[False]*len(events)
 for i in range(len(events)):
  candidate=first_hit(i,kind,mh,th,floor)
  if candidate is not None:
   fire[i]=True
   diffs[i]=candidate[1]-events[i]["rawReturn"]
 row=dict(kind=kind,min_hours=mh,threshold=th,floor=floor,
  train=part(splits["train"],diffs,fire),
  matured_train=part(fit_mature,diffs,fire),
  validation=part(splits["validation"],diffs,fire),
  matured_validation=part(cal_mature,diffs,fire),
  test=part(splits["test"],diffs,fire))
 results.append(row)
viable=[r for r in results if r["matured_train"]["triggered"]>=10 and
 r["matured_validation"]["triggered"]>=5 and
 r["matured_train"]["delta_sum"]>0 and r["matured_validation"]["delta_sum"]>0]
viable.sort(key=lambda x:min(x["matured_train"]["delta_sum"] / len(fit_mature),
 x["matured_validation"]["delta_sum"]/len(cal_mature)),reverse=True)
# Group overlapping native trade intervals; not independent samples within a cluster.
clusters=[]
for i,r in enumerate(events):
 if not clusters or r["entryTs"]>=clusters[-1]["end"]:
  clusters.append(dict(start=r["entryTs"],end=r["exitTs"],events=[i]))
 else:
  clusters[-1]["end"]=max(r["exitTs"],clusters[-1]["end"])
  clusters[-1]["events"].append(i)
result=dict(status="RESEARCH_NOT_APPROVED",route="REC_Y06_REV_D0_T72",
 source_sha256=digest(SOURCE),source_runtime_sha=events[0]["sourceRuntimeSha"],
 warnings=dict(warnings),price_parity_caution="Native guard/STOP exits need NOT match hourly OPEN; current/native exit prices are preserved",
 n=352,splits=base,cutoff_maturity=dict(train=len(fit_mature),validation=len(cal_mature)),
 horizon_underwater=horizon,
 overlap=dict(episodes=len(clusters),largest_episode_events=max(len(x["events"]) for x in clusters)),
 assumptions=["native exit reason, timestamp and price held fixed",
  "first signal from completed H1 close and hypothetical exit at NEXT H1 OPEN",
  "potential exit before original actual exit only",
  "no funding, microstructure/slippage, shared risk, leverage, Gross competition or portfolio DD",
  "many simultaneous threshold tests; results are exploratory only"],
 policy_count=len(results),positive_train_and_matured_validation=len(viable),
 top20_mature_selection_and_test=[x for x in viable[:20]],all_policies=results)
target=OUT/"v4_y06_native_exit_aware_early_exit_grid_20261110.json"
target.write_text(json.dumps(result,indent=2)+"\n",encoding="utf-8")
print("RESULT",str(target))
print("WARNINGS",dict(warnings))
print("BASELINE",[(k,v["by_exit_reason"],v["raw_return_sum"]) for k,v in base.items()])
print("CAUSAL",result["cutoff_maturity"],"OVERLAP",result["overlap"])
print("HORIZON6",horizon["6"])
print("POLICY_COUNT",len(results),"MATURE_TRAINVAL_POSITIVE",len(viable))
for r in viable[:10]:
 print("RULE",r["kind"],r["min_hours"],r["threshold"],r["floor"],
 [(s,round(r[s]["delta_sum"],4),r[s]["triggered"],r[s]["beneficial"],r[s]["harmed"],r[s]["damaged_original_winners"]) for s in ["matured_train","matured_validation","test"]])
