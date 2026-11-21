#!/usr/bin/env python3
"""PRISM VI counterfactual SELL limit at a fixed premium to LAST CLOSED H1.

A SELL limit at last-close * (1 + premium) is already knowable when SHORT
V20 natural signal is emitted. Positive-volume M5 print touching that level
is a *historical touch proxy*, NOT a verified filled order. Unfilled TTL
scenarios have no native trade; they are retained in economics denominators
as no-position, not silently removed from source cohort.

Stop-first quality check: after a touch, if high of any M5 until the next
H1 open crosses the +8% hard stop, flag conservative hard-stop risk. When
touch and hard-stop high occur in the SAME M5 the order is ambiguous;
never credit optimistic profitable exit in that bar.

Prespecified premiums and TTLs, do NOT choose using 53 trade outcomes.
"""
from __future__ import annotations
import bisect,datetime as dt,gzip,json
from pathlib import Path
from collections import defaultdict,Counter
ROOT=Path(r"C:\tmp\disdex-bt-20251001-20261001")
WORK=Path(r"C:\Users\dis\Documents\DisDex_Research\WINRATE_DEEP_20261122")
OUT=WORK/"phase2_results"
H=3600000;M=300000
PRE=WORK/"prebaseline_public_20250801_20250924";POST=WORK/"forward_public_20261001_20261118"
PREMIUMS=(.005,.01,.02)
TTL=(1,3,6)
parts=[
 PRE/"PENGUUSDT-5m-20250801-20250924.jsonl.gz",
 *sorted((ROOT/"aster-public-v3-5m-prefix").glob("PENGUUSDT-5m-*.jsonl.gz")),
 *sorted((ROOT/"aster-public-v3-5m-suffix").glob("PENGUUSDT-5m-*.jsonl.gz")),
 POST/"PENGUUSDT-5m-20261001-20261118.jsonl.gz"]
m={}
for file in parts:
 with gzip.open(file,"rt",encoding="utf8") as f:
  for line in f:
   x=json.loads(line);t=int(x[0])
   z=(float(x[1]),float(x[2]),float(x[3]),float(x[4]),float(x[5]),float(x[9]))
   if t in m and m[t]!=z:raise ValueError("M5_OVERLAP_CONFLICT")
   m[t]=z
tt=sorted(m)
def view(t1,t2):
 a=bisect.bisect_left(tt,t1);b=bisect.bisect_left(tt,t2)
 times=tt[a:b]
 if len(times)!=(t2-t1)//M or any(t!=t1+i*M for i,t in enumerate(times)):
  raise ValueError("M5_CANDLE_GAP:"+str((t1,t2,len(times))))
 return [(t,m[t]) for t in times]
h={}
for path in (PRE/"PENGUUSDT-1h-20250801-20250924.jsonl.gz",
 ROOT/"aster-public-v3-h1/PENGUUSDT-1h-20250924-20261001.jsonl.gz",
 POST/"PENGUUSDT-1h-20261001-20261118.jsonl.gz"):
 with gzip.open(path,"rt",encoding="utf8") as f:
  for line in f:
   x=json.loads(line);ts=int(x[0])
   if ts in h and h[ts]!=x:raise ValueError("H1_PENGU_DUPLICATE_CONFLICT")
   h[ts]=x
FILES=(
 ("PRE_2025_AUG_SEP",OUT/"native_lifecycle_prebaseline/pengu-native-lifecycle-modeled-exits.jsonl"),
 ("BASE_2025_2026",ROOT/"PENGU_NATIVE_LIFECYCLE_EXIT_20261109/pengu-native-lifecycle-modeled-exits.jsonl"),
 ("POST_2026_OCT_NOV",OUT/"native_lifecycle_forward/pengu-native-lifecycle-modeled-exits.jsonl"))
