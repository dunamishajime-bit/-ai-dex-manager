#!/usr/bin/env python3
"""PRISM II — PENGU five-minute causality and real delayed-entry counterfactuals.

Research only. Does NOT reproduce native trailing exits, slippage/funding,
portfolio admissions or venue fills. These are independent fixed-horizon
direction-quality experiments, with re-anchored protective stops.
"""
from __future__ import annotations
import bisect,csv,datetime as dt,gzip,hashlib,json,math,statistics,sys
from collections import Counter,defaultdict
from pathlib import Path

ROOT=Path(r"C:\tmp\disdex-bt-20251001-20261001")
SRC=ROOT/"DIRECTION_RESEARCH_20261109"/"three_layer_layer1_all_candidates_20261114.jsonl"
OUT=Path(sys.argv[1]) if len(sys.argv)>1 else Path.cwd()/"PENGU_M5_RESEARCH"
OUT.mkdir(parents=True,exist_ok=True)
BAR=300000
END=int(dt.datetime(2026,10,1,tzinfo=dt.timezone.utc).timestamp()*1000)
CUT1=int(dt.datetime(2026,4,1,tzinfo=dt.timezone.utc).timestamp()*1000)
CUT2=int(dt.datetime(2026,7,1,tzinfo=dt.timezone.utc).timestamp()*1000)
ROUTES=("RECOVERY_V8","SHORT_V20","LONG_V64")
DELAY=(0,1,2,4)
HORIZONS=(24,48,72)
FEE=(10,30)
RULES=("all","follow_positive","follow_0p5pct","follow_1pct",
       "follow_1pct_and_no_2pct_adverse","micro_momentum_and_taker",
       "h1_range_breakout")
# All thresholds fixed before evaluation, no holdout ranking in construction.

def filehash(p):
 h=hashlib.sha256()
 with p.open("rb") as f:
  for b in iter(lambda:f.read(1<<18),b""):h.update(b)
 return h.hexdigest()

def parse_bars(symbol):
 fs=[]
 for folder in ("aster-public-v3-5m-prefix","aster-public-v3-5m-suffix"):
  fs+=sorted((ROOT/folder).glob(f"{symbol}-5m-*.jsonl.gz"))
 if not fs:return None
 by={}
 for p in fs:
  with gzip.open(p,"rt",encoding="utf8") as f:
   for line in f:
    r=json.loads(line)
    t=int(r[0]);o=float(r[1]);h=float(r[2]);l=float(r[3]);c=float(r[4])
    v=float(r[5]);buy=float(r[9]);trades=int(r[8])
    if not (0<l<=max(o,c,h) and h>=max(o,c,l) and v>=0 and 0<=buy<=v+1e-7):
     raise ValueError(f"MALFORMED_OHLCV:{symbol}:{t}")
    tup=(o,h,l,c,v,buy,trades)
    if t in by and by[t]!=tup:raise ValueError(f"CONFLICTING_DUPLICATE:{symbol}:{t}")
    by[t]=tup
 keys=sorted(by)
 return {"t":keys,"b":[by[k] for k in keys],"i":{k:i for i,k in enumerate(keys)},
   "hashes":{p.name:filehash(p) for p in fs},"coverage":[keys[0],keys[-1]],"n":len(keys)}

coins={s:parse_bars(s) for s in ("PENGUUSDT","BTCUSDT")}
for symbol,a in coins.items():
 if not a:raise ValueError("MISSING_M5_DATA:"+symbol)

def coverage(sym,start,end):
 a=coins[sym]
 first=a["i"].get(start)
 last=a["i"].get(end)
 if first is None or last is None:return False
 if last<=first:return False
 return a["t"][last]-a["t"][first]==(last-first)*BAR

def before(sym,ts,n):
 a=coins[sym]
 idx=a["i"].get(ts-BAR)
 if idx is None or idx-n+1<0:return None
 if a["t"][idx]-a["t"][idx-n+1]!=(n-1)*BAR:return None
 return a["b"][idx-n+1:idx+1]

def close_ratio(bars,h):
 if len(bars)<h+1:return None
 return bars[-1][3]/bars[-h-1][3]-1

