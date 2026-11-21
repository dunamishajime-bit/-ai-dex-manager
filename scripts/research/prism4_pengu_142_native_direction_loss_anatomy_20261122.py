#!/usr/bin/env python3
"""PRISM IV PENGU direction-error anatomy for all three independent date cohorts.

Computes *diagnostic* post-entry MFE/MAE and causal pre-entry H1 features,
not a future-looking trading policy. Distinguishes:
  A. immediate adverse / no meaningful favorable progress,
  B. favorable excursion then giveback/late reversal,
  C. exit/funding/cost or model price issue.

Uses native pinned signal and exit function tapes, volume-positive public M5
to describe observed market path; reports no-print/invalid fill-source risk.
Research-only: no signed orders, venue fills, account Gross or LIVE writes.
"""
from __future__ import annotations
import csv,datetime as dt,gzip,json,math,statistics,sys
from pathlib import Path
from collections import defaultdict,Counter
from bisect import bisect_left
R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
W=Path(r"C:\Users\dis\Documents\DisDex_Research\WINRATE_DEEP_20261122")
O=W/"phase2_results"
PRE=W/"prebaseline_public_20250801_20250924"
POST=W/"forward_public_20261001_20261118"
H=3600000;M=300000
periods=[
 ("PRE_AUG_SEP_2025",O/"PENGU_2025_AUG_SEP_PREBASELINE_PINNED_RAW_SIGNALS.json",
   O/"native_lifecycle_prebaseline/pengu-native-lifecycle-modeled-exits.jsonl"),
 ("BASE_2025_2026",O/"PENGU_ORIGINAL_116_NATIVE_ASOF_FEATURES.json",
   R/"PENGU_NATIVE_LIFECYCLE_EXIT_20261109/pengu-native-lifecycle-modeled-exits.jsonl"),
 ("POST_OCT_NOV_2026",O/"PENGU_PINNED_FORWARD_SIGNALS.json",
   O/"native_lifecycle_forward/pengu-native-lifecycle-modeled-exits.jsonl")
]
files=[
 PRE/"PENGUUSDT-5m-20250801-20250924.jsonl.gz",
 *sorted((R/"aster-public-v3-5m-prefix").glob("PENGUUSDT-5m-*.jsonl.gz")),
 *sorted((R/"aster-public-v3-5m-suffix").glob("PENGUUSDT-5m-*.jsonl.gz")),
 POST/"PENGUUSDT-5m-20261001-20261118.jsonl.gz"]
market={}
for file in files:
 with gzip.open(file,"rt",encoding="utf8") as f:
  for line in f:
   a=json.loads(line);ts=int(a[0])
   value=(float(a[1]),float(a[2]),float(a[3]),float(a[4]),float(a[5]))
   if ts in market and market[ts]!=value:raise ValueError("OVERLAPPING_M5_SOURCE_CONFLICT")
   market[ts]=value
    # this file validates only price consistency and source timeliness.
all_active=sorted(t for t,b in market.items() if b[4]>0)
if len(market)<100000:raise ValueError("INSUFFICIENT_M5_COVERAGE")
def iso(ts):return dt.datetime.fromtimestamp(ts/1000,dt.timezone.utc).isoformat()
def weighted_exit_profit(x):
 side=1 if x["side"]=="LONG" else -1
 remaining=1.0;gross=0
 for e in x["partialEvents"]:
  part=remaining*e["closedQuantityFractionOfCurrent"]
  if not 0<part<=remaining:raise ValueError("BAD_PARTIAL")
  gross+=part*side*(e["price"]/x["entryPrice"]-1)
  remaining-=part
 gross+=remaining*side*(x["exitPrice"]/x["entryPrice"]-1)
 if abs(remaining-x["remainingQuantityFraction"])>1e-9:raise ValueError("PARTIAL_FRACTION_MISMATCH")
 return gross
def active(t1,t2):
 a=bisect_left(all_active,t1);b=bisect_left(all_active,t2)
 return [(t,market[t]) for t in all_active[a:b]]
