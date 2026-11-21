#!/usr/bin/env python3
"""PRISM III: trade-volume-aware PENGU native-entry and native-exit audit.

Do not treat zero-volume stale M5 closes/opens/highs as executable or as
H1 high/low inputs. Verify 12x M5 OHLCV reaggregation into H1 exactly.

Entrypoint / lifecycle:
- Market entries require an actual traded M5 bar *inside the entry H1*.
  If there are no trades, mark the original natural signal UNEXECUTABLE;
  do not silently assume a later order would be valid.
- Market/time/vol exits use the OPEN of first active M5 after native due ts;
  if no trade in 24h, UNRESOLVED (no fabricated exit).
- Model resident hard/trailing stops use first positive-volume M5 bar inside
  the native decision H1 whose traded high/low crosses the stored stop level.
  Price is conservative: a gap beyond the stop uses the first bar OPEN.
- Recovery partial native stop is separately filled and weighted; never
  count full final size after partial protection.

This is still a price-only counterfactual, NOT L2/signed fill/funding/account
gross/portfolio. No private APIs. No production writes.
"""
from __future__ import annotations
import csv,datetime as dt,gzip,hashlib,json,math,statistics,sys
from bisect import bisect_left
from collections import Counter,defaultdict
from pathlib import Path

ROOT=Path(r"C:\tmp\disdex-bt-20251001-20261001")
WORK=Path(sys.argv[1]) if len(sys.argv)>1 else Path(r"C:\Users\dis\Documents\DisDex_Research\WINRATE_DEEP_20261122")
FWD=WORK/"forward_public_20261001_20261118"
OUT=WORK/"phase2_results"
OUT.mkdir(parents=True,exist_ok=True)
H=3600000;M=300000
START=1759276800000
CUT=1790812800000
END=int(dt.datetime(2026,11,18,tzinfo=dt.timezone.utc).timestamp()*1000)
NAMES=("PENGUUSDT","BTCUSDT")
MAX_FILL_HOURS=24
FILES={}
def hasher(p):
 h=hashlib.sha256()
 with p.open("rb") as f:
  for part in iter(lambda:f.read(1<<19),b""):h.update(part)
 return h.hexdigest()
def load_market(sym,kind):
 if kind=="1h":
  paths=[*sorted((ROOT/"aster-public-v3-h1").glob(f"{sym}-1h-*.jsonl.gz")),
   FWD/f"{sym}-1h-20261001-20261118.jsonl.gz"]
 else:
  paths=[
   *sorted((ROOT/"aster-public-v3-5m-prefix").glob(f"{sym}-5m-*.jsonl.gz")),
   *sorted((ROOT/"aster-public-v3-5m-suffix").glob(f"{sym}-5m-*.jsonl.gz")),
   FWD/f"{sym}-5m-20261001-20261118.jsonl.gz"]
 if not paths:raise ValueError("NO_PRICE_FILES")
 m={}
 for file in paths:
  if not file.is_file():raise ValueError("MISSING_SOURCE:"+str(file))
  FILES[file.name]=hasher(file)
  with gzip.open(file,"rt",encoding="utf8") as f:
   for line in f:
    q=json.loads(line);ts=int(q[0])
    o,h,l,c,v=(float(q[i]) for i in (1,2,3,4,5))
    if not (0<l<=min(o,h,c) and h>=max(o,l,c) and v>=0):
     raise ValueError("BAD_OHLCV:"+sym+":"+str(ts))
    b=(o,h,l,c,v)
    if ts in m and m[ts]!=b:raise ValueError("CONFLICTING_PRICE_DUPLICATE")
    m[ts]=b
 return m

H1={s:load_market(s,"1h") for s in NAMES}
M5={s:load_market(s,"5m") for s in NAMES}
ACT={s:sorted(t for t,v in M5[s].items() if v[4]>0) for s in NAMES}
def relerr(a,b):return abs(a-b)/max(1e-12,abs(a))

