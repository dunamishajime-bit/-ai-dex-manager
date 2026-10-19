#!/usr/bin/env python3
"""2026-10-19: canonical H1 Idle SHORT exit research, NO LIVE side effects.

Assumptions: frozen original 61 signals; original archived Aster H1 OHLC
matched exactly to 61 original 24h PnL returns; 10% initial stop, 25% TP;
STOP-first same-H1 ambiguity, STOP ratchets only after COMPLETED H1 candles.
No 5m venue execution, cross-runner re-admission or actual STOP amendment/fills.
"""
from __future__ import annotations
import csv, hashlib, itertools, json, statistics
from pathlib import Path
from collections import defaultdict
from functools import lru_cache
from datetime import datetime, timezone

ROOT=Path(__file__).resolve().parents[1]
DATA=Path(r"C:/tmp/bt-v12-score100-volume080-normalonly-20260928/extracted/bt-v12-score100-volume080-normalonly-20260928/market-Aster-H1-funding-and-manifests/normalized/aster/klines")
HOUR=3600000
HOLDOUT=int(datetime(2026,5,1,tzinfo=timezone.utc).timestamp()*1000)
START_DATE="2025-08-14"
COST_BPS=10

def sha(p):
 return hashlib.sha256(p.read_bytes()).hexdigest()