def signed_excursion(trades,side,ep):
 if not trades:return None
 sg=1 if side=="LONG" else -1
 favorable=max(0,max((v[1]/ep-1) if sg==1 else (1-v[2]/ep) for t,v in trades))
 adverse=max(0,max((1-v[2]/ep) if sg==1 else (v[1]/ep-1) for t,v in trades))
 close=sg*(trades[-1][1][3]/ep-1)
 return {"mfe_pct":100*favorable,"mae_pct":100*adverse,
  "last_close_signed_pct":100*close,"n_m5_traded":len(trades),
  "last_m5_print_ts":trades[-1][0]}
rows=[]
for name,rawpath,exitpath in periods:
 obj=json.loads(rawpath.read_text(encoding="utf8"))
 signals=obj["signals"] if "signals" in obj else obj["candidates"]
 exitrows=[json.loads(s) for s in exitpath.open(encoding="utf8") if s.strip()]
 if len(signals)!=len(exitrows):raise ValueError("SIGNAL_EXIT_COVERAGE_MISMATCH")
 exc={(x["entryTs"],x["route"],x["side"]):x for x in exitrows}
 if len(exc)!=len(exitrows):raise ValueError("DUPLICATE_EXIT_KEY")
 for signal in signals:
  key=(signal["entryTs"],signal["route"],signal["side"])
  x=exc.get(key)
  if x is None:raise ValueError("NO_NATIVE_EXIT")
  t=x["entryTs"];ep=x["entryPrice"];end=x["exitTs"]
  if not t<end or ep<=0:raise ValueError("BAD_ENTRY_EXIT")
  first_h1=active(t,t+H)
  price=first_h1[0][1][0] if first_h1 else None
  delta=100*(price/ep-1) if price else None
  edge=weighted_exit_profit(x)
  path_by_time={}
  for duration in (3,6,12,24,48,72,120):
   finish=min(t+duration*H,end)
   path_by_time[str(duration)]=signed_excursion(active(t,finish),x["side"],ep)
  full=signed_excursion(active(t,end),x["side"],ep)
  if full is None:cat="INSUFFICIENT_TRADE_PRINTS"
  elif edge-.003>0:cat="WIN_NATIVE_EXIT_PRICE_MODEL"
  elif full["mfe_pct"]<1:cat="NO_FAVORABLE_ONE_PERCENT"
  elif full["mfe_pct"]>=3:cat="PROFIT_GIVEBACK_AFTER_MFE3"
  else:cat="MODEST_FAVORABLE_BUT_NET_LOSS"
  f=signal["features"]
  row={"period":name,"id":x["id"],"side":x["side"],"route":x["route"],
  "entry_ts":t,"entry_utc":iso(t),"exit_ts":end,"exit_utc":iso(end),
  "native_exit_reason":x["exitReason"],"entry_h1_open":ep,
  "exit_model_price":x["exitPrice"],"native_exit_return_pct":100*edge,
  "native_net30_pct":100*(edge-.003),"native_net10_pct":100*(edge-.001),
  "native_win30":edge>.003,"first_traded_m5_entry_ts":first_h1[0][0] if first_h1 else None,
  "first_traded_m5_entry_delay_mins":(first_h1[0][0]-t)/60000 if first_h1 else None,
  "first_traded_entry_price":price,
  "H1_reference_minus_first_traded_print_pct":delta,
  "entry_H1_has_no_print":not first_h1,
  "diagnostic_category":cat,
  "M5_alltime_prints":full["n_m5_traded"] if full else 0,
  "total_MFE_pct":full["mfe_pct"] if full else None,
  "total_MAE_pct":full["mae_pct"] if full else None,
  "H1_asof_source_PENGU_ret24":f["p24"],
  "H1_asof_source_PENGU_ret72":f["p72"],
  "H1_asof_source_BTC_ret24":f["b24"],
  "H1_asof_source_relative24":f["rel24"],
  "H1_asof_source_BTC_EMA168dist":f["btcEma168Dist"],
  "H1_asof_source_RSI14":f["rsi14"],
  "H1_asof_source_volRatio":f["volRatio"],
  "H1_asof_source_ATR24":f["atr24"],
  "checkpoints_post_entry_NO_GATE":path_by_time}
  rows.append(row)
assert len(rows)==142,len(rows)
def vec(xs,field):
 t=[float(r[field]) for r in xs if r[field] is not None]
 return round(statistics.median(t),5) if t else None
