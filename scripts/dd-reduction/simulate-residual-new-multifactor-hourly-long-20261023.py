#!/usr/bin/env python3
"""Research a *new* causal DOGE/AVAX LONG entry architecture, not just vetoing 17 fills.

Hour end H1 decision (prior M5 bar completely closed) -> fill next M5 OPEN.
Original residual policy anchor: relative24h +3%, volume ratio 1.2 DOGE /
0.8 AVAX, 3h M5 ATR >=0.7%, 12h hold, gross1.0, emergency stop -10%,
takeprofit +25%. This script uses independent M5 OHLCV causal features
and stress fees 10bps/30bps. ATR3h feature from validated historical M5.
Unlike the source V52/8-logic engine, this tests potential new signals
independent of slot conflicts, other runners and all dynamic selection.
It MUST NOT be described as certified 8-logic or LIVE performance.

Period fixed at 2025-08-10..2026-08-10; holdout time cutoff 2026-02-10.
Case rules are predeclared, not hand-picked by inspecting future bars.
"""
from __future__ import annotations
import bisect,collections,datetime,hashlib,importlib.util,json,math,statistics
from pathlib import Path
HERE=Path(__file__).resolve().parent;REPO=HERE.parents[1]
ROOT=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-22_hype_entry_plus_exit_full8")
OUT=REPO/"docs/research/results/residual-entry-after-amzn-20261023"
M5=300000;H=3600000
START=int(datetime.datetime(2025,8,10,tzinfo=datetime.timezone.utc).timestamp()*1000)
END=int(datetime.datetime(2026,8,10,tzinfo=datetime.timezone.utc).timestamp()*1000)
SPLIT=int(datetime.datetime(2026,2,10,tzinfo=datetime.timezone.utc).timestamp()*1000)
def load(name,path):
 sp=importlib.util.spec_from_file_location(name,path);assert sp and sp.loader
 mod=importlib.util.module_from_spec(sp);sp.loader.exec_module(mod);return mod
native=load("residual_independent_new_signal_source",HERE/"run-v52-amzn-entry-full8-after-fet-20261022.py").native
features=load("residual_new_signal_m5_causal_features",HERE/"screen-idle-five-symbol-entry-caused-20261022.py")
CASES={
 "ORIGINAL_REL_VOL":("base",),
 "BTC6_UP":("base","btc6up"),
 "BTC24_UP":("base","btc24up"),
 "DOGE3_UP":("base","ret3up"),
 "DOGE6_UP":("base","ret6up"),
 "REL3_UP":("base","rel3up"),
 "BTC6_UP_REL3_UP":("base","btc6up","rel3up"),
 "BTC6_UP_RET3_UP":("base","btc6up","ret3up"),
 "BTC24_UP_RET3_UP":("base","btc24up","ret3up"),
 "BTC6_UP_RET3_UP_VOL15":("base","btc6up","ret3up","vol15"),
 "BTC6_UP_REL3_UP_VOL15":("base","btc6up","rel3up","vol15"),
 "BTC6_UP_REL3_UP_EMA_UP":("base","btc6up","rel3up","ema"),
 "REL3_UP_EMA_UP":("base","rel3up","ema"),
 "BTC6_UP_REL3_UP_BREAKOUT1H":("base","btc6up","rel3up","breakout"),
 "BTC6_UP_REL3_UP_PULLBACK":("base","btc6up","rel3up","pullback"),
 "BTC6_UP_REL3_UP_COOLDOWN6":("base","btc6up","rel3up","cooldown6"),
 "NO_REL24_BTC6_REL3":("btc6up","rel3up","vol15","ema"),
 "NO_REL24_BTC24_RET3":("btc24up","ret3up","vol15"),
 "NO_REL24_BTC6_BREAKOUT":("btc6up","rel3up","breakout"),
 "NO_REL24_PULLBACK":("btc6up","rel3up","pullback","ema"),
}
# All entry rules only use fully closed history.
def allow(sym,rule,feat,bars,j):
 def ok(x):return x is not None and math.isfinite(float(x))
 def val(k):return float(feat.get(k)) if ok(feat.get(k)) else None
 if "base" in rule:
  # original gross1; rel24Min +3% is relative to BTC.
  if val("rel24h") is None or val("rel24h")<3:return False
  if val("volratio") is None or val("volratio")< (1.2 if sym=="DOGEUSDT" else .8):return False
  if val("atr3h") is None or val("atr3h")<.7:return False
 if "btc6up" in rule and (val("btc6h") is None or val("btc6h")<=0):return False
 if "btc24up" in rule and (val("btc24h") is None or val("btc24h")<=0):return False
 if "ret3up" in rule and (val("ret3h") is None or val("ret3h")<=0):return False
 if "ret6up" in rule and (val("ret6h") is None or val("ret6h")<=0):return False
 if "rel3up" in rule and (val("rel3h") is None or val("rel3h")<=0):return False
 if "vol15" in rule and (val("volratio") is None or val("volratio")<1.5):return False
 if "ema" in rule:
  if j<40:return False
  closes=[float(bars[k][4]) for k in range(j-36,j+1)]
  ema12=closes[0];ema36=closes[0]
  a=2/13;b=2/37
  for close in closes[1:]:
   ema12+=a*(close-ema12)
   ema36+=b*(close-ema36)
  if not (ema12>ema36 and closes[-1]>ema12):return False
 if "breakout" in rule:
  if j<13:return False
  highest=max(float(bars[k][2]) for k in range(j-12,j))
  if float(bars[j][4])<=highest:return False
 if "pullback" in rule:
  # Recovery after weak preceding hour, positive last 30 min, avoid chasing an
  # already strongly extended 1h swing.
  if j<24:return False
  last=float(bars[j][4]);close_30=float(bars[j-6][4]);close_1h=float(bars[j-12][4])
  if not (last>close_30 and -.015<last/close_1h-1<.005):return False
 return True
