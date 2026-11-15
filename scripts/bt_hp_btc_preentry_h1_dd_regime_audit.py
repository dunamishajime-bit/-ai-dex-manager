#!/usr/bin/env python3
"""Source-pinned BTC as-of H1 regime vs modeled trade direction/5m DD.

Descriptive postmortem only: threshold labels never alter ENTRY / STOP / risk.
Model fills are not signed exchange fills or live pinned economic parity.
"""
from __future__ import annotations
import argparse,bisect,csv,gzip,hashlib,json,math,collections
from datetime import datetime,timezone
from pathlib import Path

HOUR_MS=3600000
START="2025-10-01T00:00:00Z"
END="2026-10-01T00:00:00Z"
EXPECTED_BTC_H1=8928
EXPECTED_MODEL_FILLS={10:1024,30:1025}
PEAK_UTC="2026-08-05T07:00:00Z"
TROUGH_UTC="2026-09-22T11:00:00Z"

def sha(p:Path):return hashlib.sha256(p.read_bytes()).hexdigest()
def ms(iso:str):
 dt=datetime.fromisoformat(iso.replace("Z","+00:00"))
 if dt.tzinfo is None or dt.utcoffset().total_seconds()!=0:
  raise ValueError("UTC_REQUIRED")
 return int(dt.timestamp()*1000)
def fnum(raw:str):
 n=float(raw)
 if not math.isfinite(n):raise ValueError("NONFINITE_MODEL_SOURCE")
 return n
def entries(path:Path):
 with path.open(encoding="utf-8-sig",newline="") as r:
  yield from csv.DictReader(r)
def load_btc(path:Path):
 rows=[]
 with gzip.open(path,"rt",encoding="utf8") as fd:
  for line in fd:
   raw=json.loads(line)
   if not isinstance(raw,list) or len(raw)!=12:
    raise ValueError("ASTER_H1_NOT_BINANCE_KLINE")
   t=int(raw[0]);close_ms=int(raw[6]);o,h,l,c=map(fnum,raw[1:5])
   if not(t+HOUR_MS-1==close_ms and l<=min(o,c)<=max(o,c)<=h and 0<l):
    raise ValueError("BTC_H1_OHLC_OR_TIME_BAD")
   if rows and t!=rows[-1][0]+HOUR_MS:
    raise ValueError("BTC_H1_GRID_MISSING_OR_DUPLICATED")
   rows.append((t,close_ms,c))
 if len(rows)!=EXPECTED_BTC_H1:raise ValueError("BTC_H1_SOURCE_BARS_INCOMPLETE")
 return rows
def classify(ret24,ret72,vol24):
 if ret24>=.02 and ret72>=.03:regime="BTC_RISING_CONFIRMED"
 elif ret24<=-.02 and ret72<=-.03:regime="BTC_FALLING_CONFIRMED"
 elif ret24>=.02 and ret72<0:regime="BTC_REBOUND_72H_NEGATIVE"
 elif ret24<=-.02 and ret72>0:regime="BTC_PULLBACK_72H_POSITIVE"
 else:regime="BTC_MIXED_OR_RANGE"
 return regime,("HIGH_VOL" if vol24>=.03 else "LOW_VOL")
def btc_features(bars,entry_time):
 close_times=[b[1] for b in bars]
 # latest H1 bar that is fully closed before the signal timestamp.
 i=bisect.bisect_left(close_times,entry_time)-1
 # Exchange candle closeTs is open+1h-1ms. The strict inequality
 # prevents using an H1 candle closing at the same millisecond.
 if i<73:raise ValueError("BTC_PREENTRY_72H_HISTORY_MISSING")
 prices=[x[2] for x in bars]
 ret24=prices[i]/prices[i-24]-1
 ret72=prices[i]/prices[i-72]-1
 logreturns=(math.log(prices[j]/prices[j-1]) for j in range(i-23,i+1))
 vol24=math.sqrt(sum(q*q for q in logreturns))
 r,v=classify(ret24,ret72,vol24)
 if bars[i][1]>=entry_time:
  raise ValueError("BTC_H1_FUTURE_CANDLE_LEAK")
 return {"lastClosedBtcH1":bars[i][1],"btcReturn24h":ret24,
   "btcReturn72h":ret72,"btcRealizedVol24h":vol24,
   "btcRegime":r,"btcVolRegime":v}
