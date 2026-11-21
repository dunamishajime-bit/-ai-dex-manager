#!/usr/bin/env python3
"""PENGU S3 STRUCTURE V1: fully independent causal SHORT entry patterns.

P20 entry structure is NOT pinned native V20, nor a deployable trading signal.
Compare each candidate family and frozen native V20 natural intents with the
SAME reference M5 print + hard/trailing/72h stop price-proxy overlay.
No signed venue fills, funding, Gross or production modifications.
"""
from __future__ import annotations
import argparse
import csv
import datetime as dt
import gzip
import hashlib
import json
import math
from collections import Counter,defaultdict
from pathlib import Path

from prism7_native53_event_attribution_20261122 import load_m5

H=3600000
M5=300000
PIN="1657e173d250ad58f53e62f7bb0a3428fb405496"
ENGINE="PENGU_S3_STRUCTURE_V1"
SOURCE="SOURCE_V20_NATURAL53_REFERENCE_STOP72"
FEES=(10,30)
EXIT_SLIP_BPS=(0,10,25)
RET77_START=1754006400000  # 2025-08-01 UTC
DATA_END=1794960000000       # 2026-11-18 UTC
COHORTS=[
 ("PRE_2025_AUG_SEP",1754006400000,1759276800000),
 ("BASE_2025_2026",1759276800000,1790812800000),
 ("POST_2026_OCT_NOV",1790812800000,DATA_END),
]
ROUTES=("SELLER_PULLBACK_REJECTION","BREAKDOWN_RETEST_FAILURE",
        "RELATIVE_WEAKNESS_DOWNSHIFT")
def iso(ts):
 return dt.datetime.fromtimestamp(ts/1000,dt.timezone.utc).isoformat()
def cohort(ts):
 for name,left,right in COHORTS:
  if left<=ts<right:return name
 return "OUTSIDE_COHORT"
def h1_source(files,check_range_start=None):
 combined={}
 sha={}
 for file in files:
  file=Path(file)
  bs=file.read_bytes()
  sha[file.name]=hashlib.sha256(bs).hexdigest()
  with gzip.open(file,"rt",encoding="utf-8") as f:
   for line in f:
    if not line.strip():continue
    z=json.loads(line);ts=int(z[0])
    if ts<RET77_START or ts>=DATA_END:continue
    if ts in combined and z!=combined[ts]:
     raise ValueError("P20_SOURCE_H1_CONFLICT:"+str(ts))
    o,hi,lo,cl,v=map(float,(z[1],z[2],z[3],z[4],z[5]))
    if not (0<lo<=min(o,cl)<=max(o,cl)<=hi and v>=0):
     raise ValueError("P20_INVALID_SOURCE_H1:"+str(ts))
    combined[ts]=z
 ts=sorted(combined)
 if not ts or ts[0]!=RET77_START or ts[-1]+H!=DATA_END:
  raise ValueError("P20_SOURCE_H1_CALENDAR_INCOMPLETE")
 if any(ts[i]-ts[i-1]!=H for i in range(1,len(ts))):
  raise ValueError("P20_SOURCE_H1_GAP")
 return [{"time":t,"open":float(combined[t][1]),"high":float(combined[t][2]),
          "low":float(combined[t][3]),"close":float(combined[t][4]),
          "volume":float(combined[t][5])} for t in ts],sha

def moving_ema(candles,span):
 # causal EMA, initialized with first fully observed close; discard first 168 H1 as warmup
 alpha=2/(span+1)
 output=[]
 value=None
 for b in candles:
  value=b["close"] if value is None else alpha*b["close"]+(1-alpha)*value
  output.append(value)
 return output