coherence=[];stats={}
for sym in NAMES:
 misses=[];mismatch=[];hist=Counter();valid=0;zero=0;withzero=0
 for ts,h in sorted(H1[sym].items()):
  if ts<START or ts>=END:continue
  bars=[M5[sym].get(ts+j*M) for j in range(12)]
  if any(x is None for x in bars):
   misses.append(ts);continue
  valid+=1
  traded=[(j,b) for j,b in enumerate(bars) if b[4]>0]
  if not traded:
   zero+=1
   rebuilt=(bars[0][0],bars[0][1],bars[0][2],bars[0][3],sum(x[4] for x in bars))
   first_j=12
  else:
   first_j=traded[0][0]
   rebuilt=(traded[0][1][0],max(v[1] for _,v in traded),
     min(v[2] for _,v in traded),traded[-1][1][3],sum(v[4] for _,v in traded))
  if first_j>0:withzero+=1
  hist[first_j]+=1
  if any(relerr(x,y)>1e-10 for x,y in zip(h,rebuilt)):
   if len(mismatch)<10:mismatch.append({"ts":ts,"h1":h,"traded_m5_agg":rebuilt})
  coherence.append({"symbol":sym,"ts":ts,"period":"old" if ts<CUT else "new",
     "zero_volume_hour":first_j==12,"first_traded_5m_offset":first_j,
     "h1_completely_reconstructed":all(relerr(x,y)<1e-10 for x,y in zip(h,rebuilt))})
 if misses or mismatch:raise ValueError("H1_TO_TRADE_ONLY_M5_FAIL:"+sym+":"
   +str({"missing":len(misses),"mismatch":mismatch[:2]}))
 if valid!=9912:raise ValueError("UNEXPECTED_H1_FULL_COVERAGE:"+str(valid))
 stats[sym]={"checked":valid,"mismatches":0,"completely_no_trade_hours":zero,
  "first_M5_bar_zero_volume_hours":withzero,"time_to_first_trade_5m_bars":dict(sorted(hist.items()))}
 print("OHLCV_RECONCILIATION_PASS",sym,"hours",valid,"no-trade",zero,
 "first_m5_no_volume",withzero,flush=True)

OLD_SIGNAL=ROOT/"native-new-signal-20251001-20261001/native-PENGU-raw-intentions.jsonl"
OLD_EXIT=ROOT/"PENGU_NATIVE_LIFECYCLE_EXIT_20261109/pengu-native-lifecycle-modeled-exits.jsonl"
NEW_SIGNAL=OUT/"PENGU_PINNED_FORWARD_SIGNALS.json"
NEW_EXIT=OUT/"native_lifecycle_forward/pengu-native-lifecycle-modeled-exits.jsonl"
def jl(path):return [json.loads(line) for line in path.open(encoding="utf8") if line.strip()]
rawold=jl(OLD_SIGNAL);oldex=jl(OLD_EXIT)
newraw=json.loads(NEW_SIGNAL.read_text(encoding="utf8"))["signals"]
newex=jl(NEW_EXIT)
if len(rawold)!=116 or len(oldex)!=116 or len(newraw)!=11 or len(newex)!=11:
 raise ValueError("PINNED_CANDIDATE_COUNT_MISMATCH")
exits={}
for x in oldex+newex:
 key=(x["entryTs"],x["route"],x["side"])
 if key in exits:raise ValueError("DUPLICATE_EXIT")
 exits[key]=x

def active_after(ts,horizon=MAX_FILL_HOURS):
 v=ACT["PENGUUSDT"];j=bisect_left(v,ts)
 if j>=len(v) or v[j]>ts+horizon*H:return None
 return v[j]

def first_trade_in_hour(ts):
 found=active_after(ts,horizon=1)
 if found is None or found>=ts+H:return None
 return found

def resident_stop(decision_ref,exit_ts,stop,side):
 # Native stop is emitted after evaluating H1 [decision_ref,decision_ref+H).
 # Search only **actual traded** M5 highs/lows during this hour.
 if not(decision_ref+H==exit_ts):raise ValueError("DECISION_EXIT_TIME_MISMATCH")
 a=ACT["PENGUUSDT"];k=bisect_left(a,decision_ref)
 for i in range(k,len(a)):
  t=a[i]
  if t>=exit_ts:break
  b=M5["PENGUUSDT"][t]
  hit=(b[2]<=stop if side=="LONG" else b[1]>=stop)
  if hit:
   fill=min(stop,b[0]) if side=="LONG" else max(stop,b[0])
   return {"reference_price":stop,"traded_price_floor":fill,
       "event_trade_5m_ts":t,"slip_pct_of_entry":None,
       "gap_model_applied":abs(fill-stop)>1e-12,
       "fill_kind":"VOLUME_POSITIVE_M5_RESIDENT_TRIGGER"}
 return None

def market_exit(due):
 first=active_after(due)
 if first is None:return None
 return {"reference_price":None,"traded_price_floor":M5["PENGUUSDT"][first][0],
   "event_trade_5m_ts":first,"model_open_latency_minutes":(first-due)/60000,
   "fill_kind":"NEXT_TRADABLE_M5_OPEN_AFTER_NATIVE_DUE"}

