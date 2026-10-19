#!/usr/bin/env python3
"""Research-only LONG loss causal pre-entry gate vs size comparison.
Frozen DD1296 accepted trade ledger; archived Aster H1 ONLY as of entry.
No PENGU exit changes and no live system mutations.
"""
from __future__ import annotations
from pathlib import Path
from datetime import datetime, timezone
from collections import defaultdict, Counter
import json, hashlib, statistics, math, itertools

ROOT=Path(__file__).resolve().parents[1]
ARCHIVE=Path(r"C:/tmp/bt-v12-score100-volume080-normalonly-20260928/extracted/bt-v12-score100-volume080-normalonly-20260928/market-Aster-H1-funding-and-manifests/normalized/aster/klines")
INPUT=ROOT/"docs/research/results/dd1296-final-20261005/portfolio-trades.jsonl"
OUTPUT=ROOT/"docs/research/results/long-loss-research-20261019"
HOUR=3_600_000
SPLIT=int(datetime(2026,5,1,tzinfo=timezone.utc).timestamp()*1000)
TARGETS={"V12","Q102","HYPE_LONG","RESIDUAL","FET"}
def h(s):return hashlib.sha256(s.read_bytes()).hexdigest()
def parse_ts(s):return datetime.fromtimestamp(s/1000,timezone.utc).strftime("%Y-%m-%d")
def read():
 a=[json.loads(x) for x in INPUT.read_text("utf8").splitlines() if x.strip()]
 long=[x for x in a if x.get("side")=="LONG" and x.get("strategy_id") in TARGETS]
 syms=sorted({x["symbol"] for x in long}|{"BTCUSDT"})
 candles={}
 for sym in syms:
  p=ARCHIVE/(sym+".jsonl")
  if not p.exists():raise FileNotFoundError(str(p))
  rows=[json.loads(x) for x in p.read_text(encoding="utf8").splitlines() if x.strip()]
  candles[sym]={int(x["event_time_ms"]):x for x in rows}
 return a,long,candles

def close_at(data,ts):
 x=data.get(ts)
 return float(x["close"]) if x and float(x["close"])>0 else None

def features(t,market):
 ts=int(t["entry_ts_ms"]);market_symbol=market[t["symbol"]];btc=market["BTCUSDT"]
 if ts%HOUR:raise RuntimeError("NON_H1_ENTRY "+str(ts))
 def ret(series,h):
  end=close_at(series,ts-HOUR)
  old=close_at(series,ts-(h+1)*HOUR)
  if end is None or old is None:return None
  return end/old-1
 x={"BTC3":ret(btc,3),"BTC6":ret(btc,6),"BTC12":ret(btc,12),"BTC24":ret(btc,24),
    "SYM3":ret(market_symbol,3),"SYM6":ret(market_symbol,6),
    "SYM12":ret(market_symbol,12),"SYM24":ret(market_symbol,24)}
 if x["BTC24"] is not None and x["SYM24"] is not None:x["REL24"]=x["SYM24"]-x["BTC24"]
 else:x["REL24"]=None
 atr=[]
 for i in range(1,15):
  bar=market_symbol.get(ts-i*HOUR)
  prior=close_at(market_symbol,ts-(i+1)*HOUR)
  if not bar or prior is None:break
  atr.append(max(float(bar["high"])-float(bar["low"]),
      abs(float(bar["high"])-prior),abs(float(bar["low"])-prior)))
 price=close_at(market_symbol,ts-HOUR)
 x["ATR14"]=sum(atr)/14/price if len(atr)==14 and price else None
 vol=market_symbol.get(ts-HOUR)
 priorvol=[float(market_symbol[ts-i*HOUR]["quote_volume"]) for i in range(2,74) if ts-i*HOUR in market_symbol]
 mid=statistics.median(priorvol) if len(priorvol)==72 else 0.
 x["VOLUME_RATIO"]=float(vol["quote_volume"])/mid if vol and mid>0 else None
 return x

