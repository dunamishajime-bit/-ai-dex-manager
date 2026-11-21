#!/usr/bin/env python3
"""PRISM II external-date PENGU forward validation, pinned native entries.

Research only. Sources: exactly reproduced PENGU pinned 116 entries, 11 new
candidate entries from the same TS signal body, unsigned public Aster H1/M5.
Modelled exits are *not* certified native STOP/trailing/partial or venue fills.
No execution APIs are contacted, no LIVE actions.
"""
from __future__ import annotations
import csv,datetime as dt,gzip,hashlib,json,math,statistics,sys
from collections import Counter,defaultdict
from pathlib import Path
OLD="C:/tmp/disdex-bt-20251001-20261001"
WORK=Path(sys.argv[1]) if len(sys.argv)>1 else Path("C:/Users/dis/Documents/DisDex_Research/WINRATE_DEEP_20261122")
FWD=WORK/"forward_public_20261001_20261118"
OUT=WORK/"phase2_results"
OUT.mkdir(parents=True,exist_ok=True)
START=int(dt.datetime(2026,10,1,tzinfo=dt.timezone.utc).timestamp()*1000)
END=int(dt.datetime(2026,11,18,tzinfo=dt.timezone.utc).timestamp()*1000)
STEP=300000
HOUR=3600000
PINNED=json.loads((OUT/"PENGU_PINNED_SIGNAL_PARITY.json").read_text(encoding="utf8"))
if not PINNED["eligible_for_forward"] or PINNED["original_count"]!=116:
 raise RuntimeError("FORWARD_BLOCKED_UNTIL_PINNED_116_PARITY_PASS")
raw=json.loads((OUT/"PENGU_PINNED_FORWARD_SIGNALS.json").read_text(encoding="utf8"))
if raw["original_parity_pass"] is not True:raise RuntimeError("ORIGINAL_PARITY_FALSE")
signals=raw["signals"]
if len(signals)!=11:raise RuntimeError("UNEXPECTED_PINNED_SIGNAL_COUNT")
source_files={
 sym: FWD/f"{sym}-5m-20261001-20261118.jsonl.gz"
 for sym in ("PENGUUSDT","BTCUSDT")}
data={}
for sym,p in source_files.items():
 m={}
 with gzip.open(p,"rt",encoding="utf8") as f:
  for line in f:
   x=json.loads(line);t=int(x[0])
   if t in m:raise ValueError("DUPLICATE_M5")
   m[t]=[float(x[i]) for i in (1,2,3,4,5,9)]
 ts=sorted(m)
 if len(ts)!=(END-START)//STEP or ts[0]!=START or ts[-1]!=END-STEP:raise ValueError("INCOMPLETE_M5:"+sym)
 if any(ts[i+1]-ts[i]!=STEP for i in range(len(ts)-1)):raise ValueError("M5_TIME_GAP")
 data[sym]={"times":ts,"bars":[m[t] for t in ts],"index":{t:i for i,t in enumerate(ts)},
 "sha256":hashlib.sha256(p.read_bytes()).hexdigest()}
bars=data["PENGUUSDT"];barv=bars["bars"];times=bars["times"];idx=bars["index"]
def side(s):return 1 if s=="LONG" else -1
def eligibility(s):
 z=s["features"]
 if s["route"]=="SHORT_V20":
  # Prior prespecified study, FAILED on prior holdout. Frozen from 2026-11-13 study, not tuned here.
  return z["btcEma168Dist"]>=-0.021850964222922518 and z["rsi14"]>=36.851703072112535
 if s["route"]=="RECOVERY_V8":
  # Prior frozen robust historical-only BTC24 condition (2026-11-10 study).
  return s["btc24h"]<=0.008748519159543111
 if s["route"]=="LONG_V64":
  return True
 raise ValueError("BAD_ROUTE")
