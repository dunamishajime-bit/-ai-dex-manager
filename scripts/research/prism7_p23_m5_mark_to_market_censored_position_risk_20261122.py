#!/usr/bin/env python3
"""P23: single-slot 5m quote-free mark-to-market risk envelope incl. censored position.

Reference equity only, not actual venue signed fills/positions/gross/funding.
No SOURCE economic/entry/STOP changes; independently read P20/P21/P22 records.
"""
from __future__ import annotations
import argparse,json,hashlib
from pathlib import Path
from collections import Counter
from prism7_native53_event_attribution_20261122 import load_m5

START_NAV=10000.0
M5=300000
DATA_END=1794960000000
GROUPS=(
  ("SOURCE53_SINGLE_SLOT","p20"),
  ("S3_SINGLE_SLOT","p20"),
  ("S3_CONFIRM_SINGLE_SLOT","p21"),
  ("S4_SINGLE_SLOT","p22"),
)
FEES=(10,30)
SLIPS=(0,10,25)

def events(path):
 return [json.loads(x) for x in path.read_text(encoding="utf-8").splitlines() if x.strip()]

def group_rows(p20,p21,p22):
 by_input={"p20":p20,"p21":p21,"p22":p22}
 result={}
 for group,book in GROUPS:
  rows=[x for x in by_input[book] if x["group"]==group]
  if len(rows)!=(53 if group=="SOURCE53_SINGLE_SLOT" else 120):
   raise ValueError("P23_SOURCE_GROUP_CANDIDATE_TOTAL_MISMATCH:"+group+":"+str(len(rows)))
  result[group]=rows
 return result