def stats(rows):
 wins=[r for r in rows if r["ret_per_equity"]>0]
 los=[r for r in rows if r["ret_per_equity"]<0]
 gross_win=sum(r["ret_per_equity"] for r in wins)
 gross_loss=-sum(r["ret_per_equity"] for r in los)
 pnl_usd=sum(r["pnl"] for r in rows)
 return {"count":len(rows),"wins":len(wins),"losses":len(los),
   "win_rate_pct":round(len(wins)/len(rows)*100,4) if rows else None,
   "return_contribution_sum_pp":round(100*(gross_win-gross_loss),4),
   "gross_win_pp":round(100*gross_win,4),"gross_loss_pp":round(100*gross_loss,4),
   "normalized_pf":round(gross_win/gross_loss,4) if gross_loss>0 else None,
   "sum_historical_pnl_units":round(pnl_usd,3)}
def matrix_group(rows,rules):
 output=[]
 for name,func in rules:
  veto=[x for x in rows if func(x)]
  w=[x for x in veto if x["ret_per_equity"]>0]
  l=[x for x in veto if x["ret_per_equity"]<0]
  prf=sum(x["ret_per_equity"] for x in w)
  loss=-sum(x["ret_per_equity"] for x in l)
  output.append({"rule":name,"vetoed":len(veto),"vetoed_wins":len(w),"vetoed_losers":len(l),
      "saved_loss_pp":round(loss*100,4),"forgone_win_pp":round(prf*100,4),
      "net_delta_if_veto_pp":round((loss-prf)*100,4),
      "net_delta_if_halflot_pp":round((loss-prf)*50,4),
      "historical_winner_retained":len([z for z in rows if z["ret_per_equity"]>0])-len(w)})
 return output

def make_rules():
 tests=[]
 for field,limits in [
  ("BTC3",[-.02,-.01,-.005,0]),
  ("BTC6",[-.03,-.02,-.01,0]),
  ("BTC12",[-.04,-.025,-.01,0]),
  ("BTC24",[-.05,-.03,-.015,0]),
  ("SYM6",[-.06,-.03,-.01,0]),
  ("SYM24",[-.10,-.06,-.03,0]),
  ("REL24",[-.06,-.03,-.01,0])
 ]:
  for v in limits:
   tests.append((f"{field}<={v*100:g}%",lambda x,k=field,th=v:x["features"].get(k) is not None and x["features"][k]<=th))
 for v in [.02,.025,.035,.05,.07]:
  tests.append((f"ATR14>={v*100:g}%",lambda x,th=v:x["features"]["ATR14"] is not None and x["features"]["ATR14"]>=th))
 for v in [.8,1.,1.5,2.,3.]:
  tests.append((f"VOLR>={v:g}",lambda x,th=v:x["features"]["VOLUME_RATIO"] is not None and x["features"]["VOLUME_RATIO"]>=th))
 for name,fn in [
   ("BTC6<0 and SYM6<0",lambda z:z["features"].get("BTC6") is not None and z["features"]["BTC6"]<0 and z["features"].get("SYM6") is not None and z["features"]["SYM6"]<0),
   ("BTC24<0 and REL24<0",lambda z:z["features"].get("BTC24") is not None and z["features"]["BTC24"]<0 and z["features"].get("REL24") is not None and z["features"]["REL24"]<0),
   ("BTC6<0 and REL24<0",lambda z:z["features"].get("BTC6") is not None and z["features"]["BTC6"]<0 and z["features"].get("REL24") is not None and z["features"]["REL24"]<0),
   ("BTC6<-1% and SYM6<0",lambda z:z["features"].get("BTC6") is not None and z["features"]["BTC6"]<-.01 and z["features"].get("SYM6") is not None and z["features"]["SYM6"]<0),
   ("REL24<-3% and ATR14>2.5%",lambda z:z["features"].get("REL24") is not None and z["features"]["REL24"]<-.03 and z["features"].get("ATR14") is not None and z["features"]["ATR14"]>.025),
   ("BTC24<-1.5% and REL24<0",lambda z:z["features"].get("BTC24") is not None and z["features"]["BTC24"]<-.015 and z["features"].get("REL24") is not None and z["features"]["REL24"]<0)
 ]:tests.append((name,fn))
 return tests