def aggregate(trades:list[dict]):
 n=len(trades)
 if not n:return {"n":0,"wins":0,"losses":0,"adversePriceDirection":0,
                   "netModelJpy":0,"grossModelJpy":0,"winRatePct":None}
 net=sum(x["netModelJpy"] for x in trades)
 return {"n":n,"wins":sum(x["netModelJpy"]>0 for x in trades),
   "losses":sum(x["netModelJpy"]<0 for x in trades),
   "adversePriceDirection":sum(x["adversePriceDirection"] for x in trades),
   "netModelJpy":net,
   "grossModelJpy":sum(x["grossModelJpy"] for x in trades),
   "winRatePct":100*sum(x["netModelJpy"]>0 for x in trades)/n}
def group(trades,key):
 d=collections.defaultdict(list)
 for t in trades:d[t[key]].append(t)
 return {k:aggregate(v) for k,v in sorted(d.items())}
def count_episodes(rows):
 buckets=collections.defaultdict(list)
 for x in rows:buckets[(x["logic"],x["symbol"])].append(x["entryMs"])
 count=0;clusters=collections.Counter()
 for k,v in buckets.items():
  last=None
  for ts in sorted(v):
   if last is None or ts-last>24*HOUR_MS:
    count+=1;clusters[k]+=1
   last=ts
 return {"episodes24hSameLogicSymbol":count,
   "episodesByLogic":dict(sorted(collections.Counter({k[0]:sum(v for kk,v in clusters.items() if kk[0]==k[0]) for k in clusters}).items()))}
def source_csv(folder,bps):
 x=list(folder.glob(f"*_{bps}BPS_FILLS.csv"))
 if len(x)!=1:raise ValueError("EXPECTED_ONE_FILL_SOURCE_CSV")
 return x[0]
