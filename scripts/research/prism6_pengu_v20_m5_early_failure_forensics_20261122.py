#!/usr/bin/env python3
"""PRISM VI — PENGU V20: early wrong-direction vs profit-giveback forensic.

Describes the *observed*, positive-trade-print M5 evidence at 1/3/6/12 H
from natural SHORT entry for the 53 original source-pinned candidates.

No training on target labels, no strategy overrides, no future data as entry
features, no exchange-order assertions. Exit reason and native profit are
diagnostic target labels only. Censor windows if native trade already ended.
"""
from __future__ import annotations
import csv,datetime as dt,gzip,json,math,statistics
from pathlib import Path
from bisect import bisect_left
from collections import Counter,defaultdict
ROOT=Path(r"C:\tmp\disdex-bt-20251001-20261001")
WORK=Path(r"C:\Users\dis\Documents\DisDex_Research\WINRATE_DEEP_20261122")
OUT=WORK/"phase2_results"
PRE=WORK/"prebaseline_public_20250801_20250924"
POST=WORK/"forward_public_20261001_20261118"
H=3600000;M=300000
PERIODS=[
 ("PRE_2025_AUG_SEP",OUT/"native_lifecycle_prebaseline/pengu-native-lifecycle-modeled-exits.jsonl"),
 ("BASE_2025_2026",ROOT/"PENGU_NATIVE_LIFECYCLE_EXIT_20261109/pengu-native-lifecycle-modeled-exits.jsonl"),
 ("POST_2026_OCT_NOV",OUT/"native_lifecycle_forward/pengu-native-lifecycle-modeled-exits.jsonl")]
FILES=[
 PRE/"PENGUUSDT-5m-20250801-20250924.jsonl.gz",
 *sorted((ROOT/"aster-public-v3-5m-prefix").glob("PENGUUSDT-5m-*.jsonl.gz")),
 *sorted((ROOT/"aster-public-v3-5m-suffix").glob("PENGUUSDT-5m-*.jsonl.gz")),
 POST/"PENGUUSDT-5m-20261001-20261118.jsonl.gz"
]
btc_files=[
 PRE/"BTCUSDT-1h-20250801-20250924-RESEARCH_M5QA.jsonl.gz",
 ROOT/"aster-public-v3-h1/BTCUSDT-1h-20250924-20261001.jsonl.gz",
 POST/"BTCUSDT-1h-20261001-20261118.jsonl.gz"]
b={}
for path in btc_files:
 with gzip.open(path,"rt",encoding="utf8") as f:
  for line in f:
   z=json.loads(line);t=int(z[0]);value=float(z[4])
   if t in b and b[t]!=value:raise ValueError("BTC_SOURCE_OVERLAP_CONFLICT")
   b[t]=value
m={}
for path in FILES:
 with gzip.open(path,"rt",encoding="utf8") as f:
  for line in f:
   z=json.loads(line);t=int(z[0])
   if len(z)<11:raise ValueError("M5_TAKER_BUY_NOT_AVAILABLE")
   row=(float(z[1]),float(z[2]),float(z[3]),float(z[4]),float(z[5]),float(z[9]))
   if row[4]<0 or not 0<=row[5]<=row[4]+1e-8:raise ValueError("M5_BAD_TAKER_VOLUME")
   if t in m and m[t]!=row:raise ValueError("M5_SOURCE_OVERLAP_CONFLICT")
   m[t]=row
times=sorted(m)
assert len(m)>100000
def window(t1,t2):
 start=bisect_left(times,t1);end=bisect_left(times,t2)
 raw=times[start:end]
 if len(raw)!=(t2-t1)//M or any(t!=t1+i*M for i,t in enumerate(raw)):
  raise ValueError("M5_SOURCE_HOLE_"+str((t1,t2,len(raw))))
 return [(t,m[t]) for t in raw]
