#!/usr/bin/env python3
"""Research-only frozen NO_DOGE AVAX M5 exit pre-screen.
No position creation. Closed M5 observations then next M5 OPEN; no anticipatory fills.
Native 8-logic baseline trades pinned to SHA from research 2026-10-23."""
from __future__ import annotations
import argparse,bisect,collections,datetime,hashlib,importlib.util,json,math,statistics
from pathlib import Path
HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
ROOT=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-22_hype_entry_plus_exit_full8")
OUT=REPO/"docs/research/results/residual-composite-20261023"
H=3600000;M5=300000
REF=OUT/"RESIDUAL_FULL8_ABLATION_RESULT_20261023.json"
mod=importlib.util.spec_from_file_location("avax_exits_native_baseline",HERE/"run-v52-correct-stock-tape-full8-after-fet-20261022.py")
native=importlib.util.module_from_spec(mod);mod.loader.exec_module(native)
RULES={
 "BASE_NO_DOGE":{},
 "LOSS_M5_CLOSE2P5":{"kind":"loss","loss":2.5,"after":0},
 "LOSS_M5_CLOSE3":{"kind":"loss","loss":3,"after":0},
 "LOSS_M5_CLOSE4":{"kind":"loss","loss":4,"after":0},
 "LOSS_M5_CLOSE5":{"kind":"loss","loss":5,"after":0},
 "EARLY_1H_LOSS1P5_MFE_LT1":{"kind":"loss","loss":1.5,"after":1,"mfeLt":1},
 "EARLY_1H_LOSS2_MFE_LT1":{"kind":"loss","loss":2,"after":1,"mfeLt":1},
 "EARLY_2H_LOSS2_MFE_LT1":{"kind":"loss","loss":2,"after":2,"mfeLt":1},
 "EARLY_2H_LOSS3_MFE_LT1":{"kind":"loss","loss":3,"after":2,"mfeLt":1},
 "TIME_4H":{"kind":"time","after":4},
 "TIME_6H":{"kind":"time","after":6},
 "TIME_8H":{"kind":"time","after":8},
 "PROFIT_ARM2_FLOOR0P5":{"kind":"floor","arm":2,"floor":.5},
 "PROFIT_ARM2_FLOOR1":{"kind":"floor","arm":2,"floor":1},
 "PROFIT_ARM3_FLOOR1":{"kind":"floor","arm":3,"floor":1},
 "PROFIT_ARM3_FLOOR1P5":{"kind":"floor","arm":3,"floor":1.5},
 "PROFIT_ARM4_FLOOR2":{"kind":"floor","arm":4,"floor":2},
 "TRAIL_ARM3_GIVE1P5":{"kind":"trail","arm":3,"give":1.5},
 "TRAIL_ARM2_GIVE1P5":{"kind":"trail","arm":2,"give":1.5},
 "COMBO_LOSS3_PROFIT2":{"kind":"combo","parts":["LOSS_M5_CLOSE3","PROFIT_ARM2_FLOOR0P5"]},
 "COMBO_EARLY2H2_PROFIT2":{"kind":"combo","parts":["EARLY_2H_LOSS2_MFE_LT1","PROFIT_ARM2_FLOOR0P5"]},
 "COMBO_EARLY1H2_PROFIT3":{"kind":"combo","parts":["EARLY_1H_LOSS2_MFE_LT1","PROFIT_ARM3_FLOOR1"]},
 "COMBO_LOSS4_TRAIL3":{"kind":"combo","parts":["LOSS_M5_CLOSE4","TRAIL_ARM3_GIVE1P5"]},
 "COMBO_LOSS3_TIME6":{"kind":"combo","parts":["LOSS_M5_CLOSE3","TIME_6H"]},
 "COMBO_EARLY2H3_TIME8":{"kind":"combo","parts":["EARLY_2H_LOSS3_MFE_LT1","TIME_8H"]},
 "COMBO_LOSS4_TIME8":{"kind":"combo","parts":["LOSS_M5_CLOSE4","TIME_8H"]},
 "COMBO_TIME6_TRAIL3_GIVE1P5":{"kind":"combo","parts":["TIME_6H","TRAIL_ARM3_GIVE1P5"]},
}
def sha(path):
 h=hashlib.sha256()
 with Path(path).open("rb") as f:
  for b in iter(lambda:f.read(1<<20),b""):h.update(b)
 return h.hexdigest()