def hard_stop_pct(route):return .06 if route=="RECOVERY_V8" else .08
def natural_hold(route):return 72 if route=="SHORT_V20" else 120
def eval_stop(entry_ts,entry_price,direction,hours,hard_pct):
 end=entry_ts+hours*HOUR
 if end>END:return None
 k=idx.get(entry_ts);e=idx.get(end)
 if k is None or e is None or e<=k:return None
 stop=entry_price*(1-direction*hard_pct)
 first_touch=None
 maxfav=0.0;maxadverse=0.0
 for i in range(k,e):
  b=barv[i]
  fav=(b[1]/entry_price-1) if direction==1 else (1-b[2]/entry_price)
  adverse=(1-b[2]/entry_price) if direction==1 else (b[1]/entry_price-1)
  maxfav=max(maxfav,fav)
  maxadverse=max(maxadverse,adverse)
  hit=(direction==1 and b[2]<=stop) or (direction==-1 and b[1]>=stop)
  if hit:
   nextopen=barv[i+1][0]
   fill=min(stop,nextopen) if direction==1 else max(stop,nextopen)
   first_touch={"touch":times[i],"exit":times[i+1],"fill":fill,
                "stop_price":stop}
   break
 if first_touch:
  exitt=first_touch["exit"];exitprice=first_touch["fill"]
 else:
  exitt=end;exitprice=barv[e][0]
 gross=direction*(exitprice/entry_price-1)
 return {"net_pct_10bps":100*(gross-.001),"net_pct_30bps":100*(gross-.003),
  "raw_price_pct":100*gross,"exit_ts":exitt,"exit_price":exitprice,
  "exit_reason":"HARD_STOP_PROXY" if first_touch else "FIXED_HORIZON_PROXY",
  "max_favorable_pct":100*maxfav,"max_adverse_pct":100*maxadverse,
  "first_stop_touch_ts":first_touch["touch"] if first_touch else None,
  "first_stop_executed_next_open_ts":first_touch["exit"] if first_touch else None,
  "source_native_exit_verified":False}

def event_entry(signal,threshold=.01,consecutive=2,windowh=24):
 t=signal["entryTs"];start=idx[t];last=idx.get(t+windowh*HOUR)
 if last is None:return None
 origin=signal["entryReferenceOpenPrice"];direction=side(signal["side"])
 if not origin>0:raise ValueError("BAD_SIGNAL_PRICE")
 target=origin*(1+direction*threshold)
 # Candidate starts at H1 opening; use only fully CLOSED M5 candles [barStart,barStart+5m).
 for j in range(start+consecutive-1,last):
  if all((barv[k][3]>=target if direction==1 else barv[k][3]<=target)
         for k in range(j-consecutive+1,j+1)):
   nexttime=times[j]+STEP
   if nexttime not in idx:return None
   return {"entry_ts":nexttime,"price":barv[idx[nexttime]][0],
     "delay_hours":(nexttime-t)/HOUR,"prior_confirm_bar_end_ts":nexttime}
 return None

features=[]
results=[]
for s in signals:
 t=s["entryTs"];baseprice=s["entryReferenceOpenPrice"]
 if not START<=t<END:raise ValueError("OUT_OF_PERIOD_FORWARD_SIGNAL")
 k=idx.get(t)
 if k is None:raise ValueError("FORWARD_ENTRY_M5_MISSING")
 m5price=barv[k][0];d=side(s["side"]);ratio=m5price/baseprice-1
 prior=bool(eligibility(s))
 entry={"route":s["route"],"side":s["side"],"entry_ts":t,
 "entry_utc":dt.datetime.fromtimestamp(t/1000,dt.timezone.utc).isoformat(),
 "native_H1_open":baseprice,"market_M5_open":m5price,"m5_minus_h1_pct":100*ratio,
 "entry_price_parity_5bps":abs(ratio)<=.0005,
 "prior_frozen_gate_pass":prior,
 "orig_features":s["features"],"m05_shadow_pass":s["m05ShadowPass"]}
 ev=event_entry(s)
 if ev:
  entry["confirm_1pct_two_bars"]=ev
 else:
  entry["confirm_1pct_two_bars"]=None
 features.append(entry)
 for hours in (24,48,72,120):
  natural=(hours==natural_hold(s["route"]))
  for source,entryprice in (("H1_native_open",baseprice),("M5_public_open",m5price)):
   outcome=eval_stop(t,entryprice,d,hours,hard_stop_pct(s["route"]))
   if outcome:
    results.append({**{key:entry[key] for key in ("route","side","entry_ts","entry_utc","native_H1_open","market_M5_open",
       "m5_minus_h1_pct","entry_price_parity_5bps","prior_frozen_gate_pass")},
       "horizon_hours":hours,"native_max_hold_proxy":natural,
       "entry_source":source,"entry_price":entryprice,"strategy":"PENGU",
       "confirmation":"none",**outcome})
  if ev:
   outcome=eval_stop(ev["entry_ts"],ev["price"],d,hours,hard_stop_pct(s["route"]))
   if outcome:
    results.append({**{key:entry[key] for key in ("route","side","entry_ts","entry_utc","native_H1_open","market_M5_open",
       "m5_minus_h1_pct","entry_price_parity_5bps","prior_frozen_gate_pass")},
       "horizon_hours":hours,"native_max_hold_proxy":natural,
       "entry_source":"M5_after_confirm","entry_price":ev["price"],"strategy":"PENGU",
       "confirmation":"positive_1pct_2x_closed_M5_within24h",**outcome})