@lru_cache(maxsize=1)
def load():
 intents=json.loads((ROOT/"research/idle_priority_61_intents.json").read_text())
 returns=json.loads((ROOT/"research/idle_priority_61_target_net.json").read_text())
 fp=ROOT/"research/idle_priority_393_generic_candidate_features.csv"
 with fp.open(encoding="utf-8-sig",newline="") as h:
  header=h.readline()
  if not header.startswith("# source idle_candidate_events.csv"):raise ValueError("feature lineage")
  features={(r["symbol"],int(r["t"])):r for r in csv.DictReader(h)}
 markets={}
 for sym in sorted(set(x["symbol"] for x in intents)):
  p=DATA/(sym+".jsonl")
  if not p.exists():raise FileNotFoundError(str(p))
  rows=[json.loads(line) for line in p.read_text(encoding="utf-8").splitlines() if line.strip()]
  markets[sym]={int(r["event_time_ms"]):r for r in rows}
 result=[]
 for i,(it,target) in enumerate(zip(intents,returns)):
  t=int(it["entry_ts_ms"]);sym=it["symbol"]
  feature=features[(sym,t)]
  bars=[markets[sym].get(t+j*HOUR) for j in range((int(it["exit_ts_ms"])-t)//HOUR+1)]
  if any(x is None for x in bars):raise AssertionError("MISSING_H1_BARS "+sym+" "+str(t))
  p0=float(bars[0]["open"]);p1=float(bars[-1]["open"])
  implied=(p0-p1)/p0-0.001
  if abs(implied-target)>1e-9:raise AssertionError("PRICE_PNL_MISMATCH "+sym+" "+str(t)+" "+str(implied-target))
  result.append({**it,"idx":i,"t":t,"weight":.25 if sym in ("DOTUSDT","RENDERUSDT") else 1.,
   "atr":float(feature["atr_ratio"]),"ret":float(target),"entry":p0,"end":p1,"bars":bars,
   "training":t<HOLDOUT})
 return sorted(result,key=lambda x:(x["t"],x["symbol"]))

def simulate(tr,config,stop_gap=0.):
 """H1 price-path, any bar STOP before TP. Exit at first H1 touch."""
 entry=tr["entry"]; stop=entry*(1+float(config.get("initial_stop",.10)));tp=entry*.75
 m=0.; exit_reason="SCHEDULED_EXIT"; price=tr["end"]; offset=int((tr["exit_ts_ms"]-tr["t"])//HOUR)
 updated=0;max_mfe=0.;max_mae=0.
 activate=float(config.get("activate",999))
 trail=config.get("trail",None)
 lock=config.get("lock",None)
 loss_exit=config.get("loss_at_hour",None)
 for i,bar in enumerate(tr["bars"][:-1]):
  op,hi,lo,cl=(float(bar[k]) for k in ("open","high","low","close"))
  max_mfe=max(max_mfe,(entry-lo)/entry)
  max_mae=max(max_mae,(hi-entry)/entry)
  if (loss_exit is not None and i>=loss_exit[0] and op>=entry*(1+loss_exit[1])):
   price=op;exit_reason="H1_ADVERSE_OPEN";offset=i;break
  if op>=stop:
   price=op*(1+stop_gap);exit_reason="STOP_OPEN_GAP";offset=i;break
  if hi>=stop:
   price=stop*(1+stop_gap);exit_reason="STOP_H1";offset=i;break
  if lo<=tp:
   price=tp;exit_reason="TAKE_PROFIT_H1";offset=i;break
  # Compute trailing update using only closed bar low, effective NEXT H1.
  m=min(m,lo-entry)
  if -m/entry>=activate:
   old=stop
   if lock is not None:stop=min(stop,entry*(1-lock))
   if trail is not None:stop=min(stop,(entry+m)*(1+trail))
   if stop<old-1e-12: updated+=1
 gross=(entry-price)/entry
 net=gross-COST_BPS/10000
 return {"exit_offset_h":offset,"exit_ts_ms":tr["t"]+offset*HOUR,
    "exit_reason":exit_reason,"exit_price":price,"net":net,
    "max_mfe_pct":100*max_mfe,"max_mae_pct":100*max_mae,
    "stop_updated":updated,"stop_at_end":stop,
    "baseline_net":tr["ret"]}

def describe(trades,mode,train_only=None,gap=0.):
 use=[x for x in trades if x["atr"]<=.025 and (train_only is None or x["training"]==train_only)]
 sim=[(x,simulate(x,mode,gap)) for x in use]
 return stat(sim)

def stat(sim):
 vs=[t["weight"]*r["net"] for t,r in sim]
 gp=sum(v for v in vs if v>0);gl=-sum(v for v in vs if v<0)
 base=sum(t["weight"]*t["ret"] for t,r in sim)
 return {"n":len(sim),"wins":sum(v>0 for v in vs),"losses":sum(v<0 for v in vs),
  "gross_weighted_contribution_pct":round(100*sum(vs),4),
  "baseline_frozen_schedule_contribution_pct":round(100*base,4),
  "delta_vs_frozen_schedule_pp":round(100*(sum(vs)-base),4),
  "pf":round(gp/gl,4) if gl>0 else None,
  "losing_contribution_pct":round(100*sum(v for v in vs if v<0),4),
  "winning_contribution_pct":round(100*sum(v for v in vs if v>0),4),
  "exit_reasons":dict(sorted({k:sum(r["exit_reason"]==k for t,r in sim) for k in {r["exit_reason"] for t,r in sim}}.items())),
  "winners_turn_losers":sum(t["ret"]>0 and r["net"]<=0 for t,r in sim),
  "losers_turn_winners":sum(t["ret"]<=0 and r["net"]>0 for t,r in sim),
  "mean_hold_h":round(statistics.mean(r["exit_offset_h"] for _,r in sim),3) if sim else None}

def run():
 ts=load()
 if len(ts)!=61 or sum(x["ret"]>0 for x in ts)!=48:raise AssertionError("fixture")
 filt=[t for t in ts if t["atr"]<=.025]
 out={"status":"CANONICAL_H1_PRICE_PARITY_61_OF_61_BUT_STOP_MODELS_NOT_SIGNED_VENUE",
  "market_source_path":str(DATA),"price_anchor_max_error_bps":max(abs(((t["entry"]-t["end"])/t["entry"]-.001)-t["ret"])*10000 for t in ts),
  "input_hashes":{p:sha(ROOT/p) for p in ("research/idle_priority_61_intents.json","research/idle_priority_61_target_net.json","research/idle_priority_393_generic_candidate_features.csv")},
  "market_source_hashes":{s:sha(DATA/(s+".jsonl")) for s in sorted({t["symbol"] for t in ts})},
  "atr25_holdout_count":sum(not t["training"] for t in filt),
  "configurations":{},"details":{}}
 configs={"SCHEDULED_EXIT":{"activate":999},
          "ORIGINAL_STOP10":{"activate":999}}
 for trigger in (1.5,2.,3.,4.,5.,6.,8.):
  for trailing in (1.0,1.5,2.,2.5,3.,4.,5.):
   configs["TRAIL_"+str(trigger)+"_"+str(trailing)]={"activate":trigger/100,"trail":trailing/100}
  for lock in (.0,.0025,.005,.01):
   configs["LOCK_"+str(trigger)+"_"+str(lock)]={"activate":trigger/100,"lock":lock}
 for hour in (3,6,9,12):
  for adverse in (0.,.005,.01,.015,.02):
   configs["H1_EXIT_"+str(hour)+"_"+str(adverse)]={"activate":999,"loss_at_hour":(hour,adverse)}
 out["configurations"]["FROZEN_SCHEDULE"]={"train":stat([(x,{"net":x["ret"],"exit_reason":"SCHEDULED_EXIT","exit_offset_h":x["hold_h"]}) for x in filt if x["training"]]),
  "holdout":stat([(x,{"net":x["ret"],"exit_reason":"SCHEDULED_EXIT","exit_offset_h":x["hold_h"]}) for x in filt if not x["training"]])}
 for name,cfg in configs.items():
  sim=[(x,simulate(x,cfg,0.)) for x in filt]
  item={"train":stat([(t,r) for t,r in sim if t["training"]]),
        "holdout":stat([(t,r) for t,r in sim if not t["training"]]),
        "all":stat(sim),"params":cfg}
  out["configurations"][name]=item
 # Human readable ranked by training returns then holdout untouched
 ranked=sorted(((name,d) for name,d in out["configurations"].items() if name not in ("FROZEN_SCHEDULE",)),
    key=lambda p:p[1]["train"]["gross_weighted_contribution_pct"],reverse=True)
 out["ranked_by_training"]=[{"name":name,"train":d["train"],"holdout":d["holdout"]} for name,d in ranked[:15]]
 out["ranked_by_holdout_inspection_NOT_SELECTION"]=[{"name":name,"train":d["train"],"holdout":d["holdout"]} for name,d in sorted(((name,d) for name,d in out["configurations"].items() if name!="FROZEN_SCHEDULE"),key=lambda p:p[1]["holdout"]["gross_weighted_contribution_pct"],reverse=True)[:15]]
 baseline=out["configurations"]["FROZEN_SCHEDULE"]
 # Ex ante preselected rules, not data-optimal
 for name in ["ORIGINAL_STOP10","TRAIL_3.0_1.5","TRAIL_4.0_2.0","TRAIL_5.0_2.5","LOCK_3.0_0.0025","LOCK_4.0_0.005","H1_EXIT_6_0.01"]:
  o=out["configurations"][name]
  out["details"][name]={"train_diff_pp":round(o["train"]["gross_weighted_contribution_pct"]-baseline["train"]["gross_weighted_contribution_pct"],4),"holdout_diff_pp":round(o["holdout"]["gross_weighted_contribution_pct"]-baseline["holdout"]["gross_weighted_contribution_pct"],4)}
 # For H1 ambiguity, identify trades with BOTH side thresholds in same H1 under initial 10/25 stop
 return out

def main():
 import argparse
 p=argparse.ArgumentParser()
 p.add_argument("--output",type=Path,default=ROOT/"docs/research/results/idle-short-cluster-20261019/H1_EXIT_CAUSAL_GRID_20261019.json")
 a=p.parse_args();ans=run();a.output.parent.mkdir(parents=True,exist_ok=True)
 a.output.write_text(json.dumps(ans,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
 print(json.dumps({"status":ans["status"],"anchor_diff_bp":ans["price_anchor_max_error_bps"],
                   "heldout":ans["atr25_holdout_count"],"key":ans["details"],
                   "best_train":ans["ranked_by_training"][:8],
                   "best_holdout":ans["ranked_by_holdout_inspection_NOT_SELECTION"][:5]},ensure_ascii=False))

if __name__=="__main__":main()