def causal_patterns(i,p,btc,e24,e72,be72):
 current=p[i];previous=p[i-1]
 if not (current["volume"]>0 and previous["volume"]>0
         and btc[i]["volume"]>0):
  return [],{}
 if i<168:return [],{}
 price=current["close"];ret24=price/p[i-24]["close"]-1
 btc24=btc[i]["close"]/btc[i-24]["close"]-1
 btc6=btc[i]["close"]/btc[i-6]["close"]-1
 pengu6=price/p[i-6]["close"]-1
 range_=current["high"]-current["low"]
 upper=current["high"]-max(current["open"],current["close"])
 wick_share=upper/range_ if range_>0 else 0
 support=min(z["low"] for z in p[i-25:i-1])
 prior_24_volume=sum(z["volume"] for z in p[i-26:i-2])
 current_3_volume=sum(z["volume"] for z in p[i-2:i+1])
 ratio=current_3_volume/(prior_24_volume/8) if prior_24_volume>0 else None
 a=(ret24<=-.05 and e24[i]<e72[i] and
    btc[i]["close"]<be72[i] and btc24<=-.015 and
    previous["close"]>previous["open"] and
    price<current["open"] and price<previous["close"] and
    wick_share>=.25)
 b=(p[i-2]["close"]>=support and previous["close"]<support and
    current["high"]>=support*(1-.005) and
    price<support and price<current["open"] and btc6<=-.01)
 c=(pengu6<=-.04 and btc6>=-.005 and
    pengu6-btc6<=-.03 and price<e24[i]<e72[i] and
    price<previous["close"]<p[i-2]["close"] and
    ratio is not None and ratio>=1.2)
 routes=[name for name,on in zip(ROUTES,(a,b,c)) if on]
 return routes,{
   "PENGUret24":ret24,"PENGUret6":pengu6,"BTCret24":btc24,
   "BTCret6":btc6,"PENGUminusBTC6":pengu6-btc6,
   "EMA24":e24[i],"EMA72":e72[i],"BTCEMA72":be72[i],
   "wickShare":wick_share,"priorSupport24":support,
   "volume3hVsPrior24hMean3h":ratio,
 }

def execution_proxy(m5,entry_intent):
 first=None
 for k in range(12):
  t=entry_intent+k*M5
  bar=m5.get(t)
  if bar is None:raise ValueError("P20_M5_ENTRY_HOUR_MISSING:"+str(t))
  if float(bar[5])>0:
   first=(t,float(bar[1]),k*5)
   break
 return first

