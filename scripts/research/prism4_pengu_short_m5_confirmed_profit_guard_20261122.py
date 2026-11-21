#!/usr/bin/env python3
"""PRISM IV SHORT V20: route-specific positive-volume M5 profit-protection.

NOT a new live strategy. This is exploratory research after already observing
all three cohorts; it CANNOT claim untouched OOS validation.

For each trade, resident STOP is unchanged until a sequence of completed M5
bars shows actual favorable CLOSE progress. Only then may a more protective
stop become effective from the next M5 interval. Stop-first checks both
original hard stop and armed earlier profit floor on positive-volume M5 prints.

Compares 6 frozen variants over prebaseline, native 2025/10-2026/09 and
forward 2026/10-Nov, reports trade count, winners, profit factor and
trade-return impact; account Gross/DD remain NOT modeled.
"""
from __future__ import annotations
import csv,datetime as dt,gzip,json,math,statistics,sys
from pathlib import Path
from collections import Counter
from bisect import bisect_left
R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
W=Path(r"C:\Users\dis\Documents\DisDex_Research\WINRATE_DEEP_20261122")
O=W/"phase2_results"
S=[
 ("PRE_AUG_SEP",O/"native_lifecycle_prebaseline/pengu-native-lifecycle-modeled-exits.jsonl"),
 ("BASE",R/"PENGU_NATIVE_LIFECYCLE_EXIT_20261109/pengu-native-lifecycle-modeled-exits.jsonl"),
 ("POST_OCT_NOV",O/"native_lifecycle_forward/pengu-native-lifecycle-modeled-exits.jsonl")]
GZ=[
 W/"prebaseline_public_20250801_20250924/PENGUUSDT-5m-20250801-20250924.jsonl.gz",
 *sorted((R/"aster-public-v3-5m-prefix").glob("PENGUUSDT-5m-*.jsonl.gz")),
 *sorted((R/"aster-public-v3-5m-suffix").glob("PENGUUSDT-5m-*.jsonl.gz")),
 W/"forward_public_20261001_20261118/PENGUUSDT-5m-20261001-20261118.jsonl.gz"]
M=300000
v={}
for f in GZ:
 with gzip.open(f,"rt",encoding="utf8") as stream:
  for line in stream:
   a=json.loads(line);ts=int(a[0])
   z=(float(a[1]),float(a[2]),float(a[3]),float(a[4]),float(a[5]))
   if ts in v and v[ts]!=z:raise ValueError("M5_SOURCE_DUPLICATE_CONFLICT")
   v[ts]=z
times=sorted(t for t,x in v.items() if x[4]>0)
policies=(("NATIVE",None,None),
 ("ARM2_FLOOR0P5",.02,.005),
 ("ARM3_FLOOR0P5",.03,.005),
 ("ARM5_FLOOR0P5",.05,.005),
 ("ARM3_FLOOR0",.03,0.),
 ("ARM5_FLOOR1P0",.05,.01),
 ("ARM8_FLOOR1P0",.08,.01))
rows=[]
for period,file in S:
 original=[json.loads(line) for line in file.open(encoding="utf8") if line.strip()]
 for e in original:
  if e["route"]!="SHORT_V20":continue
  entry=e["entryTs"];limit=e["exitTs"];ep=e["entryPrice"]
  if not entry<limit or ep<=0 or e["side"]!="SHORT":raise ValueError("BAD_ROUTE_INPUT")
  if e["partialEvents"]:raise ValueError("SHORT_ROUTE_UNEXPECTED_PARTIAL")
  k=bisect_left(times,entry);j=bisect_left(times,limit)
  bars=[(t,v[t]) for t in times[k:j]]
  if not bars:raise ValueError("NO_M5_PRINTS_WHILE_NATIVE_POSITION_OPEN")
  native=-e["rawReturn"] if False else e["rawReturn"]
  # Valid SHORT loss/return must be source signed quantity 1.
  assert abs(native-(1-e["exitPrice"]/ep))<1e-8
  for name,arm,floor in policies:
   effective=None;armed_at=None;trigger=None
   hard=ep*1.08
   if arm is not None:
    for t,b in bars:
     o,high,low,close,vol=b
     if effective is not None:
      stop=min(hard,effective)
      if high>=stop:
       fill=max(stop,o) # SHORT adverse gap over the resident STOP price
       trigger={"ts":t,"fillPrice":fill,"type":"PROTECTED_RESIDENT_STOP",
        "armed_at_m5_close_ts":armed_at,"gap":o>stop}
       break
     # Never apply a stop amendment before this M5 has closed.
     if effective is None and close<=ep*(1-arm):
      effective=ep*(1-floor)
      armed_at=t+M
    # A native hard stop could be located on its originating M5. This
    # alert is an execution-reconciliation question, not rewritten PnL.
   if trigger:
    gross=1-trigger["fillPrice"]/ep
    model="PROFIT_GUARD_AFTER_CONFIRMED_M5"
   else:
    gross=native
    model="PINNED_NATIVE_EXIT_UNCHANGED"
   rows.append({"period":period,"route":"SHORT_V20","id":e["id"],
    "entry_ts":entry,"source_exit_ts":limit,"source_exit_kind":e["exitReason"],
    "variant":name,"arm_close_pct":arm,"protected_floor_pct":floor,
    "m5_contemporaneous_confirmed":armed_at is not None,
    "armed_after_ts":armed_at,
    "early_stop_time":trigger["ts"] if trigger else None,
    "early_stop_price":trigger["fillPrice"] if trigger else None,
    "gap_over_stop":bool(trigger["gap"]) if trigger else False,
    "outcome":model,"net30_pct":100*(gross-.003),
    "native_net30_pct":100*(native-.003),"net10_pct":100*(gross-.001),
    "gross_price_pct":100*gross,
    "changed_signed_return_pct":100*(gross-native)})