summaries=[]
for period in ("PRE_AUG_SEP_2025","BASE_2025_2026","POST_OCT_NOV_2026"):
 for route in ("SHORT_V20","RECOVERY_V8","LONG_V64","ALL"):
  rr=[r for r in rows if r["period"]==period and (route=="ALL" or r["route"]==route)]
  if not rr:continue
  win=[r for r in rr if r["native_win30"]];loss=[r for r in rr if not r["native_win30"]]
  summaries.append({"period":period,"route":route,"n":len(rr),"wins":len(win),
    "winrate30_pct":round(100*len(win)/len(rr),2),
    "mean_net30_pct":round(statistics.mean(r["native_net30_pct"] for r in rr),4),
    "source_fill_noprint":sum(r["entry_H1_has_no_print"] for r in rr),
    "source_entry_gt5bps":sum(r["H1_reference_minus_first_traded_print_pct"] is not None
      and abs(r["H1_reference_minus_first_traded_print_pct"])>.05 for r in rr),
    "fail_types":dict(Counter(r["diagnostic_category"] for r in loss)),
    "exit_reason_loss":dict(Counter(r["native_exit_reason"] for r in loss)),
    "median_asof_RSI_wins":vec(win,"H1_asof_source_RSI14"),
    "median_asof_RSI_losses":vec(loss,"H1_asof_source_RSI14"),
    "median_asof_BTC24_wins":vec(win,"H1_asof_source_BTC_ret24"),
    "median_asof_BTC24_losses":vec(loss,"H1_asof_source_BTC_ret24"),
    "median_asof_VOLratio_wins":vec(win,"H1_asof_source_volRatio"),
    "median_asof_VOLratio_losses":vec(loss,"H1_asof_source_volRatio"),
    "median_post_MFE_pct_wins":vec(win,"total_MFE_pct"),
    "median_post_MFE_pct_losses":vec(loss,"total_MFE_pct"),
    "median_post_MAE_pct_wins":vec(win,"total_MAE_pct"),
    "median_post_MAE_pct_losses":vec(loss,"total_MAE_pct")})
def tocsv(path,records):
 keys=list(dict.fromkeys(k for r in records for k in r))
 with path.open("w",encoding="utf-8-sig",newline="") as f:
  writer=csv.DictWriter(f,keys);writer.writeheader()
  for r in records:writer.writerow({k:json.dumps(v,ensure_ascii=False) if isinstance(v,dict) else v for k,v in r.items()})
tocsv(O/"PRISM4_PENGU_142_NATIVE_ENTRY_DIRECTION_LOSS_ANATOMY.csv",rows)
tocsv(O/"PRISM4_PENGU_142_NATIVE_DIRECTION_LOSS_SUMMARY.csv",summaries)
(O/"PRISM4_PENGU_142_NATIVE_DIRECTION_LOSS_SUMMARY.json").write_text(json.dumps({
 "schema":"disdex-prism4-pengu-route-direction-error-attribution/v1",
 "candidate_count":142,"groups":summaries,
 "claims_not_supported":[
 "Post-entry MFE/MAE must NEVER be used as pre-entry knowledge",
 "Positive volume historical M5 is not a guaranteed execution fill",
 "Native stop values are research model and not exchange signed fills",
 "No choice of new threshold made from the independent 2025 Aug-Sep or Oct-Nov period",
 "Small route denominators cannot certify 70/80% true win probabilities",
 "Full portfolio DD / gross / fee/funding not modeled in this per-trade decomposition"
 ]},ensure_ascii=False,indent=2,sort_keys=True,allow_nan=False)+"\n",encoding="utf8")
for z in summaries:
 if z["route"] in ("SHORT_V20","RECOVERY_V8","LONG_V64"):
  print("ERROR_ANATOMY",z["period"],z["route"],"N",z["n"],"WIN30",z["wins"],
        "FAIL",z["fail_types"],"STOP",z["exit_reason_loss"],
        "WIN_RSI",z["median_asof_RSI_wins"],"LOSS_RSI",z["median_asof_RSI_losses"],
        "WIN_BTC24",z["median_asof_BTC24_wins"],"LOSS_BTC24",z["median_asof_BTC24_losses"],flush=True)
print("PRISM4_PENGU_142_LOSS_ATTRIBUTION_RECALCULATED_PASS",flush=True)