def stats(rows):
 n=len(rows);w=sum(x["net_pct_30bps"]>0 for x in rows)
 return {"n":n,"wins30":w,"wr30pct":round(100*w/n,2) if n else None,
   "wins10":sum(x["net_pct_10bps"]>0 for x in rows),
   "wr10pct":round(100*sum(x["net_pct_10bps"]>0 for x in rows)/n,2) if n else None,
   "mean30pct":round(statistics.mean(x["net_pct_30bps"] for x in rows),4) if n else None,
   "mean10pct":round(statistics.mean(x["net_pct_10bps"] for x in rows),4) if n else None,
   "stops":sum(x["exit_reason"]=="HARD_STOP_PROXY" for x in rows)}
agg=[]
for route in ("SHORT_V20","RECOVERY_V8","LONG_V64","ALL"):
 for hours in (24,48,72,120):
  for source in ("H1_native_open","M5_public_open","M5_after_confirm"):
   for gate in ("all","prior_frozen_gate","strict_price_parity","frozen_and_strict"):
    sub=[x for x in results if (route=="ALL" or x["route"]==route) and
         x["horizon_hours"]==hours and x["entry_source"]==source and
         (gate not in ("prior_frozen_gate","frozen_and_strict") or x["prior_frozen_gate_pass"]) and
         (gate not in ("strict_price_parity","frozen_and_strict") or x["entry_price_parity_5bps"])]
    if not sub:continue
    agg.append({"route":route,"horizon_hours":hours,"price_source":source,"gate":gate,**stats(sub)})
    if route in ("SHORT_V20","RECOVERY_V8") and hours in (48,72):
     print("FORWARD_COARSE",route,hours,source,gate,stats(sub),flush=True)

def csvsave(f,rows):
 if not rows:return
 keys=list(dict.fromkeys(k for row in rows for k in row))
 with (OUT/f).open("w",encoding="utf-8-sig",newline="") as fd:
  w=csv.DictWriter(fd,keys);w.writeheader()
  for row in rows:
   w.writerow({k:json.dumps(v,ensure_ascii=False) if isinstance(v,(dict,list)) else v for k,v in row.items()})
csvsave("PENGU_FORWARD_20261001_20261118_ENTRY_M5_AUDIT.csv",features)
csvsave("PENGU_FORWARD_20261001_20261118_M5_STOP_PRICE_REPLAY.csv",results)
csvsave("PENGU_FORWARD_20261001_20261118_POLICY_AGGREGATES.csv",agg)
output={"schema":"disdex-prism-pengu-forward-validation/v1","period":["2026-10-01T00:00:00Z","2026-11-18T00:00:00Z"],
 "source_sha256":{"original_116_source_parity":"exact_116_116","new_public_m5_gzip_sha256":{s:obj["sha256"] for s,obj in data.items()}},
 "candidate_count":len(signals),"route_counts":dict(Counter(s["route"] for s in signals)),
 "H1_M5_disparity_over_5bps":sum(not x["entry_price_parity_5bps"] for x in features),
 "orig_pinned_parity":PINNED["eligible_for_forward"],"all_policy_aggregates":agg,
 "limitations":[
 "All forward signals generated from pinned runtime entry source; no production order executions confirmed",
 "Synthetic future fixed-time market exit and first STOP; DOES NOT implement actual PENGU trailing/partial defense/3h/8h rules",
 "Original 116 signal set was used for initial source reproduction; held-out Oct-Nov 2026 data were not used to retune these frozen gates",
 "Public H1 and M5 entry opening can disagree; strict price parity flag uses max 5bps",
 "All profit is price PnL less roundtrip 10/30bps; no funding, shared risk or Gross portfolio replay",
 "Tiny 11-signal sample (7 Short V20, 4 Recovery V8), no 80% skill claim possible",
 "H48 unaffected; PENGU source route unchanged; tests send no orders"] }
(OUT/"PENGU_FORWARD_20261001_20261118_REPORT.json").write_text(
 json.dumps(output,ensure_ascii=False,indent=2,sort_keys=True,allow_nan=False)+"\n",encoding="utf8")
print("FORWARD_VALIDATION_PASS",json.dumps({"signals":len(signals),"entry_parity_disparity":output["H1_M5_disparity_over_5bps"],
 "evaluated_models":len(results),"groups":len(agg)},ensure_ascii=False),flush=True)
