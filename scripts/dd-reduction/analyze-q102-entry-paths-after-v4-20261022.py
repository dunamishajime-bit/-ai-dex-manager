#!/usr/bin/env python3
"""Q102 M5 trade-path decomposition AFTER accepted V4 four-rule 8-logic reference.
No trade modification here. Reports historical losers and winners separately.
Source candles are normalized to original Q102 trade average entry only where
the initial 5m open is within 2.5%; gaps fail closed.
"""
from __future__ import annotations
import sys,json,bisect,math,statistics,collections,hashlib
from pathlib import Path
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
import task9_initial_adverse_stop_20261020 as core
ROOT=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research")
BASE=ROOT/"2026-10-21_v4_locked_next_q102_cumulative"
OUT=ROOT/"2026-10-22_q102_entry_path_decomposition"
M5=300000;H=3600000
ARMS=(.015,.02,.03,.04,.05,.07,.10)
FLOORS=(-.01,0.,.005,.01,.02,.03,.05)
EARLY=((3,.015,.005),(6,.02,.005),(6,.025,.005),(12,.025,.01),(12,.03,.01),(24,.03,.01))
def ledger(bps):
 f=sorted([x for x in BASE.rglob("portfolio-trades.jsonl") if x.parent.name==f"PRICE_MODEL_{bps}BPS"],key=lambda x:x.stat().st_mtime)
 assert len(f)==3,(bps,len(f))
 return [json.loads(s) for s in f[-1].read_text("utf8").splitlines() if s.strip()]
def first_stop(side,entry,side_peak,prices,ts,entry_ts,original_exit):
 pass
def eligible_source(source,row):
 entry=float(row["entry_price"]);st0=int(row["entry_ts_ms"]);ex=int(row["exit_ts_ms"])
 bars,times=source.getdata(str(row["symbol"]))
 st=bisect.bisect_left(times,st0);end=bisect.bisect_left(times,ex)
 if st>=len(bars) or st>=end or times[st]>st0+M5:return None,"ENTRY_GAP"
 o=float(bars[st][1])
 if abs(o/entry-1)>.025:return None,"ENTRY_ANCHOR_MISMATCH"
 b=bars[st:end]
 if any(b[i][0]-b[i-1][0]!=M5 for i in range(1,len(b))):return None,"INTERNAL_M5_GAP"
 return [(int(t),float(op)*entry/o,float(hi)*entry/o,float(lo)*entry/o,float(c)*entry/o) for t,op,hi,lo,c,v in b],"OK"
def scan(row,source):
 bars,state=eligible_source(source,row)
 if state!="OK":return {"candidate_id":row.get("candidate_id"),"sourceStatus":state}
 entry=float(row["entry_price"]);side=str(row["side"]);sg=1 if side=="LONG" else -1
 original_win=float(row.get("modeled_realized_pnl_jpy_at_exit_fx") or 0)>0
 reason=str(row.get("exit_reason_actual"))
 p0=int(row["entry_ts_ms"])
 fpeak=0.;adverse=0.;fpeakclose=0.;underwater_bars=0
 peak_index=-1;lowfirst={}
 # Arm state by fully completed prior M5 close, stop subsequent bar only.
 stage={a:False for a in ARMS}
 stop_events={(arm,floor):None for arm in ARMS for floor in FLOORS if arm>floor}
 first_early={(h,stop,mfe):None for h,stop,mfe in EARLY}
 prior_mfe=0.
 time_above_2=None;time_close_2=None;time_mfe3=None
 first_drawdown={}
 max_giveback=0.
 for i,(ts,op,hi,lo,close) in enumerate(bars):
  # prices known at start of this bar only from prior CLOSED completed bars
  adverse_now=(entry-lo)/entry if side=="LONG" else (hi-entry)/entry
  adverse=max(adverse,adverse_now)
  underwater_bars+=int((close-entry)*sg<0)
  for (h,stop,mfe),v in first_early.items():
   if v is None and ts>=p0+h*H and prior_mfe<mfe:
    adverse_stop_price=entry*(1-stop if side=="LONG" else 1+stop)
    if (op<=adverse_stop_price or lo<=adverse_stop_price) if side=="LONG" else (op>=adverse_stop_price or hi>=adverse_stop_price):
     first_early[(h,stop,mfe)]=[ts,h,(op/entry-1)*sg,prior_mfe]
  for arm in ARMS:
   if stage[arm]:
    for floor in FLOORS:
     if arm<=floor or stop_events.get((arm,floor)) is not None:continue
     stpr=entry*(1+floor*sg)
     touched=(op<=stpr or lo<=stpr) if side=="LONG" else (op>=stpr or hi>=stpr)
     if touched:stop_events[(arm,floor)]=[ts,op/entry-1,prior_mfe]
  favorable_price=(hi/entry-1) if side=="LONG" else (1-lo/entry)
  close_gain=(close/entry-1)*sg
  if favorable_price>fpeak:
   fpeak=favorable_price;peak_index=i
  peak=max(0,fpeak)
  fpeakclose=max(fpeakclose,close_gain)
  if time_above_2 is None and favorable_price>=.02:time_above_2=ts
  if time_close_2 is None and close_gain>=.02:time_close_2=ts
  if time_mfe3 is None and favorable_price>=.03:time_mfe3=ts
  max_giveback=max(max_giveback,peak-close_gain)
  for arm in ARMS:
   if close_gain>=arm:stage[arm]=True
  prior_mfe=max(prior_mfe,favorable_price)
 report={
  "id":str(row.get("candidate_id")),"symbol":str(row["symbol"]),"family":str(row.get("family")),
  "side":side,"entryTsMs":p0,"exitTsMs":int(row["exit_ts_ms"]),
  "durationHours":(int(row["exit_ts_ms"])-p0)/H,
  "entry":entry,"exit":float(row["exit_price"]),"oldReason":reason,
  "oldRealizedPnlJpy":float(row.get("modeled_realized_pnl_jpy_at_exit_fx") or 0),
  "oldWin":original_win,"sourceStatus":"OK","m5Bars":len(bars),
  "peakFavorableHighLowPct":fpeak*100,
  "maxFavorableClosePct":fpeakclose*100,
  "maxAdverseHighLowPct":adverse*100,
  "maxGivebackFromHighLowPct":max_giveback*100,
  "underwaterCloseFrac":underwater_bars/len(bars),
  "timeToFavorable2IntrabarHours":(time_above_2-p0)/H if time_above_2 is not None else None,
  "timeToFavorable2ConfirmedCloseHours":(time_close_2-p0)/H if time_close_2 is not None else None,
  "firstEarly":{f"{h}h_stop{stop*100:g}_mfeLT{mfe*100:g}":x for (h,stop,mfe),x in first_early.items() if x},
  "firstFloor":{f"arm{arm*100:g}_floor{floor*100:g}":x for (arm,floor),x in stop_events.items() if x}
 }
 return report