def metric(xs):
 n=len(xs)
 wins=sum(x["net30_pct"]>0 for x in xs)
 pos=sum(max(0,x["net30_pct"]) for x in xs)
 neg=sum(max(0,-x["net30_pct"]) for x in xs)
 return {"n":n,"win30_n":wins,"win30_pct":round(100*wins/n,2),
  "mean_net30_pct":round(statistics.mean(x["net30_pct"] for x in xs),4),
  "sum_net30_pct":round(sum(x["net30_pct"] for x in xs),4),
  "price_profit_factor30":round(pos/neg,4) if neg>0 else None,
  "changed_count":sum(x["outcome"]!="PINNED_NATIVE_EXIT_UNCHANGED" for x in xs),
  "native_loser_to_guard_winner":sum(x["native_net30_pct"]<=0 and x["net30_pct"]>0 for x in xs),
  "native_winner_to_guard_loser":sum(x["native_net30_pct"]>0 and x["net30_pct"]<=0 for x in xs)}
groups=[]
for period in ("PRE_AUG_SEP","BASE","POST_OCT_NOV","ALL_SEEN_RESEARCH"):
 for name,*_ in policies:
  xs=[x for x in rows if x["variant"]==name and (period=="ALL_SEEN_RESEARCH" or x["period"]==period)]
  groups.append({"period":period,"variant":name,**metric(xs)})
for z in groups:print("PROTECT",z,flush=True)
def csvsave(name,items):
 cols=list(dict.fromkeys(k for x in items for k in x))
 with (O/name).open("w",encoding="utf-8-sig",newline="") as f:
  w=csv.DictWriter(f,cols);w.writeheader();w.writerows(items)
csvsave("PRISM4_PENGU_SHORT_V20_PRICE_GUARD_CANDIDATE_TRACE.csv",rows)
csvsave("PRISM4_PENGU_SHORT_V20_PRICE_GUARD_ABLATION.csv",groups)
(O/"PRISM4_PENGU_SHORT_V20_PRICE_GUARD_SUMMARY.json").write_text(json.dumps({
 "schema":"disdex-prism4-native-short-v20-confirmed-M5-profit-protection/v1",
 "source":"exact pinned native PENGU entry/exit 6+40+7 cases; public positive-volume 5m only",
 "sample_count":53,"ablations":groups,
 "red_flags":["Outcomes have ALREADY been observed in research, no new blind holdout",
 "Resident stop replacement and execution are only modeled; no exchange order version/readback",
 "A stop fill after a gap may differ from the public 5m opening price",
 "No model for shared Gross, holding opportunity, funding, total DD or account PnL",
 "Changing STOP on live positions is NOT authorized by this research; no deployment",
 "This route-specific protective experiment is not a substitute for wrong-direction entry improvements",
 "If profit floor increases early exits, native winner expectancy may collapse despite higher win fraction"
 ]},indent=2,sort_keys=True,ensure_ascii=False,allow_nan=False)+"\n",encoding="utf8")
print("PRISM4_PENGU_V20_EARLY_PROTECT_RESEARCH_COMPLETE",len(rows),flush=True)