def prefilter(sym,feat):
 return feat is not None and all(feat.get(k) is not None and math.isfinite(float(feat[k]))
                                 for k in ("ret1h","rel24h","volratio","atr3h","btc6h","btc24h","ret3h","rel3h"))
def stream_events(sym,case,source):
 rule=CASES[case]
 bars,times=source.getdata(sym)
 begin=bisect.bisect_left(times,START)
 end=bisect.bisect_left(times,END)
 proposals=[]
 for index in range(max(begin,290),end):
  # M5 starting HH:55 is completed at HH:00 of next hour. Earliest entry on next M5.
  decision=times[index]+M5
  if decision%H or index+1>=end:continue
  if times[index+1]!=decision:continue
  feat=features.get_feat(source,sym,decision)
  if not prefilter(sym,feat):continue
  if not allow(sym,rule,feat,bars,index):continue
  proposals.append((index+1,decision,feat))
 return bars,times,proposals
def test_strategy(sym,case,source,cost):
 bars,times,signals=stream_events(sym,case,source)
 k=0;last_exit=-1;trades=[];signals_count=len(signals)
 for idx,entry,feat in signals:
  if entry<=last_exit:continue
  ep=float(bars[idx][1])
  if ep<=0:continue
  end=min(len(bars)-1,idx+144)
  price=None;ts=None;kind=None;max_mtm=0.;min_mtm=0.
  # protective stop and takeprofit (original -10/+25 pct). Lower first if both in same bar.
  for j in range(idx,end):
   ot,openp,hi,low,cl,vol=bars[j]
   if j>idx and ot!=times[j-1]+M5:raise RuntimeError("M5_CANDLE_GAP")
   max_mtm=max(max_mtm,100*(float(hi)/ep-1))
   min_mtm=min(min_mtm,100*(float(low)/ep-1))
   stop=ep*.90
   take=ep*1.25
   if float(low)<=stop:
    # stop-order gap through worse than stop
    price=min(float(openp),stop);ts=ot+M5;kind="EMERGENCY_STOP10"
    break
   if float(hi)>=take:
    price=take;ts=ot+M5;kind="EMERGENCY_TAKE25"
    break
  if price is None:
   price=float(bars[end][1]);ts=int(times[end]);kind="TIME12H"
  # Round trip cost charged as half notional on entry and half on exit;
  # no funding, no real venue book/slippage beyond 10/30bps expense.
  fee=cost/10000
  pnl_pct=100*(price/ep-1-fee)
  event={"entryTsMs":entry,"exitTsMs":int(ts),
    "entryUtc":datetime.datetime.fromtimestamp(entry/1000,datetime.timezone.utc).isoformat(),
    "side":"LONG","symbol":sym,"scenario":case,"entry":ep,"exit":price,"reason":kind,
    "netPnlPct":pnl_pct,"maxMfePct":max_mtm,"maxMaePct":min_mtm,
    "volumeRatio":feat["volratio"],"relative24hPct":feat["rel24h"],
    "relative3hPct":feat["rel3h"],"btc6hPct":feat["btc6h"],"ret3hPct":feat["ret3h"]}
  trades.append(event);last_exit=int(ts)
 return trades,signals_count
