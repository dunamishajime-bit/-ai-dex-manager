#!/usr/bin/env python3
"""Idle Priority SHORT post-HYPE adopted dual exits: native accepted 5m path evidence.
No trade pruning or allocation claims. No Production/LIVE changes.
"""
from __future__ import annotations
import bisect,collections,hashlib,importlib.util,json,math,statistics,sys
from pathlib import Path

HERE=Path(__file__).resolve().parent
ROOT=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-22_hype_entry_plus_exit_full8")
ADOPT=ROOT/"adopted_3p1p5_plus_1h_initial"
OUT=ROOT/"idle_short_after_hype_adopted"
OUT.mkdir(parents=True,exist_ok=True)
spec=importlib.util.spec_from_file_location("idle_short_task9_engine",HERE/"task9_initial_adverse_stop_20261020.py")
assert spec and spec.loader
core=importlib.util.module_from_spec(spec);spec.loader.exec_module(core)
M5=300000;HOUR=3600000

CASES={
 "EARLY_1H_1P0_MFE0P3":{"type":"initial","h":1,"stopPct":1.0,"peakLessPct":0.3},
 "EARLY_1H_1P5_MFE0P5":{"type":"initial","h":1,"stopPct":1.5,"peakLessPct":0.5},
 "EARLY_2H_2P0_MFE0P5":{"type":"initial","h":2,"stopPct":2.0,"peakLessPct":0.5},
 "PROFIT_2P0_FLOOR0P5":{"type":"profit","armPct":2.0,"floorPct":0.5},
 "PROFIT_3P0_FLOOR1P5":{"type":"profit","armPct":3.0,"floorPct":1.5},
 "PROFIT_4P0_FLOOR2P0":{"type":"profit","armPct":4.0,"floorPct":2.0},
}

def jsonl(path):
 with Path(path).open(encoding="utf-8") as f:return [json.loads(line) for line in f if line.strip()]

def accepted_trades(cost):
 anchor=json.loads((ADOPT/"HYPE_GATED_PROTECTION_FULL8_20261022.json").read_text(encoding="utf-8"))
 rec=anchor["results"]["COMBO_I1H1_P3F1P5"]["costs"][str(cost)]
 ix=rec["replayPasses"][-1]["iteration"]
 label=f"HYPE_GATED_PROTECTION_COMBO_I1H1_P3F1P5_C{cost}_I{ix}"
 slug="cmp_"+hashlib.sha256(label.encode("utf-8")).hexdigest()[:12]
 p=ADOPT/"engine"/slug/slug/f"{cost}bps"/"cases"/"V2_M150_D05_CORE_NATIVE"/"runs"/f"PRICE_MODEL_{cost}BPS"/"portfolio-trades.jsonl"
 assert p.is_file(),p
 all_rows=jsonl(p)
 idle=[r for r in all_rows if r.get("strategy_id")=="IDLE" and r.get("side")=="SHORT"]
 assert len(idle)>50
 return idle,p,rec

def study_one(row,source):
 entry=float(row["entry_price"]);start=int(row["entry_ts_ms"]);end=int(row["exit_ts_ms"])
 symbol=str(row["symbol"])
 if entry<=0 or start>=end:return {"status":"BAD_ENTRY"}
 bars,times=source.getdata(symbol)
 st=bisect.bisect_left(times,start);ed=bisect.bisect_left(times,end)
 if st>=len(bars) or st>=ed or times[st]>start+M5:return {"status":"WINDOW_MISSING"}
 anchor=float(bars[st][1])
 if not math.isfinite(anchor) or anchor<=0 or abs(anchor/entry-1)>.025:
  return {"status":"ENTRY_PRICE_MISMATCH","anchorPrice":anchor,"entryPrice":entry}
 scale=entry/anchor;peak=0.;adverse=0.;armed={};trigger={}
 for i in range(st,ed):
  ts,op,high,low,close,_=bars[i]
  if i>st and ts-bars[i-1][0]!=M5:return {"status":"INTERNAL_5M_GAP"}
  op=float(op)*scale;high=float(high)*scale;low=float(low)*scale;close=float(close)*scale
  if not (op>0 and high>0 and low>0 and close>0):
   return {"status":"INVALID_PRICE"}
  for name,rule in CASES.items():
   if name in trigger:continue
   if rule["type"]=="initial":
    if ts>=start+rule["h"]*HOUR and peak<rule["peakLessPct"] and (op>=entry*(1+rule["stopPct"]/100) or high>=entry*(1+rule["stopPct"]/100)):
     trigger[name]={"ts":int(ts+M5),"rawFill":max(op,entry*(1+rule["stopPct"]/100)),"priorPeakPct":peak}
   elif armed.get(name) and (op>=entry*(1-rule["floorPct"]/100) or high>=entry*(1-rule["floorPct"]/100)):
    trigger[name]={"ts":int(ts+M5),"rawFill":max(op,entry*(1-rule["floorPct"]/100)),"priorPeakPct":peak}
  peak=max(peak,max(0.,(entry-low)/entry*100))
  adverse=max(adverse,max(0.,(high-entry)/entry*100))
  # Completed M5 close is the only arming evidence for SHORT profit protection.
  for name,rule in CASES.items():
   if rule["type"]=="profit" and close<=entry*(1-rule["armPct"]/100):
    armed[name]=True
 return {"status":"OK","candidate":row.get("candidate_id"),"symbol":symbol,"route":row.get("route"),
         "exitReason":row.get("exit_reason_actual"),"pnlJpy":float(row["modeled_realized_pnl_jpy_at_exit_fx"]),
         "win":float(row["modeled_realized_pnl_jpy_at_exit_fx"])>0,
         "holdHours":(end-start)/HOUR,"mfePct":peak,"maePct":adverse,
         "triggers":trigger}