events=[]
for period,file in FILES:
 for line in file.open(encoding="utf8"):
  x=json.loads(line)
  if x["route"]!="SHORT_V20":continue
  entry=x["entryTs"]
  signalbar=h.get(entry-H)
  if not signalbar:raise ValueError("NO_PRICE_AT_SIGNAL_TIME")
  signalclose=float(signalbar[4])
  if not abs(signalclose-x["entryPrice"])<=x["entryPrice"]*.15:raise ValueError("SIGNAL_AND_ENTRY_PRICE_MISMATCH")
  for premium in PREMIUMS:
   limit=signalclose*(1+premium)
   hard=limit*1.08
   for ttl in TTL:
    print_window=view(entry,entry+ttl*H)
    first=next(((ts,z) for ts,z in print_window if z[4]>0 and z[1]>=limit),None)
    record={"schema":"prism6-short-sell-limit-print-touch/v1",
      "period":period,"sourceOriginalId":x["id"],
      "originalSourceEntryTs":entry,"nativeOriginalExitTs":x["exitTs"],
      "sourcePin":x["sourceRuntimeSha"],
      "limitPlacementTs":entry,"signalClosedH1Ts":entry-H,
      "signalReferenceClose":signalclose,"limitPremium":premium,
      "limitTTLHours":ttl,"limitSellPrice":limit,
      "historical_print_touches_limit":first is not None,
      "limit_touch_is_not_a_signed_fill":True}
    if first:
     touch,z=first
     nextH1=(touch//H+1)*H
     intra=view(touch,nextH1)
     dangerous=[(t,z) for t,z in intra if z[4]>0 and z[1]>=hard]
     post_touch=[q for t,q in intra if t>touch and q[4]>0]
     after_fill_low=min([limit]+[q[2] for q in post_touch])
     record.update({"fillModelPrice":limit,
       "firstTouchM5Ts":touch,"nativeEntryProcessFromH1Ts":nextH1,
       "hardStopPrice":hard,
       "post_touch_completed_M5_low_excluding_ambiguous_touch_bar":after_fill_low,
       "source_m5_positive_volume_at_touch":z[4],
       "same_touch_M5_crosses_hard_stop":any(t==touch for t,v in dangerous),
       "stop_cross_before_first_completed_H1":bool(dangerous),
       "first_intrahour_stop_M5":dangerous[0][0] if dangerous else None,
       "historical_touch_is_optimistic_proxy":True,
       "fillQuality":"AMBIGUOUS_SAME_BAR_STOP" if any(t==touch for t,v in dangerous) else "PUBLIC_M5_PRINT_TOUCH_NOT_SIGNED"})
    else:record.update({"fillQuality":"EXPIRED_UNTOUCHED_IN_HISTORICAL_TAPE"})
    events.append(record)
assert len(events)==53*len(PREMIUMS)*len(TTL)
(OUT/"PRISM6_PENGU_V20_SELL_LIMIT_53X9_PRINT_TOUCH_QUEUE.json").write_text(
 json.dumps({"schema":"prism6-v20-passive-sell-limit-asof-m5-queue/v1",
 "sourcePin":"1657e173d250ad58f53e62f7bb0a3428fb405496",
 "naturalTradeCount":53,"premiums":PREMIUMS,"ttlHours":TTL,
 "events":events,
 "sourceLimit":"Original SHORT signal close of COMPLETED H1, never future price",
 "executionDisclaimer":"Market OHLCV high>=SELL limit indicates prints touched limit, NOT that a hypothetical order would be signed/filled"
 },indent=2,ensure_ascii=False)+"\n",encoding="utf8")
for ttl in TTL:
 for premium in PREMIUMS:
  z=[x for x in events if x["limitTTLHours"]==ttl and x["limitPremium"]==premium]
  print("LIMIT_TOUCH",ttl,premium,"TOUCHED",sum(x["historical_print_touches_limit"] for x in z),
   "SAME_BAR_STOP_AMBIGUOUS",sum(x.get("same_touch_M5_crosses_hard_stop",False) for x in z),
   "EARLY_HARD_CROSS",sum(x.get("stop_cross_before_first_completed_H1",False) for x in z),flush=True)
print("PENGU_PASSIVE_LIMIT_M5_QUEUE_BUILT",len(events),flush=True)