def m5features(ts,side):
 p=before("PENGUUSDT",ts,288)
 b=before("BTCUSDT",ts,288)
 if p is None or b is None:return None
 n=1 if side=="LONG" else -1
 close=p[-1][3]
 prev72=p[-73][3]
 er=abs(close-prev72)/max(1e-15,sum(abs(p[i][3]-p[i-1][3]) for i in range(len(p)-71,len(p))))
 range24=max(x[1] for x in p[-288:])-min(x[2] for x in p[-288:])
 rng=(close-min(x[2] for x in p[-288:]))/max(range24,1e-15)
 v1=sum(x[4] for x in p[-12:])
 v24=sum(x[4] for x in p)
 buy1=sum(x[5] for x in p[-12:])
 buy6=sum(x[5] for x in p[-72:])
 vol6=sum(x[4] for x in p[-72:])
 wick_upper=sum(max(0,x[1]-max(x[0],x[3])) for x in p[-24:])
 wick_lower=sum(max(0,min(x[0],x[3])-x[2]) for x in p[-24:])
 h1=max(x[1] for x in p[-12:])
 l1=min(x[2] for x in p[-12:])
 tks=sum(x[6] for x in p[-12:])
 return {"m5_15m_aligned_pct":100*n*close_ratio(p,3),
 "m5_1h_aligned_pct":100*n*close_ratio(p,12),
 "m5_3h_aligned_pct":100*n*close_ratio(p,36),
 "m5_6h_aligned_pct":100*n*close_ratio(p,72),
 "m5_24h_aligned_pct":100*n*close_ratio(p,287),
 "btc_1h_aligned_pct":100*n*close_ratio(b,12),
 "btc_6h_aligned_pct":100*n*close_ratio(b,72),
 "btc_24h_aligned_pct":100*n*close_ratio(b,287),
 "relative_1h_pct":100*n*(close_ratio(p,12)-close_ratio(b,12)),
 "relative_6h_pct":100*n*(close_ratio(p,72)-close_ratio(b,72)),
 "eff_6h":er,"range_position_24h":rng,
 "volume_recent_vs_24h":(v1*24/v24 if v24>0 else None),
 "direction_taker_1h":(buy1/v1 if n==1 else 1-buy1/v1) if v1>0 else None,
 "direction_taker_6h":(buy6/vol6 if n==1 else 1-buy6/vol6) if vol6>0 else None,
 "wick_balance_2h":(wick_lower-wick_upper)/(wick_lower+wick_upper+1e-15)*n,
 "last_1h_hi":h1,"last_1h_lo":l1,"last_close":close,"last_1h_trade_count":tks,
 "last_confirmed_m5_start":ts-BAR}

def stop_horizon(sym,ts,hours,entry_price,direction,stop_pct):
 stop=entry_price*(1-stop_pct*direction)
 end=ts+hours*3600000
 if end>END:return None
 if not coverage(sym,ts,end):return None
 a=coins[sym]
 start=a["i"][ts];end_i=a["i"][end]
 stop_hit=None
 for i in range(start,end_i):
  b=a["b"][i]
  if (direction==1 and b[2]<=stop) or (direction==-1 and b[1]>=stop):
   next_open=a["b"][i+1][0]
   # Conservative next-candle-open adverse gap; never assume favorable STOP fill.
   fill=min(stop,next_open) if direction==1 else max(stop,next_open)
   stop_hit={"price":fill,"when":a["t"][i+1],"stop_bar":a["t"][i],"bar_ohhl":list(b[:4])}
   break
 last=a["b"][end_i][0]
 endprice=stop_hit["price"] if stop_hit else last
 return {"return":direction*(endprice/entry_price-1),"stop":bool(stop_hit),
 "stop_meta":stop_hit,"exit_utc":(stop_hit["when"] if stop_hit else end),
 "exit_price":endprice}

def phase(ts):
 if ts<CUT1:return "development"
 if ts<CUT2:return "validation"
 return "post_validation"

def winstats(rows,fee):
 a=[r["scenarios"][fee] for r in rows]
 n=len(a);wins=sum(x["net_return_pct"]>0 for x in a)
 net=[x["net_return_pct"] for x in a]
 return {"n":n,"wins":wins,"win_pct":round(100*wins/n,2) if n else None,
  "mean_net_pct":round(statistics.mean(net),3) if n else None,
  "median_net_pct":round(statistics.median(net),3) if n else None,
  "sum_net_pct":round(sum(net),3),
  "stop_count":sum(x["stop_hit"] for x in a)}

def gate(rule,base,late,now,side):
 if rule=="all":return True
 move=side*(late/base-1)
 if rule=="follow_positive":return move>0
 if rule=="follow_0p5pct":return move>=.005
 if rule=="follow_1pct":return move>=.01
 if rule=="follow_1pct_and_no_2pct_adverse":
  return move>=.01 and now["max_adverse_before_entry_pct"]<=2.0
 if rule=="micro_momentum_and_taker":
  return now["micro"]["m5_1h_aligned_pct"]>=.3 and (now["micro"]["direction_taker_1h"] or 0)>=.52
 if rule=="h1_range_breakout":
  return late>=now["base_1h_hi"] if side==1 else late<=now["base_1h_lo"]
 raise ValueError("UNKNOWN_RULE")