def main():
 OUT.mkdir(parents=True,exist_ok=True)
 source,helper=core.task8.legacy.bootstrap()
 output={}
 for cost in (10,30):
  trade_rows=[r for r in ledger(cost) if r.get("strategy_id")=="Q102"]
  all_rows=[scan(r,source) for r in trade_rows]
  counts=collections.Counter(x["sourceStatus"] for x in all_rows)
  ok=[x for x in all_rows if x.get("sourceStatus")=="OK"]
  grouped={}
  for f,s in sorted(set((x["family"],x["side"]) for x in ok)):
   g=[x for x in ok if x["family"]==f and x["side"]==s]
   losers=[x for x in g if not x["oldWin"]];winners=[x for x in g if x["oldWin"]]
   def stats(arr):
    return {
     "n":len(arr),
     "medianMfePct":statistics.median(x["peakFavorableHighLowPct"] for x in arr) if arr else None,
     "medianMfeClosePct":statistics.median(x["maxFavorableClosePct"] for x in arr) if arr else None,
     "medianMaePct":statistics.median(x["maxAdverseHighLowPct"] for x in arr) if arr else None,
     "medianHoldHours":statistics.median(x["durationHours"] for x in arr) if arr else None,
     "mfeHighLowAtLeast2":sum(x["peakFavorableHighLowPct"]>=2 for x in arr),
     "mfeCloseAtLeast2":sum(x["maxFavorableClosePct"]>=2 for x in arr),
     "mfeHighLowAtLeast3":sum(x["peakFavorableHighLowPct"]>=3 for x in arr),
     "mfeHighLowAtLeast5":sum(x["peakFavorableHighLowPct"]>=5 for x in arr),
     "maeAtLeast2":sum(x["maxAdverseHighLowPct"]>=2 for x in arr),
     "maeAtLeast3":sum(x["maxAdverseHighLowPct"]>=3 for x in arr),
     "maeAtLeast5":sum(x["maxAdverseHighLowPct"]>=5 for x in arr),
     "oldPnlJpySum":sum(x["oldRealizedPnlJpy"] for x in arr),
    }
   grouped[f"{f}/{s}"]={"all":stats(g),"losers":stats(losers),"winners":stats(winners),
     "guardExitCounts":{key:{"losers":sum(key in x["firstFloor"] for x in losers),
                              "winners":sum(key in x["firstFloor"] for x in winners)} for key in ("arm2_floor0.5","arm3_floor1","arm5_floor2")},
     "earlyExitCounts":{key:{"losers":sum(key in x["firstEarly"] for x in losers),
                              "winners":sum(key in x["firstEarly"] for x in winners)} for key in ("3h_stop1.5_mfeLT0.5","6h_stop2_mfeLT0.5","6h_stop2.5_mfeLT0.5","12h_stop2.5_mfeLT1","12h_stop3_mfeLT1")}
   }
  output[str(cost)]={"total":len(all_rows),"coverageCounts":counts,"grouped":grouped,
     "mostNegative":sorted([x for x in ok if not x["oldWin"]],key=lambda x:x["oldRealizedPnlJpy"])[:28]}
  (OUT/f"q102-m5-entry-paths-{cost}bps.jsonl").write_text("\n".join(json.dumps(x,ensure_ascii=False) for x in all_rows)+"\n","utf8")
  print("Q102_M5_PATH_ANALYSIS",cost,"N",len(ok),"DATA_GAPS",dict(counts),flush=True)
  for k,v in grouped.items():
   l=v["losers"];w=v["winners"]
   print("FAMILY",k,"LOSSES",l["n"],"WINS",w["n"],
     "LOSS_MFE2_HILO",l["mfeHighLowAtLeast2"],"LOSS_MFE2_CLOSE",l["mfeCloseAtLeast2"],
     "LOSS_MAE3",l["maeAtLeast3"],"WIN_MAE3",w["maeAtLeast3"],
     "EARLY_12_2P5",v["earlyExitCounts"]["12h_stop2.5_mfeLT1"],
     "FLOOR2_0P5",v["guardExitCounts"]["arm2_floor0.5"],flush=True)
 result={"status":"RESEARCH_M5_PATHS_ONLY_AFTER_USER_ADOPTED_V4",
   "sourceHandoffSha":"febb75a511f7be02a40e67ae6c426b0d24feaafb",
   "sourceEngine":"native FULL8 accepted V4, signed venue M5 prices not verified",
   "data":output}
 (OUT/"Q102_M5_FAMILY_SIDE_PATH_SUMMARY_20261022.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n","utf8")
 print("DONE",flush=True)
if __name__=="__main__":main()