def load_baseline(cost):
 j=json.loads(REF.read_text("utf-8"))["cases"]["NO_DOGE"][str(cost)]
 stamp=j["ledgerSha256"]
 root=ROOT/"f8_residual_ablation_20261023"/"engine"
 paths=[p for p in root.rglob("portfolio-trades.jsonl") if sha(p)==stamp]
 assert len(paths)>=1,("BASELINE_LEDGER_NOT_FOUND",cost,len(paths))
 rows=native.m.jsonl(sorted(paths,key=str)[0])
 sub=[r for r in rows if r.get("strategy_id")=="RESIDUAL" and r.get("symbol")=="AVAXUSDT"]
 assert len(sub)==15 and all(r["side"]=="LONG" for r in sub)
 assert j["residualDoge"]==0 and j["residualAvax"]==15
 return sub
def _find_exit(row,policy,source,obs=None):
 if not policy or policy=="BASE_NO_DOGE":return None
 assert row["strategy_id"]=="RESIDUAL" and row["symbol"]=="AVAXUSDT" and row["side"]=="LONG"
 entry=float(row["entry_price"]);t0=int(row["entry_ts_ms"]);oldexit=int(row["exit_ts_ms"])
 bars,times=source.getdata(row["symbol"])
 lo=bisect.bisect_left(times,t0);hi=bisect.bisect_left(times,oldexit)
 if lo>=hi or lo>=len(bars) or times[lo]!=t0:
  if obs is not None:obs["timestamp_mismatch"]+=1
  return None
 origin=float(bars[lo][1])
 if origin<=0 or abs(origin/entry-1)>.025:
  if obs is not None:obs["price_mismatch"]+=1
  return None
 scale=entry/origin
 max_high_previous=0.;armed={}
 terms=RULES[policy]["parts"] if RULES[policy].get("kind")=="combo" else [policy]
 for term in terms:
  config=RULES[term]
  if config["kind"] in ("floor","trail"):armed[term]=False
 for j in range(lo,hi):
  ts,op,hi_p,lo_p,close,vol=bars[j]
  if j>lo and ts!=times[j-1]+M5:
   if obs is not None:obs["internal_gap"]+=1
   return None
  completed=int(ts)+M5
  if j+1>=len(times) or times[j+1]!=completed:
   if obs is not None:obs["next_open_missing"]+=1
   return None
  if completed>=oldexit:break
  cl=float(close)*scale
  low=float(lo_p)*scale
  high=float(hi_p)*scale
  ret_cl=100*(cl/entry-1)
  curr_high=100*(high/entry-1)
  hit=[]
  for priority,term in enumerate(terms):
   rule=RULES[term];kind=rule["kind"];trigger=False
   if kind=="loss":
    if completed>=t0+float(rule["after"])*H and ret_cl<=-float(rule["loss"]) and max_high_previous<float(rule.get("mfeLt",1e20)):
     trigger=True
   elif kind=="time":
    trigger=completed>=t0+float(rule["after"])*H
   elif kind=="floor":
    if armed[term] and low<=entry*(1+float(rule["floor"])/100):trigger=True
   elif kind=="trail":
    if armed[term] and max_high_previous>=float(rule["arm"]) and 100*(low/entry-1)<=max_high_previous-float(rule["give"]):
     trigger=True
   else:raise ValueError(kind)
   if trigger:hit.append((priority,term,kind))
  if hit:
   _,term,kind=hit[0]
   px=float(bars[j+1][1])*scale
   assert px>0 and completed<oldexit
   return {"ts":int(completed),"fill":px,"kind":kind,"trigger":term,
      "completedM5":int(ts),"priceDeltaVsBaselinePctOfEntry":100*(px-float(row["exit_price"]))/entry,
      "mfeBefore":max_high_previous,"closeRet":ret_cl}
  for term in terms:
   rule=RULES[term];kind=rule["kind"]
   if kind=="floor" and ret_cl>=float(rule["arm"]):armed[term]=True
   elif kind=="trail" and ret_cl>=float(rule["arm"]):armed[term]=True
  max_high_previous=max(max_high_previous,curr_high)
 return None