def stats(rows):
 n=len(rows);wins=[x for x in rows if x["netPnlPct"]>0];loss=[x for x in rows if x["netPnlPct"]<=0]
 gain=sum(x["netPnlPct"] for x in wins);negative=sum(x["netPnlPct"] for x in loss)
 eq=10000.;peak=eq;dd=0.;max_hold=0
 for x in rows:
  eq*=1+x["netPnlPct"]/100
  if eq<=0:raise ValueError("EQUITY_ZERO")
  peak=max(peak,eq);dd=min(dd,100*(eq/peak-1))
 return {"trades":n,"wins":len(wins),"losses":len(loss),
  "winRatePct":100*len(wins)/n if n else None,
  "grossProfitPercentPoints":gain,"grossLossPercentPoints":negative,
  "tradeProfitFactor":gain/(-negative) if negative<0 else None,
  "sumNetReturnPoints":gain+negative,
  "compoundJpyFrom10000":eq,"closedTradeDDPct":dd,
  "avgNetPnlPct":statistics.mean(x["netPnlPct"] for x in rows) if n else None}
def main():
 native.m.acquire_verified_h1()
 source,_=native.m.m.core.task8.legacy.bootstrap()
 out={"schema":"residual-new-independent-hourly-entry-design-v1",
  "status":"RESEARCH_ONLY_INDEPENDENT_CANDIDATE_STREAM_NOT_FULL8_NOT_LIVE",
  "originalPolicy":"rel24>=+3%, volratio>=1.2 DOGE/0.8 AVAX, ATR3h>=0.7%, hold12h, STOP-10%, TAKE+25%",
  "estimatedRoundTripCostsBps":[10,30],
  "period":"2025-08-10..2026-08-10",
  "trainEnd":"2026-02-10",
  "causality":"HH:55 completed M5 -> next HH:00 M5 open entry; gap fail; stop-before-take same candle",
  "limitations":["No funding, financing, venue L2 slippage, exact price source parity, or margin/liquidation accounting",
  "No integration into eight-strategy wallet, no shared cap, pending exposures or original stock suppressed 11",
  "Same-year exploratory signal research; no independent unseen external holdout"],
  "definitions":CASES,"cases":{}}
 rows=[]
 for case in CASES:
  for sym in ("DOGEUSDT","AVAXUSDT"):
   for c in (10,30):
    trades,signalc= test_strategy(sym,case,source,c)
    # Need a common exact chronological split; no CV.
    train=[x for x in trades if x["entryTsMs"]<SPLIT]
    later=[x for x in trades if x["entryTsMs"]>=SPLIT]
    d={"all":stats(trades),"early":stats(train),"late":stats(later),
       "triggerEventsBeforeOccupancy":signalc}
    out["cases"].setdefault(case,{}).setdefault(sym,{})[str(c)]=d
    if c==10:
     rows.extend(trades)
    # print all: 20 cases*2*2 =80 compact.
    print("NEW_ENTRY",case,sym,c,"N",len(trades),
      "WR",round(d["all"]["winRatePct"] or 0,1),"PF",round(d["all"]["tradeProfitFactor"] or 0,3),
      "DD",round(d["all"]["closedTradeDDPct"],2),
      "TRAIN",d["early"]["wins"],"/",d["early"]["trades"],
      "LATE",d["late"]["wins"],"/",d["late"]["trades"],
      "SCORE",round(d["all"]["compoundJpyFrom10000"]),flush=True)
 OUT.mkdir(parents=True,exist_ok=True)
 (OUT/"RESIDUAL_INDEPENDENT_NEW_ENTRY_MODEL_20261023.json").write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf-8",newline="\n")
 import csv
 with (OUT/"RESIDUAL_INDEPENDENT_NEW_ENTRY_ALL_EVENTS_10BPS_20261023.csv").open("w",encoding="utf-8",newline="") as f:
  w=csv.DictWriter(f,fieldnames=list(rows[0]),lineterminator="\n");w.writeheader();w.writerows(rows)
 print("ALL_INDEPENDENT_STRATEGY_SCENARIOS_COMPLETE",len(CASES),len(rows),flush=True)
if __name__=="__main__":main()