def go():
 ledger,long,market=read()
 records=[]
 for t in long:
  pnl=float(t["total_pnl_jpy"]);equity=float(t["entry_equity"])
  if not math.isfinite(pnl) or not math.isfinite(equity) or equity<=0:raise ValueError("INVALID_LEDGER_FINANCES")
  features_data=features(t,market)
  records.append({"strategy":t["strategy_id"],"symbol":t["symbol"],"ts":int(t["entry_ts_ms"]),
     "date":parse_ts(int(t["entry_ts_ms"])),"pnl":pnl,"ret_per_equity":pnl/equity,
     "hold_h":(int(t["exit_ts_ms"])-int(t["entry_ts_ms"]))/HOUR,
     "exit_reason":t["exit_reason_actual"],"gross":float(t["accepted_gross"]),
     "features":features_data,"train":int(t["entry_ts_ms"])<SPLIT})
 rules=make_rules()
 report={"status":"FROZEN_ACCEPTED_ONLY__ENTRY_CAUSAL_FEATURES_NO_FULL_REPLAY",
   "ledger_sha256":h(INPUT),"data_market_hashes":{sym:h(ARCHIVE/(sym+".jsonl")) for sym in market},
   "split_utc":"2026-05-01T00:00:00Z","source_trade_count":len(ledger),
   "long_target_count":len(records),"long_target_groups":{},
   "excluded":["PENGU","V52"],"rules_count":len(rules),"rules":[]}
 for group in sorted(TARGETS):
  subset=[x for x in records if x["strategy"]==group]
  train=[x for x in subset if x["train"]]
  hold=[x for x in subset if not x["train"]]
  pre=matrix_group(train,rules);post=matrix_group(hold,rules)
  ranked=[]
  for x,y in zip(pre,post):
   if x["rule"]!=y["rule"]:raise AssertionError("GRID_MISMATCH")
   ranked.append({"rule":x["rule"],"train":x,"holdout":y})
  ranked.sort(key=lambda a:a["train"]["net_delta_if_veto_pp"],reverse=True)
  report["long_target_groups"][group]={
     "all":stats(subset),"train":stats(train),"holdout":stats(hold),
     "feature_completeness":{k:sum(x["features"][k] is not None for x in subset) for k in ["BTC6","BTC24","SYM6","REL24","ATR14","VOLUME_RATIO"]},
     "worst_losers":[{"symbol":x["symbol"],"date":x["date"],"ret_per_equity_pct":round(x["ret_per_equity"]*100,5),"pnl":round(x["pnl"],3),"feature":x["features"],"exit_reason":x["exit_reason"]} for x in sorted(subset,key=lambda x:x["pnl"])[:min(8,len(subset))]],
     "all_ex_ante_threshold_tests":ranked,
     "train_benefit_and_holdout_benefit":[x for x in ranked if x["train"]["net_delta_if_veto_pp"]>0 and x["holdout"]["net_delta_if_veto_pp"]>0 and x["train"]["vetoed_losers"]>=2 and x["holdout"]["vetoed_losers"]>=1],
     "top_training_rules":ranked[:10],
   }
  print("GROUP",group,"ALL",report["long_target_groups"][group]["all"],
       "TRAIN",report["long_target_groups"][group]["train"],
       "HOLD",report["long_target_groups"][group]["holdout"],
       "OOS_POSITIVE",len(report["long_target_groups"][group]["train_benefit_and_holdout_benefit"]))
  for item in ranked[:4]:print(" TOP_TRAIN",item["rule"],"TRAIN",item["train"]["net_delta_if_veto_pp"],"HOLD",item["holdout"]["net_delta_if_veto_pp"],"affected",item["train"]["vetoed"],item["holdout"]["vetoed"])
  for item in report["long_target_groups"][group]["train_benefit_and_holdout_benefit"][:4]:print(" OOSPOS",item["rule"],item["train"]["net_delta_if_veto_pp"],item["holdout"]["net_delta_if_veto_pp"])
 OUTPUT.mkdir(parents=True,exist_ok=True)
 out=OUTPUT/"LONG_CAUSAL_PREENTRY_LOSS_FILTER_GRID_20261019.json"
 out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
 print("SAVED",out,"COUNT",len(records),"RULES",len(rules))
if __name__=="__main__":go()