old_by_date=[];new_by_date=[];unresolved=[];stop_sensitivity=Counter()
for cohort,signals in (("old",rawold),("new",newraw)):
 for source in signals:
  key=(source["entryTs"],source["route"],source["side"])
  x=exits.get(key)
  if x is None:raise ValueError("NATIVE_EXIT_MISSING:"+str(key))
  entryts=int(x["entryTs"])
  trade=first_trade_in_hour(entryts)
  record={"id":x["id"],"cohort":cohort,"route":x["route"],"side":x["side"],
   "entry_ts":entryts,"source_entry_price":x["entryPrice"],
   "source_exit_ts":x["exitTs"],"source_exit_price":x["exitPrice"],
   "source_exit_reason":x["exitReason"],"source_exit_price_kind":x["exitPriceKind"],
   "native_partial_events":len(x.get("partialEvents",[])),
   "first_entry_trade_ts":trade,"entry_trade_latency_minutes":
      (trade-entryts)/60000 if trade is not None else None}
  if trade is None:
   record["status"]="ENTRY_NO_TRADE_IN_SIGNAL_HOUR"
   unresolved.append(record)
   (old_by_date if cohort=="old" else new_by_date).append(record)
   continue
  entry=M5["PENGUUSDT"][trade][0]
  if abs(entry/x["entryPrice"]-1)>1e-9:raise ValueError("ENTRY_PRICE_DOES_NOT_MATCH_FIRST_TRADE")
  record["entry_traded_reference_price"]=entry
  d=1 if x["side"]=="LONG" else -1
  # Correctly weighted native reference gross, irrespective of market exit model.
  remain=1.0;native_gross=0.0;volume_gross=0.0;partial_models=[]
  for pe in x.get("partialEvents",[]):
   frac=remain*pe["closedQuantityFractionOfCurrent"]
   ref=pe["price"]
   found=resident_stop(pe["decisionReferenceTs"],pe["eventTs"],ref,x["side"])
   if found is None:
    record["status"]="PARTIAL_STOP_NOT_OBSERVED_ON_TRADED_M5"
    unresolved.append(record);break
   native_gross+=frac*d*(ref/entry-1)
   volume_gross+=frac*d*(found["traded_price_floor"]/entry-1)
   remain-=frac
   partial_models.append({"fraction_of_original":frac,"source_price":ref,
     "volume_aware_price":found["traded_price_floor"],
     "trade5m_ts":found["event_trade_5m_ts"],"gap_applied":found["gap_model_applied"]})
  if record.get("status"):
   (old_by_date if cohort=="old" else new_by_date).append(record);continue
  if abs(remain-x["remainingQuantityFraction"])>1e-9:
   raise ValueError("PARTIAL_WEIGHTED_QUANTITY_DIVERGENCE")
  price_kind=x["exitPriceKind"]
  if price_kind=="RESIDENT_STOP_PRICE_MODEL":
   native_exit=x["exitPrice"]
   found=resident_stop(x["decisionReferenceTs"],x["exitTs"],native_exit,x["side"])
   if found is None:
    record["status"]="NATIVE_RESIDENT_STOP_NOT_OBSERVED_ON_TRADED_M5"
    unresolved.append(record)
    (old_by_date if cohort=="old" else new_by_date).append(record);continue
   if found["gap_model_applied"]:stop_sensitivity["stop_first_traded_gap"]+=1
  elif price_kind=="CAUSAL_NEXT_H1_OPEN":
   found=market_exit(x["exitTs"])
   if found is None:
    record["status"]="MARKET_EXIT_NO_TRADES_WITHIN_24H"
    unresolved.append(record)
    (old_by_date if cohort=="old" else new_by_date).append(record);continue
   if abs(found["traded_price_floor"]-x["exitPrice"])/x["exitPrice"]>.00001:
    stop_sensitivity["native_next_H1_open_price_deviates_from_earliest_trade"]+=1
  else:
   raise ValueError("UNKNOWN_SOURCE_EXIT_KIND:"+str(price_kind))
  native_gross+=remain*d*(x["exitPrice"]/entry-1)
  volume_gross+=remain*d*(found["traded_price_floor"]/entry-1)
  record.update({"status":"VOLUME_AWARE_PRICE_MODEL_EVALUATED",
    "volume_aware_exit_price":found["traded_price_floor"],
    "volume_aware_exit_5m_ts":found["event_trade_5m_ts"],
    "volume_aware_exit_delay_after_due_min":
         (found["event_trade_5m_ts"]-x["exitTs"])/60000 if found["fill_kind"].startswith("NEXT") else None,
    "volume_aware_exit_type":found["fill_kind"],
    "source_partial_model":partial_models,
    "source_native_gross_pct":round(100*native_gross,6),
    "volume_model_gross_pct":round(100*volume_gross,6),
    "volume_minus_native_gross_pct":round(100*(volume_gross-native_gross),6),
    "net_10bps_pct":round(100*(volume_gross-.001),6),
    "net_30bps_pct":round(100*(volume_gross-.003),6),
    "source_native_net_30bps_pct":round(100*(native_gross-.003),6),
    "native_net_30bps_winner":native_gross>.003,
    "volume_net_30bps_winner":volume_gross>.003,
    "stop_gap_applied":bool(found.get("gap_model_applied"))})
  (old_by_date if cohort=="old" else new_by_date).append(record)
 assert len(old_by_date if cohort=="old" else new_by_date)==(116 if cohort=="old" else 11)