def stats(rows):
 wins=[r for r in rows if r["win"]]
 losses=[r for r in rows if not r["win"]]
 return {
  "trades":len(rows),"wins":len(wins),"losses":len(losses),
  "winRatePct":round(100*len(wins)/len(rows),4) if rows else None,
  "pnlJpy":sum(r["pnlJpy"] for r in rows),
  "loserPnlJpy":sum(r["pnlJpy"] for r in losses),
  "medianMfePct":statistics.median(r["mfePct"] for r in rows) if rows else None,
  "medianMaePct":statistics.median(r["maePct"] for r in rows) if rows else None,
  "medianHoldH":statistics.median(r["holdHours"] for r in rows) if rows else None,
  "exitReasons":dict(collections.Counter(r["exitReason"] for r in rows))
 }

def main():
 source,_=core.task8.legacy.bootstrap()
 report={"status":"IDLE_SHORT_PRICE_PATH_RESEARCH_NOT_CUMULATIVE_ECONOMIC_BT",
   "sourceHypePolicy":"HYPE_BTC3H_LE0P6_REL3H_GE2P0_AND_COMBO_I1H1_P3F1P5",
   "period":"2025-08-10..2026-08-10","costs":{},
   "liveOrProductionChanged":False}
 for cost in (10,30):
  trades,p,rec=accepted_trades(cost)
  paths=[study_one(t,source) for t in trades]
  warnings=collections.Counter(x["status"] for x in paths)
  if warnings!={"OK":len(trades)}:print("SOURCE_WARN",cost,dict(warnings),flush=True)
  valid=[r for r in paths if r["status"]=="OK"]
  grouped={}
  for symbol in sorted({r["symbol"] for r in valid}):
   symrows=[r for r in valid if r["symbol"]==symbol]
   case_hit={}
   for case in CASES:
    subset=[r for r in symrows if case in r["triggers"]]
    case_hit[case]={"hitTrades":len(subset),"oldWinners":sum(r["win"] for r in subset),
                     "oldLosers":sum(not r["win"] for r in subset),
                     "oldWinnerPnlJpy":sum(r["pnlJpy"] for r in subset if r["win"]),
                     "oldLoserPnlJpy":sum(r["pnlJpy"] for r in subset if not r["win"])}
   grouped[symbol]={"baseline":stats(symrows),"cases":case_hit}
   print("SYMBOL",cost,symbol,"N",len(symrows),"W",sum(r["win"] for r in symrows),
         "PNL",round(sum(r["pnlJpy"] for r in symrows)),
         "EARLY1H",case_hit["EARLY_1H_1P0_MFE0P3"],
         "PROFIT3",case_hit["PROFIT_3P0_FLOOR1P5"],flush=True)
  data={"totalAcceptedIdleShort":len(trades),"validM5Count":len(valid),"coverage":dict(warnings),
   "baseline":stats(valid),"bySymbol":grouped,"ledger":str(p),
   "sourceHypePortfolioFinalJpy":rec["finalEquityJpy"],
   "evidenceType":"5m path conditional triggers on accepted fixed positions, not fully dynamic portfolio"}
  report["costs"][str(cost)]=data
  (OUT/f"IDLE_SHORT_M5_PATHS_{cost}BPS.jsonl").write_text(
    "\n".join(json.dumps(x,ensure_ascii=False) for x in paths)+"\n",encoding="utf-8")
 (OUT/"IDLE_SHORT_M5_PATH_SCREEN_20261022.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
 print("COMPLETE",json.dumps({k:{"n":v["totalAcceptedIdleShort"],"ok":v["validM5Count"],"wins":v["baseline"]["wins"]} for k,v in report["costs"].items()}),flush=True)
if __name__=="__main__":main()