def audit_case(folder:Path,bps:int,bars:list):
 p=source_csv(folder,bps);data=[];seen=set()
 for row in entries(p):
  tid=row["trade_id"]
  if not tid or tid in seen:raise ValueError("FILL_SOURCE_DUPLICATE")
  seen.add(tid)
  if row["signed_execution_verified"]!="False" or row["actual_venue_order_id"] or row["actual_filled_quantity"]:
   raise ValueError("VENUE_FILL_MISREPRESENTED_AS_MODEL")
  start=ms(row["entry_utc"]);end=ms(row["exit_utc"])
  if not ms(START)<=start<end<=ms(END):
   raise ValueError("FILL_OUTSIDE_FIXED_YEAR")
  side=row["side"];entry=fnum(row["model_entry_price"]);exit=fnum(row["model_exit_price"])
  if side not in ("LONG","SHORT") or min(entry,exit)<=0:raise ValueError("DIRECTION_INVALID")
  net=fnum(row["net_pnl_jpy"]);gross=fnum(row["pnl_before_cost_jpy"])
  fee=fnum(row["entry_fee_jpy"])+fnum(row["exit_fee_jpy"])
  funding=fnum(row["funding_model_jpy"])
  if not math.isclose(net,gross-fee+funding,rel_tol=1e-10,abs_tol=1e-6):
   raise ValueError("MODEL_NET_FEES_FUNDING_MISMATCH")
  b=btc_features(bars,start)
  data.append({"tradeId":tid,"logic":row["strategy"],"route":row["route"],
     "symbol":row["symbol"],"side":side,"entryUtc":row["entry_utc"],
     "entryMs":start,"exitUtc":row["exit_utc"],"exitReason":row["exit_model_reason"],
     "netModelJpy":net,"grossModelJpy":gross,
     "adversePriceDirection":exit>entry if side=="SHORT" else exit<entry,
     "entryInDDWindow":ms(PEAK_UTC)<start<=ms(TROUGH_UTC),
     "exitInDDWindow":ms(PEAK_UTC)<end<=ms(TROUGH_UTC),
     **b})
 if len(data)!=EXPECTED_MODEL_FILLS[bps]:raise ValueError("SOURCE_FILL_COHORT_DRIFT")
 window_exit=[t for t in data if t["exitInDDWindow"]]
 window_entry=[t for t in data if t["entryInDDWindow"]]
 if len(window_exit)!={10:59,30:61}[bps]:
  raise ValueError("MAX_DD_EXIT_WINDOW_COHORT_DRIFT")
 routes=collections.defaultdict(list)
 for t in window_exit:routes[(t["logic"],t["route"])].append(t)
 losing=sorted([{"logic":logic,"route":route,**aggregate(v)}
  for (logic,route),v in routes.items() if aggregate(v)["netModelJpy"]<0],
  key=lambda x:x["netModelJpy"])
 return {"bps":bps,"totalModeledClosedFills":len(data),
  "ddWindowExitCount":len(window_exit),
  "ddWindowEntryCount":len(window_entry),
  "allFillEntryRegime":group(data,"btcRegime"),
  "ddExitWindowRegimeAtEntry":group(window_exit,"btcRegime"),
  "ddExitWindowVolAtEntry":group(window_exit,"btcVolRegime"),
  "ddExitWindowByLogic":group(window_exit,"logic"),
  "ddEntryWindowByRegime":group(window_entry,"btcRegime"),
  "ddExitWindowSameSymbolEpisodes":count_episodes(window_exit),
  "fiveWorstModeledCloseRoutes":losing[:5],
  "fullModeledTradesInWindow":window_exit,
  "frozenDescriptiveRegimeThresholds":{"strong24h":.02,"strong72h":.03,"high24hRealizedVol":.03},
  "modelClosedReturnNotFullDDAttribution":True,
  "sourceFillSha256":sha(p)}
def build(folder,btc_path):
 bars=load_btc(btc_path)
 return {"schema":"disdex-bt-btc-closed-h1-regime-vs-maxdd-exits/v1",
   "status":"MODEL_BTC_PREENTRY_CLOSED_H1_DESCRIPTIVE_RECONCILED",
   "period":[START,END],"peakUtc":PEAK_UTC,"troughUtc":TROUGH_UTC,
   "btcH1Count":len(bars),"btcSourceSha256":sha(btc_path),
   "cases":{str(b):audit_case(folder,b,bars) for b in (10,30)},
   "regimeThresholdsNotFitOnTargetYear":True,
   "regimeRetrospectiveGroupingCannotValidateTradingGate":True,
   "fullPortfolioOOSOrVenueFillCertified":False,
   "productionMutations":0}
def main():
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument("--case-dir",type=Path,required=True)
 p.add_argument("--btc-h1",type=Path,required=True)
 p.add_argument("--output",type=Path,required=True)
 args=p.parse_args();d=build(args.case_dir,args.btc_h1)
 args.output.write_text(json.dumps(d,ensure_ascii=False,indent=2,allow_nan=False)+"\n","utf8")
 print(json.dumps({"status":d["status"],"cases":{
  b:{"DDCloseN":v["ddWindowExitCount"],
     "DDEntryN":v["ddWindowEntryCount"],
     "entryRegimes":{k:x["n"] for k,x in v["ddExitWindowRegimeAtEntry"].items()},
     "episodes24h":v["ddExitWindowSameSymbolEpisodes"]["episodes24hSameLogicSymbol"]}
    for b,v in d["cases"].items()}},ensure_ascii=False))
if __name__=="__main__":main()