def stream_group(rows,market,fee,slip):
 closed=sorted([x for x in rows if x["status"]=="PRICE_PROXY_CLOSED"],key=lambda x:x["entryProxyTs"])
 censored=sorted([x for x in rows if x["status"].startswith("RIGHT_CENSORED")
                  and x.get("entryProxyTs") is not None],
                key=lambda x:x["entryProxyTs"])
 positions=sorted(closed+censored,key=lambda x:x["entryProxyTs"])
 cash=START_NAV
 peak_close=START_NAV
 max_mark_dd=0.0
 max_high_dd=0.0
 first_mark_before_open=None
 mark_dd_worst=None
 high_dd_worst=None
 last_trade_end=-1
 trade_risk=[]
 max_stale_all=0
 for trade in positions:
  entry=int(trade["entryProxyTs"])
  entryprice=float(trade["entryProxyPrice"])
  if entry<last_trade_end+M5:
   raise ValueError("P23_SINGLE_SLOT_POSITIONS_OVERLAP:"+trade["id"])
  if entryprice<=0 or entry>=DATA_END:
   raise ValueError("P23_ENTRY_PRICE_BAD")
  is_closed=trade["status"]=="PRICE_PROXY_CLOSED"
  exitts=int(trade["exitProxyTs"]) if is_closed else None
  end=exitts if is_closed else DATA_END-M5
  if end<entry:raise ValueError("P23_EXIT_BEFORE_ENTRY")
  last_trade_end=end
  begin_cash=cash
  seen_positive=0
  print_stale=0
  longest_stale=0
  last_price=None
  max_m5_high=entryprice
  high_peak_ts=None
  m5_mark_worst=None
  m5_high_worst=None
  local_worst_price_pct=0
  series_count=0
  for t in range(entry,end+1,M5):
   bar=market.get(t)
   if bar is None:raise ValueError("P23_SOURCE_M5_NOT_CONTIGUOUS:"+str(t))
   vol=float(bar[5])
   if vol>0:
    print_stale=0
    seen_positive+=1
    if not(float(bar[1])>0 and float(bar[2])>=float(bar[1])):
     raise ValueError("P23_INVALID_POSITIVE_PRINT_BAR")
    last_price=float(bar[4])
    high=float(bar[2])
    if high>max_m5_high:
      max_m5_high=high;high_peak_ts=t
    local_worst_price_pct=max(local_worst_price_pct,100*(high-entryprice)/entryprice)
   else:
    print_stale+=1
    longest_stale=max(longest_stale,print_stale)
    high=None
   if last_price is None:
    last_price=entryprice
   # One-unit notional per equity; reserve total roundtrip fee on unrealized mark
   unrealized_nav=begin_cash*(1+(entryprice-last_price)/entryprice-(fee+slip)/10000)
   if t!=exitts:
    peak_close=max(peak_close,unrealized_nav)
    dclose=100*(1-unrealized_nav/peak_close)
    if dclose>max_mark_dd:
      max_mark_dd=dclose;mark_dd_worst={"id":trade["id"],"time":t,"priceMark":last_price,"equity":unrealized_nav}
    m5_mark_worst=max(m5_mark_worst or 0,dclose)
   if high is not None:
    worst_high_nav=begin_cash*(1+(entryprice-high)/entryprice-(fee+slip)/10000)
    dhigh=100*(1-worst_high_nav/peak_close)
    if dhigh>max_high_dd:
      max_high_dd=dhigh;high_dd_worst={"id":trade["id"],"time":t,"stressHigh":high,"equity":worst_high_nav}
    m5_high_worst=max(m5_high_worst or 0,dhigh)
   if t==exitts:
    # Source synthetic EXIT executes at source M5 open/STOP level, before a new
    # post-exit candle CLOSE could be used for owner mark. High is separate stress.
    if vol<=0:raise ValueError("P23_SOURCE_EXIT_WITHOUT_POSITIVE_PRICE_PRINT")
    exit_price=float(trade["exitProxyPrice"])
    cash=begin_cash*(1+(entryprice-exit_price)/entryprice-(fee+slip)/10000)
    peak_close=max(peak_close,cash)
    dclose=100*(1-cash/peak_close)
    if dclose>max_mark_dd:
      max_mark_dd=dclose;mark_dd_worst={"id":trade["id"],"time":t,"priceMark":exit_price,"equity":cash}
    m5_mark_worst=max(m5_mark_worst or 0,dclose)
   series_count+=1
  max_stale_all=max(max_stale_all,longest_stale)
  if not is_closed:
   # open until source data end; mark to last printed close; do not synthesize exit
   cash=begin_cash*(1+(entryprice-last_price)/entryprice-(fee+slip)/10000)
   peak_close=max(peak_close,cash)
  trade_risk.append({
     "id":trade["id"],"route":trade["route"],"cohort":trade["cohort"],
     "entryTs":entry,"sourceStatus":trade["status"],
     "exitTs":exitts,
     "entrySourceOpen":entryprice,
     "exitSourcePriceIfClosed":trade["exitProxyPrice"] if is_closed else None,
     "maxPositiveM5HighDuringHolding":max_m5_high,
     "maxAdverseHighPctAboveEntryPrice":local_worst_price_pct,
     "worstHighTs":high_peak_ts,
     "mostAdversePortfolioM5CloseDDPctDuringHolding":m5_mark_worst,
     "mostAdversePortfolioHighStressDDPctDuringHolding":m5_high_worst,
     "positiveM5PrintsObserved":seen_positive,
     "maximumConsecutiveM5WithoutPrint":longest_stale,
     "totalM5BarsInspected":series_count,
     "initialEquityBeforeEntry":begin_cash,
     "finalEquityIfClosedOrLastObservedMark":cash,
     "openUncensoredVenueFillProven":False,
  })
 return {
  "initialCapitalYen":START_NAV,
  "sourceIntents":len(rows),
  "priceProxyClosed":len(closed),
  "rightCensoredOpenPositions":len(censored),
  "referenceFinalEquityIncludingUnrealizedYen":round(cash,5),
  "maximumM5CloseMarkToMarketDDPct":round(max_mark_dd,8),
  "maximumM5HighAdverseEnvelopeDDPct":round(max_high_dd,8),
  "worstM5CloseDDRecord":mark_dd_worst,
  "worstM5HighEnvelopeDDRecord":high_dd_worst,
  "longestStaleNoPositivePrintBarsWhilePositionOpen":max_stale_all,
  "totalPositivePrintBarsDuringHold":sum(x["positiveM5PrintsObserved"] for x in trade_risk),
  "totalHoldingBarsChecked":sum(x["totalM5BarsInspected"] for x in trade_risk),
 },trade_risk