def bench(rows,source,cost):
 samples={key:{"events":[],"diagnostics":collections.Counter()} for key in RULES}
 for row in rows:
  for key in RULES:
   rec=_find_exit(row,key,source,samples[key]["diagnostics"])
   if rec is None:continue
   before=float(row["exit_price"])/float(row["entry_price"])-1
   after=rec["fill"]/float(row["entry_price"])-1
   pnl=float(row["modeled_realized_pnl_jpy_at_exit_fx"])
   event={"id":row["candidate_id"],"entryTs":row["entry_ts_ms"],"baselineExitTs":row["exit_ts_ms"],
     "newExitTs":rec["ts"],"oldExit":row["exit_price"],"newExit":rec["fill"],
     "oldPct":before*100,"newPct":after*100,
     "oldModelPnlJpy":pnl,"oldModelWin":pnl>0,
     "deltaGrossPctPoints":(after-before)*100,"trigger":rec["trigger"],
     "newApproxWin":after*100-cost/100>0,
     "earlyByHours":(int(row["exit_ts_ms"])-rec["ts"])/H}
   samples[key]["events"].append(event)
 summaries={}
 for name,row in samples.items():
  events=row["events"]
  summaries[name]={"changed":len(events),
     "better":sum(v["deltaGrossPctPoints"]>0 for v in events),
     "worse":sum(v["deltaGrossPctPoints"]<0 for v in events),
     "changedOriginalWinners":sum(v["oldModelWin"] for v in events),
     "changedOriginalLosers":sum(not v["oldModelWin"] for v in events),
     "deltaUnitGrossPctSum":sum(v["deltaGrossPctPoints"] for v in events),
     "baselineModelWins":sum(float(r["modeled_realized_pnl_jpy_at_exit_fx"])>0 for r in rows),
     "diagnostics":dict(row["diagnostics"]),
     "events":events}
 return summaries
def main():
 OUT.mkdir(parents=True,exist_ok=True)
 native.m.acquire_verified_h1()
 source,_=native.m.m.core.task8.legacy.bootstrap()
 out={"status":"RESEARCH_AVAX_AFTER_NO_DOGE_EXIT_SCREEN_ONLY_NOT_INTEGRATED",
  "baselineRef":str(REF.relative_to(REPO)),"sources":"market M5 verified, entry and exit are native H1 model rows",
  "ruleDefinitions":RULES,"costs":{},
  "limitations":["15 integrated AVAX accepted trades only; original candidates may be incomplete",
    "Screen frozen base fills only, DOES NOT dynamically reselect after early exit",
    "Exit trigger from M5 completed bar/wick after previous arm; next M5 open provisional only",
    "No raw cost included in exit price. Portfolio engine must charge costs in full8 replay",
    "Cannot assume true venue precision, active orders, slippage or liquidity"]}
 for cost in (10,30):
  rows=load_baseline(cost)
  out["costs"][str(cost)]=bench(rows,source,cost)
  rankings=sorted(((name,round(z["deltaUnitGrossPctSum"],3),z["changed"],z["better"],z["worse"],
                z["changedOriginalWinners"]) for name,z in out["costs"][str(cost)].items() if name!="BASE_NO_DOGE"),
                key=lambda x:(-x[1],x[4]))
  print("AVAX_EXIT_SCREEN",cost,"TOP",rankings[:20],flush=True)
  print("BOTTOM",rankings[-5:],flush=True)
 (OUT/"RESIDUAL_AVAX_NO_DOGE_EXIT_SCREEN_20261023.json").write_text(
  json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf-8",newline="\n")
 print("SCREEN_DONE_RULES",len(RULES),flush=True)
if __name__=="__main__":main()