signals=[]
with SRC.open(encoding="utf8") as f:
 for line in f:
  d=json.loads(line)
  if d["strategy"]=="PENGU":signals.append(d)
assert len(signals)==116,len(signals)
signatures=set()
traces=[];miss=Counter()
for si in signals:
 ts=int(si["entryTs"]);d=1 if si["side"]=="LONG" else -1
 if si["route"] not in ROUTES:raise ValueError("ROUTE_DRIFT")
 key=(si["id"],ts)
 if key in signatures:raise ValueError("DUPLICATE_SIGNAL_ID")
 signatures.add(key)
 a=coins["PENGUUSDT"];i=a["i"].get(ts)
 if i is None:miss["entry_m5_missing"]+=1;continue
 native_price=float(si["model"]["entryPrice"])
 src_open=a["b"][i][0]
 entry_parity=abs(src_open/native_price)/native_price if False else abs(src_open-native_price)/native_price
 if entry_parity>0.0005:
  miss["entry_price_deviation_over_5bps"]+=1
 base=src_open
 prev=before("PENGUUSDT",ts,12)
 if not prev:miss["baseline_h1_incomplete"]+=1;continue
 stop_pct=.06 if si["route"]=="RECOVERY_V8" else .08
 for delay in DELAY:
  entry=ts+delay*3600000
  if entry>=END:continue
  ii=a["i"].get(entry)
  if ii is None:miss["delayed_entry_missing"]+=1;continue
  if not coverage("PENGUUSDT",ts,entry) and delay>0:
   miss["confirmation_gap"]+=1;continue
  newprice=a["b"][ii][0]
  micro=m5features(entry,d)
  if micro is None:
   miss["pre_entry_micro_incomplete"]+=1;continue
  lows=[x[2] for x in a["b"][i:ii]]
  highs=[x[1] for x in a["b"][i:ii]]
  max_adv=max(0,(base-min(lows))/base*100) if d==1 and lows else (
    max(0,(max(highs)-base)/base*100) if d==-1 and highs else 0)
  bundle={"micro":micro,"max_adverse_before_entry_pct":max_adv,
          "base_1h_hi":max(x[1] for x in prev),
          "base_1h_lo":min(x[2] for x in prev)}
  rules={x:gate(x,base,newprice,bundle,d) for x in RULES}
  for horizon in HORIZONS:
   outcome=stop_horizon("PENGUUSDT",entry,horizon,newprice,d,stop_pct)
   if outcome is None:
    miss["stop_or_horizon_data_unavailable"]+=1;continue
   record={"signal_id":si["id"],"route":si["route"],"side":si["side"],
    "entryTs":ts,"original_entry_utc":dt.datetime.fromtimestamp(ts/1000,dt.timezone.utc).isoformat(),
    "phase":phase(ts),"delay_hours":delay,"horizon_hours":horizon,
    "entry_price":newprice,"native_entry_price":native_price,"entry_source_open":src_open,
    "original_model_exit_ts":si["model"]["exitTs"],
    "price_asof":entry,
    "pre_entry_features":micro,"confirmation":rules,
    "max_adverse_before_entry_pct":max_adv,"original_model_exit_reason":si["model"]["exitReason"],
    "scenarios":{str(fee):{"net_return_pct":100*(outcome["return"]-fee/10000),
      "stop_hit":outcome["stop"],"exit_time":outcome["exit_utc"],
      "exit_price":outcome["exit_price"]} for fee in FEE}}
   traces.append(record)
 # sanity never use native exit to construct a scenario.
by=defaultdict(list)
for x in traces:
 for policy,allowed in x["confirmation"].items():
  if x["delay_hours"]==0 and policy!="all":continue
  if allowed:by[(x["route"],x["phase"],x["delay_hours"],x["horizon_hours"],policy)].append(x)
agg=[]
for (route,p,delay,horizon,pol),rs in sorted(by.items()):
 agg.append({"route":route,"period":p,"delay_hours":delay,"horizon_hours":horizon,
             "confirmation":pol,
             **{f"{fee}bps_{k}":v for fee in FEE for k,v in winstats(rs,str(fee)).items()}})
full=defaultdict(list)
for x in traces:
 if x["delay_hours"]==0:
  full[(x["route"],x["phase"],x["horizon_hours"])].append(x)