def agg(group):
 allc=len(group)
 okay=[x for x in group if x.get("status")=="VOLUME_AWARE_PRICE_MODEL_EVALUATED"]
 n=len(okay)
 w10=sum(x["net_10bps_pct"]>0 for x in okay)
 w30=sum(x["net_30bps_pct"]>0 for x in okay)
 return {"total_signals":allc,"volume_price_scored":n,
   "unexecutable_or_unresolved":allc-n,
   "wins10":w10,"wins30":w30,
   "winnerate_10bps_pct":round(100*w10/n,2) if n else None,
   "winnerate_30bps_pct":round(100*w30/n,2) if n else None,
   "avg_net30_pct":round(statistics.mean(x["net_30bps_pct"] for x in okay),4) if n else None,
   "native_wins_30_for_scored":sum(x["native_net_30bps_winner"] for x in okay),
   "native_v30_to_volume_v30_label_flips":sum(x["native_net_30bps_winner"]!=x["volume_net_30bps_winner"] for x in okay),
   "entry_delay_over5min":sum(x["entry_trade_latency_minutes"]>=5 for x in group if x["entry_trade_latency_minutes"] is not None),
   "entry_delay_over15min":sum(x["entry_trade_latency_minutes"]>=15 for x in group if x["entry_trade_latency_minutes"] is not None)}
totals={}
for cohort,rows in (("old",old_by_date),("new",new_by_date)):
 for route in ("ALL","SHORT_V20","RECOVERY_V8","LONG_V64"):
  sub=[x for x in rows if route=="ALL" or x["route"]==route]
  if sub:totals[f"{cohort}_{route}"]=agg(sub)
for name,v in totals.items():print("VOLUME_EXEC",name,json.dumps(v),flush=True)

allrows=old_by_date+new_by_date
def save_csv(path,rows):
 keys=list(dict.fromkeys(k for row in rows for k in row))
 with path.open("w",encoding="utf-8-sig",newline="") as output:
  writer=csv.DictWriter(output,keys);writer.writeheader()
  for row in rows:
   writer.writerow({k:json.dumps(v,ensure_ascii=False) if isinstance(v,(list,dict)) else v for k,v in row.items()})
save_csv(OUT/"PRISM_VOLUME_AWARE_127_PINNED_EXECUTION_LEDGER.csv",allrows)

manifest={"schema":"disdex-prism-volume-aware-native-pengu-model/v1",
 "source_pin":"1657e173d250ad58f53e62f7bb0a3428fb405496",
 "periods":{"old":"2025-10-01/2026-10-01 UTC","new":"2026-10-01/2026-11-18 UTC"},
 "data_quality":stats,"outcomes":totals,"unresolved_reasons":dict(Counter(x["status"] for x in unresolved)),
 "source_files_sha256":FILES,
 "unresolved":unresolved,"stop_model_sensitivity":dict(stop_sensitivity),
 "limits":[
  "M5 zero-volume bars are previous-close carry-forward display bars; cannot count as executed trades",
  "An H1 'open' can occur 5-55 min after the hour starts; no synthetic order fill is allowed in no-volume hours",
  "H1/M5 volume-positive aggregation matches all five OHLCV fields exactly (all checked 9,912 hours each symbol)",
  "Resident stops are assumed resting and at first traded price if an adverse gap crosses the stop; exchange book/matching not validated",
  "If the native original source stop does not trigger inside its decision H1, cohort is labeled unresolved not falsely filled",
  "A no-trade entry H1 is unexecutable: entry is not automatically rolled into later hours",
  "Even this model is not an official filled position history; no Funding, shared Gross, slippage, partial fill probability, or portfolio-DD",
  "Only 2025-10 to 2026-11 public historical observations, already explored and not prospective untouched OOS",
  "Research only, no onchain/signed trading, no Production change"] }
(OUT/"PRISM_VOLUME_AWARE_127_PINNED_EXECUTION_SUMMARY.json").write_text(
 json.dumps(manifest,ensure_ascii=False,indent=2,sort_keys=True,allow_nan=False)+"\n",encoding="utf8")
print("PRISM_VOLUME_AWARE_EXECUTION_AUDIT_PASS",len(allrows),"scored",sum(x.get("status")=="VOLUME_AWARE_PRICE_MODEL_EVALUATED" for x in allrows),
 "unresolved",len(unresolved),flush=True)