def stop72(m5,first_trade_ts,entry_price,max_observation_end=DATA_END):
 # Prior completed H1 low watermark only, no pre-entry M5 watermark.
 if first_trade_ts is None or not entry_price>0:
  raise ValueError("P20_INVALID_TRADE_ENTRY")
 hard=entry_price*1.08
 last_hour=None
 hour_low=None
 previous_best=entry_price
 max_hour_updated=0
 stop_touch_same_entry_bar=False
 simultaneous_native_stop=False
 deadline=first_trade_ts+72*H
 # allow max 72h+6h first print for time exit, but never beyond archived M5
 for k in range(78*12+1):
  t=first_trade_ts+k*M5
  if t>=max_observation_end:
   return {"status":"RIGHT_CENSORED_DATA_END","entryTs":first_trade_ts,
           "exitTs":None,"exitPrice":None,"exitReason":None,
           "prevBest":previous_best}
  row=m5.get(t)
  if row is None:
   raise ValueError("P20_M5_PRICE_SOURCE_GAP:"+str(t))
  hour=(t//H)*H
  if last_hour is not None and hour>last_hour:
   if hour_low is not None:
    previous_best=min(previous_best,hour_low)
    max_hour_updated+=1
   hour_low=None
  last_hour=hour
  if float(row[5])<=0:continue
  o,hi,lo=map(float,(row[1],row[2],row[3]))
  if t>=deadline:
   return {
    "status":"PRICE_PROXY_CLOSED","entryTs":first_trade_ts,"exitTs":t,
    "exitPrice":o,"exitReason":"REFERENCE_MAX_HOLD_72H",
    "exitKind":"FIRST_PRINT_AFTER_72H","stopLevel":None,
    "hourlyLowWatermarkUpdates":max_hour_updated,
    "sameEntryM5StopTouchAmbiguous":False,
    "highLowWithinM5IntrabarOrderUnknown":True,
    "nativeSourceEconomicStopLogicReplayed":False,
   }
  trail_on=(entry_price/previous_best-1)>=.15
  trail=previous_best*1.04
  hard_touched=hi+1e-12>=hard
  trailing_touched=trail_on and hi+1e-12>=trail
  if hard_touched or trailing_touched:
   stop_touch_same_entry_bar=t==first_trade_ts
   simultaneous_native_stop=hard_touched and trailing_touched
   reason="REFERENCE_HARD_STOP" if hard_touched else "REFERENCE_TRAILING_STOP"
   level=hard if hard_touched else trail
   return {
    "status":"PRICE_PROXY_CLOSED","entryTs":first_trade_ts,"exitTs":t,
    "exitPrice":max(level,o),"exitReason":reason,
    "exitKind":"M5_POSITIVE_HIGH_TOUCH_BUY_STOP_PROXY",
    "stopLevel":level,"hourlyLowWatermarkUpdates":max_hour_updated,
    "sameEntryM5StopTouchAmbiguous":stop_touch_same_entry_bar,
    "simultaneousStopAmbiguous":simultaneous_native_stop,
    "highLowWithinM5IntrabarOrderUnknown":True,
    "nativeSourceEconomicStopLogicReplayed":False,
   }
  hour_low=lo if hour_low is None else min(hour_low,lo)
 return {"status":"RIGHT_CENSORED_NO_PRINT_BY_78H","entryTs":first_trade_ts,
    "exitTs":None,"exitPrice":None,"exitReason":None}

def simulate_strategy(raw,m5,strategy,allow_slot=True):
 # every source or new opportunity registered; 1 slot to prevent overlapping notional exposure
 records=[]
 busy_until=-1
 for candidate in sorted(raw,key=lambda x:x["intentTs"]):
  if candidate["intentTs"]>=DATA_END:continue
  row={**candidate,"strategy":strategy,"researchEntryIntentPreserved":True,
       "sourceVenueSignedFillProven":False,"sourceEconomicStop72ReferenceOnly":True}
  if allow_slot and candidate["intentTs"]<busy_until:
   row.update(status="OCCUPIED_SLOT",entryProxyTs=None,entryProxyPrice=None,
              exitProxyTs=None,exitProxyPrice=None,exitReason=None)
   records.append(row);continue
  entry=execution_proxy(m5,candidate["intentTs"])
  if entry is None:
   row.update(status="ENTRY_PRINT_MISSING",entryProxyTs=None,entryProxyPrice=None,
              exitProxyTs=None,exitProxyPrice=None,exitReason=None)
   records.append(row);continue
  t,price,delay=entry
  result=stop72(m5,t,price)
  row.update(status=result["status"],entryProxyTs=t,entryProxyPrice=price,
             entryDelayMinutes=delay,exitProxyTs=result.get("exitTs"),
             exitProxyPrice=result.get("exitPrice"),
             exitReason=result.get("exitReason"),
             exitKind=result.get("exitKind"),
             stopLevel=result.get("stopLevel"),
             sameEntryM5StopTouchAmbiguous=result.get("sameEntryM5StopTouchAmbiguous",False),
             simultaneousStopAmbiguous=result.get("simultaneousStopAmbiguous",False))
  if result["status"]=="PRICE_PROXY_CLOSED":busy_until=result["exitTs"]+M5
  else:busy_until=DATA_END # unknown whether exit occurred; block subsequent signals
  records.append(row)
 return records

def aggregate(records,fee,slip,subset=None):
 if subset:records=[r for r in records if subset(r)]
 closed=[r for r in records if r["status"]=="PRICE_PROXY_CLOSED"]
 vals=[100*(1-r["exitProxyPrice"]/r["entryProxyPrice"])-(fee+slip)/100 for r in closed]
 winners=[x for x in vals if x>0]
 losses=-sum(x for x in vals if x<0)
 profitable=sum(winners)
 nav=10000.0
 high=nav
 maxdd=0.0
 for _,z in sorted(zip([x["exitProxyTs"] for x in closed],vals)):
  nav*=max(0,1+z/100)
  high=max(high,nav)
  maxdd=max(maxdd,100*(1-nav/high))
 return {
    "candidateIntents":len(records),
    "occupiedSlot":sum(x["status"]=="OCCUPIED_SLOT" for x in records),
    "entryPriceNoPrint":sum(x["status"]=="ENTRY_PRINT_MISSING" for x in records),
    "rightCensored":sum(x["status"].startswith("RIGHT_CENSORED") for x in records),
    "priceProxyClosed":len(closed),
    "wins":len(winners),
    "winratePctConditional":round(100*len(winners)/len(closed),6) if closed else None,
    "meanNetPctConditional":round(sum(vals)/len(vals),8) if vals else None,
    "netProfitPctPoints":round(sum(vals),8),
    "profitFactorConditional":round(profitable/losses,6) if losses>0 else None,
    "referenceSequentialEquityStartYen":10000,
    "referenceSequentialEquityEndYen":round(nav,3),
    "referenceSequentialRealizedDDPct":round(maxdd,6),
    "exitReasons":dict(Counter(r["exitReason"] for r in closed)),
    "ambiguousSameEntryM5Stop":sum(r["sameEntryM5StopTouchAmbiguous"] for r in closed),
    "notProductionAccountDD":True,
 }

def main():
 ap=argparse.ArgumentParser()
 ap.add_argument("--pengu-h1",nargs="+",type=Path,required=True)
 ap.add_argument("--btc-h1",nargs="+",type=Path,required=True)
 ap.add_argument("--pengu-m5",nargs="+",type=Path,required=True)
 ap.add_argument("--source-native53",type=Path,required=True)
 ap.add_argument("--out-summary",type=Path,required=True)
 ap.add_argument("--out-candidates",type=Path,required=True)
 ap.add_argument("--out-trades",type=Path,required=True)
 args=ap.parse_args()
 p,pH=h1_source(args.pengu_h1)
 btc,bH=h1_source(args.btc_h1)
 if len(p)!=len(btc) or any(p[i]["time"]!=btc[i]["time"] for i in range(len(p))):
  raise ValueError("P20_PENGU_BTC_SOURCE_H1_NOT_ALIGNED")
 m5,m5h=load_m5(args.pengu_m5)
 e24=moving_ema(p,24);e72=moving_ema(p,72);be72=moving_ema(btc,72)
 new=[]
 route_counts=Counter()
 for i in range(168,len(p)-1):
  names,feature=causal_patterns(i,p,btc,e24,e72,be72)
  if not names:continue
  ts=p[i]["time"]+H
  if cohort(ts)=="OUTSIDE_COHORT":continue
  for route in names:route_counts[route]+=1
  new.append({
   "id":f"S3_{i:05d}","signalReferenceTs":p[i]["time"],
   "intentTs":ts,"route":names[0],"allMatchedRoutes":names,
   "cohort":cohort(ts),"asofFeatures":feature,
   "signalDecisionTimeTs":ts,"futurePricesUsedToFormSignal":False,
  })
 source=json.loads(args.source_native53.read_text(encoding="utf-8"))
 if len(source)!=53 or sum(x["net30pct"]>0 for x in source)!=29:
  raise ValueError("P20_ORIGINAL_V20_FIXED_53_SOURCE_PARITY_LOST")
 original=[]
 for x in source:
  if x["parity"]!="EXACT":raise ValueError("P20_SOURCE_NOT_PARITY")
  ts=int(x["entryTs"])
  if cohort(ts)=="OUTSIDE_COHORT":raise ValueError("P20_SOURCE_NATIVE_WINDOW_INCONSISTENT")
  original.append({
   "id":x["id"],"intentTs":ts,"signalReferenceTs":ts-H,
   "cohort":cohort(ts),"route":"ORIGINAL_SOURCE_V20",
   "sourceNativePnL30Pct":x["net30pct"],
   "sourceNativeWin30":x["net30pct"]>0,
   "sourceNativeExitReason":x["exitReason"],
   "sourceNativeExitPrice":x["exitPrice"],
   "sourceNativeExitTs":x["exitTs"],
   "futurePricesUsedToFormSignal":False,
  })
 # Also independent event-test each candidate with no slot to separate structural alpha
 s3_slot=simulate_strategy(new,m5,ENGINE,allow_slot=True)
 s3_ind=simulate_strategy(new,m5,ENGINE+"_PER_CANDIDATE",allow_slot=False)
 src_slot=simulate_strategy(original,m5,SOURCE,allow_slot=True)
 src_ind=simulate_strategy(original,m5,SOURCE+"_PER_CANDIDATE",allow_slot=False)
 checks=[]
 for name,rows in [("S3_SINGLE_SLOT",s3_slot),("S3_ALL_CANDIDATES",s3_ind),
                   ("SOURCE53_SINGLE_SLOT",src_slot),("SOURCE53_ALL_CANDIDATES",src_ind)]:
  for fee in FEES:
   for slip in EXIT_SLIP_BPS:
    checks.append({"strategyGroup":name,"feeBps":fee,
                   "additionalExitSlippageBps":slip,**aggregate(rows,fee,slip)})
  for c in COHORTS:
   checks.append({"strategyGroup":name,"feeBps":30,
                  "additionalExitSlippageBps":0,"cohort":c[0],
                  **aggregate(rows,30,0,subset=lambda x:x["cohort"]==c[0])})
 if len(src_ind)!=53 or any(x["intentTs"] not in {a["entryTs"] for a in source} for x in src_ind):
  raise ValueError("P20_SOURCE53_ENTRY_INTENTS_DROPPED")
 if any(x.get("futurePricesUsedToFormSignal") for x in new):
  raise ValueError("P20_FUTURE_SOURCE_USED_FOR_ENTRY")
 summary={
  "schema":"prism7-p20-pengu-s3-causal-market-structure-standalone-shorts-reference-stop72/v1",
  "researchEngineName":ENGINE,
  "pinnedComparisonV20RuntimeSHA":PIN,
  "originalSourceNaturalIntents":53,
  "originalSourceNativeWins":29,
  "originalSourceNativeMeanNet30Pct":sum(x["net30pct"] for x in source)/53,
  "newCandidateIntentsBeforeSingleSlot":len(new),
  "newRouteMatchCountsMayOverlap":dict(route_counts),
  "newPrimaryRouteCounts":dict(Counter(x["route"] for x in new)),
  "sourceH1Rows":len(p),"sourceM5Rows":len(m5),
  "sourceSHA256":{"penguH1":pH,"btcH1":bH,"penguM5":m5h,
                   "originalNative53":hashlib.sha256(args.source_native53.read_bytes()).hexdigest()},
  "economic":checks,
  "limitations":[
    "S3 structural signal is new research implementation, not pinned original SHORT V20.",
    "SOURCE53 and S3 reference overlay hard8% trail activate15% retrace4% max72h is intentionally common but differs from full native V20 phase-specific exits.",
    "S3 and SOURCE single slot evaluation marks occupied opportunities explicitly; candidate count separate from executed entries.",
    "No first M5 bar intrabar high/low order, ASK, queue, market impact, signed fill or funding.",
    "Sequential realized equity DD in this script is NOT intratrade DD or account total DD; it omits other assets and runners.",
    "Historical Aug2025-Nov2026 studied elsewhere, not blind OOS. No economic route accepted for LIVE.",
  ],
 }
 args.out_summary.parent.mkdir(parents=True,exist_ok=True)
 args.out_summary.write_text(json.dumps(summary,ensure_ascii=False,indent=2,sort_keys=True)+"\n",encoding="utf-8")
 with args.out_candidates.open("w",encoding="utf-8",newline="") as f:
  cols=["id","signalReferenceTs","intentTs","route","allMatchedRoutes","cohort","asofFeatures","signalDecisionTimeTs","futurePricesUsedToFormSignal"]
  w=csv.DictWriter(f,fieldnames=cols);w.writeheader()
  for a in new:
   w.writerow({k:json.dumps(a[k],ensure_ascii=False,sort_keys=True) if isinstance(a[k],(dict,list)) else a[k] for k in cols})
 # Full individual ledger for all four independent+slot variants; row data complete, JSONL
 with args.out_trades.open("w",encoding="utf-8",newline="") as f:
  for name,records in [("S3_SINGLE_SLOT",s3_slot),("S3_ALL_CANDIDATES",s3_ind),
                       ("SOURCE53_SINGLE_SLOT",src_slot),("SOURCE53_ALL_CANDIDATES",src_ind)]:
   for z in records:f.write(json.dumps({"group":name,**z},ensure_ascii=False,sort_keys=True)+"\n")
 print("PRISM7_P20_PENGU_S3_STRUCTURE_SOURCE_COMPARISON_COMPLETE",json.dumps({
   "candidateCount":len(new),"primaryRoutes":summary["newPrimaryRouteCounts"],
   "gross":{x["strategyGroup"]:x for x in checks if "cohort" not in x and
     x["feeBps"]==30 and x["additionalExitSlippageBps"]==0}},ensure_ascii=False))
 print("OUT",args.out_summary,args.out_candidates,args.out_trades)
if __name__=="__main__":main()