# Pair different delay/rule against fixed-horizon same candidate baseline.
pair=[]
index={(x["signal_id"],x["horizon_hours"]):x for x in traces if x["delay_hours"]==0}
for (route,p,delay,horizon,pol),rs in sorted(by.items()):
 if delay==0:continue
 paired=[(index[(x["signal_id"],horizon)],x) for x in rs
         if (x["signal_id"],horizon) in index]
 if len(paired)!=len(rs):raise ValueError("PAIR_MISMATCH")
 for fee in FEE:
  base_stats=winstats([a for a,b in paired],str(fee))
  test_stats=winstats([b for a,b in paired],str(fee))
  pair.append({"route":route,"period":p,"delay_hours":delay,"horizon_hours":horizon,
       "rule":pol,"fee":fee,
       "paired_n":len(paired),
       "baseline_wr_pct":base_stats["win_pct"],
       "delayed_wr_pct":test_stats["win_pct"],
       "delta_wr_points":round(test_stats["win_pct"]-base_stats["win_pct"],2) if len(paired) else None,
       "baseline_mean_pct":base_stats["mean_net_pct"],
       "delayed_mean_pct":test_stats["mean_net_pct"],
       "delta_mean_pct":round(test_stats["mean_net_pct"]-base_stats["mean_net_pct"],3) if len(paired) else None,
       "original_wins_to_delayed_losses":sum(a["scenarios"][str(fee)]["net_return_pct"]>0 and b["scenarios"][str(fee)]["net_return_pct"]<=0 for a,b in paired),
       "original_losses_to_delayed_wins":sum(a["scenarios"][str(fee)]["net_return_pct"]<=0 and b["scenarios"][str(fee)]["net_return_pct"]>0 for a,b in paired),
       "all_baseline_n":len(full[(route,p,horizon)]),
       "kept_percent_of_available":round(100*len(rs)/len(full[(route,p,horizon)]),2)})
with (OUT/"pengu_m5_entry_retiming_trace.json").open("w",encoding="utf8") as f:
 json.dump({"schema":"prism-pengu-causal-m5-reentry/v1","signals":len(signals),
 "scenarios":len(traces),"missing":dict(miss),"source_hashes":{"candidates":filehash(SRC),
 "m5_files":{sym:v["hashes"] for sym,v in coins.items()}},"rows":traces,
 "limitations":["Fixed-horizon exit and hard stop are synthetic: native trailing, partial fills, funding, Gross, shared risk are not replayed",
 "Delayed confirmation bar is fully closed at the delayed-entry timestamp, then entry is priced at that bar's opening",
 "Never use a candidate's original modeled exit for confirmation/entry; only as forensic metadata",
 "Hard-stop triggers use 5m high/low and conservatively model next 5m open adverse gaps",
 "Multiple candidate signals overlap; treating every candidate as an independent position overstates effective sample size",
 "No winner-based threshold is selected using post-validation data"]},f,ensure_ascii=False,separators=(",",":"),allow_nan=False)
def writecsv(name,rows):
 if not rows:return
 with (OUT/name).open("w",encoding="utf8-sig",newline="") as f:
  keys=list(dict.fromkeys(k for d in rows for k in d))
  w=csv.DictWriter(f,keys);w.writeheader();w.writerows(rows)
writecsv("pengu_m5_all_strategies_winrate.csv",agg)
writecsv("pengu_m5_delayed_entry_paired_comparison.csv",pair)
print("PENGU_M5_REPLAY",json.dumps({"signals":len(signals),"trace_rows":len(traces),
 "missing":dict(miss),"per_combo":len(agg),"paired":len(pair)},ensure_ascii=False),flush=True)
for route in ROUTES:
 print("ROUTE",route)
 for phase in ("development","validation","post_validation"):
  for horizon in (24,48,72):
   base_rows=full[(route,phase,horizon)]
   if not base_rows:continue
   stats=winstats(base_rows,"30")
   print("BASE",phase,horizon,stats,flush=True)
  choices=[x for x in pair if x["route"]==route and x["period"]==phase and x["fee"]==30 and x["horizon_hours"]==48 and x["paired_n"]>=3]
  for x in sorted(choices,key=lambda y:-y["delta_mean_pct"])[:6]:
   print("PAIR48",phase,x["delay_hours"],x["rule"],x["paired_n"],
     "base%",x["baseline_wr_pct"],"delayed%",x["delayed_wr_pct"],
     "uplift",x["delta_mean_pct"],"kept",x["kept_percent_of_available"],flush=True)