def main():
 ap=argparse.ArgumentParser()
 ap.add_argument("--p20-events",type=Path,required=True)
 ap.add_argument("--p21-events",type=Path,required=True)
 ap.add_argument("--p22-events",type=Path,required=True)
 ap.add_argument("--pengu-m5",type=Path,nargs="+",required=True)
 ap.add_argument("--out-summary",type=Path,required=True)
 ap.add_argument("--out-trade-risk",type=Path,required=True)
 args=ap.parse_args()
 p20,p21,p22=(events(f) for f in (args.p20_events,args.p21_events,args.p22_events))
 groups=group_rows(p20,p21,p22)
 m5,m5hash=load_m5(args.pengu_m5)
 results=[]
 riskledger=[]
 for group,allrows in groups.items():
  for fee in FEES:
   for slip in SLIPS:
    aggregate,risk=stream_group(allrows,m5,fee,slip)
    results.append({"group":group,"feeBps":fee,"exitSlippageBps":slip,**aggregate})
    if fee==30 and slip==0:
     for z in risk:riskledger.append({"group":group,**z})
 if any(x["maximumM5HighAdverseEnvelopeDDPct"]<x["maximumM5CloseMarkToMarketDDPct"]-1e-6
        for x in results):
  raise ValueError("P23_WORST_HIGH_DD_LESS_THAN_CLOSE_DD")
 record={
   "schema":"prism7-p23-native-source-v20-s3-s4-5m-mark-to-market-including-open-right-censored/v1",
   "inputSha256":{
    "p20_events":hashlib.sha256(args.p20_events.read_bytes()).hexdigest(),
    "p21_events":hashlib.sha256(args.p21_events.read_bytes()).hexdigest(),
    "p22_events":hashlib.sha256(args.p22_events.read_bytes()).hexdigest(),
    "penguM5":m5hash,
   },
   "feesBps":list(FEES),"additionalExitSlippageBps":list(SLIPS),
   "sourceInitialCapitalYen":START_NAV,
   "groups":results,
   "limitations":[
    "All market M5 are historical public OHLCV; no live position/funding/gross/other Runner/cross margin.",
    "M5 close mark DD includes open source-censored positions and waits for actual positive prints.",
    "High-based adverse DD is an intentionally conservative OHLC intrabar timing envelope; highs could have occurred after model STOP.",
    "Close marks during zero-positive-volume gaps carry last printed price, NOT executable bid/ask.",
    "All 1x positions are non-overlapping under the one-slot SOURCE reference model, not actual trading account.",
    "Exit commissions reserved on unrealized equity; source stop intrabar exact touch/order response unknown.",
    "Account daily loss7.5% and true portfolio mark DD21% cutoff cannot be certified from this research study.",
   ],
 }
 args.out_summary.parent.mkdir(parents=True,exist_ok=True)
 args.out_summary.write_text(json.dumps(record,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf-8")
 args.out_trade_risk.write_text(json.dumps(riskledger,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf-8")
 print("PRISM7_P23_SOURCE_4_STRATEGY_M5_OPEN_MARK_DD_AUDIT_PASS")
 for z in results:
  if z["feeBps"]==30 and z["exitSlippageBps"]==0:
   print("GROUP",z["group"],"CLOSED",z["priceProxyClosed"],
     "UNCLOSED",z["rightCensoredOpenPositions"],
     "M5_CLOSE_DD",z["maximumM5CloseMarkToMarketDDPct"],
     "M5_HIGH_STRESS_DD",z["maximumM5HighAdverseEnvelopeDDPct"],
     "FINAL_EQUITY_UNREALIZED",z["referenceFinalEquityIncludingUnrealizedYen"])
 print("OUT",args.out_summary,args.out_trade_risk)
if __name__=="__main__":main()