def stream_stats(e,checkpoint):
 entry=e["entryTs"];end=e["exitTs"];t=entry+checkpoint*H
 if t>=end:return {"status":"NATIVE_EXIT_BEFORE_CHECKPOINT","checkpointH":checkpoint}
 past=window(entry,t)
 printed=[(ts,z) for ts,z in past if z[4]>0]
 if not printed:return {"status":"NO_POSITIVE_VOLUME_PRINT_BEFORE_CHECKPOINT",
  "checkpointH":checkpoint}
 last=printed[-1][1][3];ep=e["entryPrice"]
 favorable=max(0,max(1-z[2]/ep for ts,z in printed))
 adverse=max(0,max(z[1]/ep-1 for ts,z in printed))
 volume=sum(z[4] for ts,z in printed)
 buy=sum(z[5] for ts,z in printed)
 shares=buy/volume if volume>0 else None
 btc_prior=b.get(entry-H)
 btc_last=b.get(t-H)
 btc_change=(btc_last/btc_prior-1) if btc_prior and btc_last else None
 return {"status":"ASOF_COMPLETED","checkpointH":checkpoint,
  "max_favorable_pct":100*favorable,"max_adverse_pct":100*adverse,
  "last_close_vs_entry_pct":100*(last/ep-1),
  "taker_buy_fraction":shares,
  "btc_return_checkpoint":btc_change,
  "positive_print_M5":len(printed),"no_print_m5":len(past)-len(printed),
  "checkpointTs":t,"last_observed_printTs":printed[-1][0],
  "price_asof_source":True,
  "label_native_profit_not_a_feature":e["rawReturn"]-.003>0}
row=[]
for period,file in PERIODS:
 es=[json.loads(x) for x in file.open(encoding="utf8") if x.strip()]
 for e in es:
  if e["route"]!="SHORT_V20":continue
  for checkpoint in (1,3,6,12):
   r=stream_stats(e,checkpoint)
   row.append({"period":period,"source_trade_id":e["id"],
    "native_win30":e["rawReturn"]-.003>0,
    "native_reason":e["exitReason"],
    "native_return30_pct":100*(e["rawReturn"]-.003),
    "entryTs":e["entryTs"],"nativeExitTs":e["exitTs"],**r})
assert len(row)==53*4
def metrics(a):
 if not a:return {"n":0}
 r={"n":len(a),"wins":sum(x["native_win30"] for x in a)}
 for k in ("max_favorable_pct","max_adverse_pct","last_close_vs_entry_pct","taker_buy_fraction","btc_return_checkpoint"):
  vals=[x[k] for x in a if x.get(k) is not None]
  r["median_"+k]=round(statistics.median(vals),5) if vals else None
 return r
summ=[]
for period in ("PRE_2025_AUG_SEP","BASE_2025_2026","POST_2026_OCT_NOV","ALL_SEEN"):
 for checkpoint in (1,3,6,12):
  a=[x for x in row if (period=="ALL_SEEN" or x["period"]==period) and x["checkpointH"]==checkpoint]
  complete=[x for x in a if x["status"]=="ASOF_COMPLETED"]
  wins=[x for x in complete if x["native_win30"]]
  losses=[x for x in complete if not x["native_win30"]]
  summ.append({"period":period,"checkpointH":checkpoint,
    "total_original":len(a),"available_after_native_exit":len(complete),
    "before_checkpoint_native_exited":sum(x["status"]=="NATIVE_EXIT_BEFORE_CHECKPOINT" for x in a),
    "unscored_no_volume":sum(x["status"]=="NO_POSITIVE_VOLUME_PRINT_BEFORE_CHECKPOINT" for x in a),
    "winning_later":metrics(wins),"losing_later":metrics(losses)})
def savecsv(path,records):
 keys=list(dict.fromkeys(k for x in records for k in x))
 with path.open("w",newline="",encoding="utf-8-sig") as f:
  w=csv.DictWriter(f,keys);w.writeheader()
  for z in records:w.writerow(z)
savecsv(OUT/"PRISM6_PENGU_V20_M5_53_EARLY_CAUSAL_FORENSICS.csv",row)
(OUT/"PRISM6_PENGU_V20_M5_53_EARLY_CAUSAL_FORENSICS_SUMMARY.json").write_text(
 json.dumps({"schema":"prism6-pengu-v20-m5-early-causal-risk-attribution/v1",
 "source_trade_count":53,"checkpoint_hours":[1,3,6,12],
 "study":summ,
 "limitations":["Future profit labels are diagnostic only, never asof features",
 "Native source exits may preempt checkpoint; these are censored (NOT labeled zeros)",
 "Positive volume print is not a signed fill/price certainty",
 "Per-transaction results cannot infer portfolio DD or Profit Factor",
 "All data have been observed previously, not untouched OOS"]
 },ensure_ascii=False,indent=2,sort_keys=True,allow_nan=False)+"\n",encoding="utf8")
for x in summ:
 if x["checkpointH"] in (3,6):
  print("RISK_EARLY",x["period"],x["checkpointH"],"observed",x["available_after_native_exit"],
    "WIN",x["winning_later"],"LOSS",x["losing_later"],flush=True)
print("PRISM6_M5_EARLY_WINDOW_COMPLETE",len(row),flush=True)
