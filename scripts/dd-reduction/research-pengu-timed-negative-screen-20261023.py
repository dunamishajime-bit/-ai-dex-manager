#!/usr/bin/env python3
"""PENGU native all8 research: causal M5 time-underwater STOP candidate screening.

No network/production access. Uses saved native full8 selected ledger and verified research M5 source.
Every soft stop is an additional earlier exit, never relaxes existing -8/-6% protections.
"""
from __future__ import annotations
import argparse,bisect,collections,hashlib,importlib.util,json,math
from pathlib import Path
M5=300000; HOUR=3600000
HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
ROOT=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-22_hype_entry_plus_exit_full8")
ANCHOR=ROOT/"rv23penguNative/PENGU_ENTRY_VETO_AFTER_AVAX_FULL8_20261023.json"
def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path)
 assert spec and spec.loader
 m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
 return m
def digest(path):
 h=hashlib.sha256()
 with Path(path).open("rb") as f:
  for c in iter(lambda:f.read(1048576),b""):h.update(c)
 return h.hexdigest()
def getdata(source):
 bars,times=source.getdata("PENGUUSDT")
 return bars,times
def find_time_stop(row, source, settings, *, stats=None):
 assert row["strategy_id"]=="PENGU" and row["symbol"]=="PENGUUSDT"
 mode=settings["mode"]
 if mode=="MULTI_CHECKPOINT":
  checks=settings["checks"]
  assert checks and len(checks)>1 and all(z["mode"] in ("AT_HOURS","SUSTAINED_H1") for z in checks)
  options=[find_time_stop(row,source,z,stats=stats) for z in checks if eligible(row,z)]
  realized=[r for r in options if r is not None]
  return min(realized,key=lambda r:r["ts"]) if realized else None
 hold_h=int(settings["holdHours"])
 assert mode in ("AT_HOURS","SUSTAINED_H1"), mode
 assert hold_h>=2
 loss_pct=float(settings["lossPct"])
 assert loss_pct>0
 mfe_pct=settings.get("maxMfePct")
 if mfe_pct is not None: mfe_pct=float(mfe_pct)
 t0=int(row["entry_ts_ms"]);end=int(row["exit_ts_ms"])
 entry=float(row["entry_price"]);side=row["side"]
 assert side in ("LONG","SHORT")
 entry_version=row.get("entry_version")
 if end<=t0+M5:return None
 bars,times=getdata(source)
 start=bisect.bisect_left(times,t0)
 if start>=len(times) or times[start]!=t0:raise RuntimeError(("PENGU_M5_ENTRY_NOT_COVERED",t0))
 observed_open=float(bars[start][1])
 anchor_gap=100*(entry/observed_open-1)
 if abs(anchor_gap)>5.0:raise RuntimeError(("PENGU_M5_ENTRY_PRICE_MISMATCH_GT5P0_PCT",t0,entry,observed_open,anchor_gap))
 scale=entry/observed_open
 if stats is not None:
  stats["entryAnchors"]+=1
  stats["anchorGapOver05PCT"]+=int(abs(anchor_gap)>.5)
  stats["anchorGapOver1P2PCT"]+=int(abs(anchor_gap)>1.2)
  stats["anchorGapOver2P5PCT"]+=int(abs(anchor_gap)>2.5)
  stats["maxAnchorGapPct"]=max(abs(anchor_gap),stats.get("maxAnchorGapPct",0))
 best_favor=0.0;h1_under=0
 min_adverse=0.
 for j in range(start,len(times)):
  candle=bars[j];t=int(candle[0]);complete=t+M5
  if complete>=end:break
  if j>start and t!=int(times[j-1])+M5:raise RuntimeError(("PENGU_M5_DATA_GAP",times[j-1],t))
  if j+1>=len(times) or times[j+1]!=complete:raise RuntimeError(("PENGU_M5_NEXT_OPEN_GAP",t))
  high=float(candle[2])*scale;low=float(candle[3])*scale;close=float(candle[4])*scale
  op=float(candle[1])*scale
  if not (math.isfinite(high) and math.isfinite(low) and math.isfinite(close) and math.isfinite(op) and min(high,low,close,op)>0):
   raise RuntimeError(("PENGU_INVALID_BAR",t))
  if side=="LONG":
   favorable=100*(high/entry-1)
   change_pct=100*(close/entry-1)
   adverse=100*(low/entry-1)
  else:
   favorable=100*(1-low/entry)
   change_pct=100*(1-close/entry)
   adverse=100*(1-high/entry)
  best_favor=max(best_favor,favorable)
  min_adverse=min(min_adverse,adverse)
  if complete-t0<hold_h*HOUR:continue
  if mode=="AT_HOURS":
   if complete!=t0+hold_h*HOUR:continue
   if change_pct>-loss_pct:continue
  else:
   # Require all of the past holdHours fully closed *hourly* candles to be negative
   # beyond the loss boundary (not necessarily every intervening M5 close).
   if (complete-t0)%HOUR!=0:continue
   h1_under=0
   for h in range(hold_h):
    pastindex=j-h*12
    if pastindex<start or int(bars[pastindex][0])+M5!=complete-h*HOUR:
     raise RuntimeError(("PENGU_H1_CONFIRM_MISSING",t,hold_h,h))
    prevclose=float(bars[pastindex][4])*scale
    pct=100*((prevclose/entry-1) if side=="LONG" else (1-prevclose/entry))
    if pct<=-loss_pct:h1_under+=1
    else:break
   if h1_under<hold_h:continue
  if mfe_pct is not None and best_favor>=mfe_pct:continue
  px=float(bars[j+1][1])*scale
  fillret=100*((px/entry-1) if side=="LONG" else (1-px/entry))
  return {"ts":complete,"fill":px,"reason":"PENGU_TIMED_NEGATIVE_"+mode,
    "entryTs":t0,"entryVersion":entry_version,"side":side,"initialHardStopPct":8 if entry_version!="RECOVERY_V8" else 6,
    "thresholdPct":-loss_pct,"holdHours":hold_h,"mfeGatePct":mfe_pct,
    "mfeAtStopPct":best_favor,"minAdversePct":min_adverse,"closedPriceChangePct":change_pct,
    "modeledExitReturnPct":fillret,"modelAnchorGapPct":anchor_gap}
 return None
def eligible(row,settings):
 if row.get("strategy_id")!="PENGU" or row.get("symbol")!="PENGUUSDT":return False
 scope=settings.get("scope","ALL")
 if scope=="ALL":return True
 if scope=="SHORT":return row.get("side")=="SHORT"
 if scope=="LONG":return row.get("side")=="LONG"
 if scope=="BASE_LONG":return row.get("entry_version")=="LONG_V2_FINAL"
 if scope=="RECOVERY":return row.get("entry_version")=="RECOVERY_V8"
 raise ValueError(scope)
def scan_cases():
 # two model types, timing and loss, no-profit gate combinations, side split and recovery-specific.
 base=[]
 for mode in ("AT_HOURS","SUSTAINED_H1"):
  for h in ((2,3,4,6,8,12) if mode=="AT_HOURS" else (2,3,4)):
   for loss in (1,1.5,2,2.5,3,4):
    for mfe in (None,.5,1.0):
     base.append({"mode":mode,"holdHours":h,"lossPct":loss,"maxMfePct":mfe,"scope":"ALL"})
 return base
def run_screen(output):
 anchor=json.loads(ANCHOR.read_text('utf8'))
 ref=anchor["cases"]["BASE"]["costs"]
 refmod=load("pengu_time_underwater_verified_source",HERE/"research-residual-avax-composite-entry-veto-full8-20261023.py")
 refmod.native.m.acquire_verified_h1()
 source,_=refmod.native.m.m.core.task8.legacy.bootstrap()
 cases=scan_cases()
 assert len(cases)==(6+3)*6*3
 out={"status":"RESEARCH_ONLY_PENGU_TIMED_UNDERWATER_PRESCREEN_NOT_NATIVE_WALLET",
 "purpose":"Shortlist time underwater M5 exits, do not use fixed trade selection as economic BT",
 "costs":{},"rules":cases}
 for cost in ("10","30"):
  sig=ref[cost]["ledgerSha256"]
  files=[p for p in (ROOT/"rv23penguNative/engine").rglob("portfolio-trades.jsonl") if digest(p)==sig]
  assert len(files)>=1,("ANCHOR_LEDGER_MISSING",cost,sig)
  rows=[json.loads(x) for x in files[0].read_text('utf8').splitlines()]
  pengu=[r for r in rows if r["strategy_id"]=="PENGU"]
  assert len(pengu)==67
  # memo M5 threshold path per original selected row and rule
  scored=[]
  for k,settings in enumerate(cases):
   triggered=[]
   for row in pengu:
    candidate=find_time_stop(row,source,settings)
    if candidate:
     triggered.append({"candidate":candidate,"originalWon":row["total_pnl_jpy"]>0,
       "originalPnLJpy":row["modeled_realized_pnl_jpy_at_exit_fx"],"entryTs":row["entry_ts_ms"],
       "origExitTs":row["exit_ts_ms"],"originalExitReason":row["exit_reason_actual"],
       "entryVersion":row["entry_version"],"side":row["side"]})
   lose=[r for r in triggered if not r["originalWon"]]
   win=[r for r in triggered if r["originalWon"]]
   rowresult={"id":k,"settings":settings,"n":len(triggered),"lossN":len(lose),"winN":len(win),
     "lossSavedJpyUpperBound":-sum(float(r["originalPnLJpy"]) for r in lose),
     "lostWinnersJpy":sum(float(r["originalPnLJpy"]) for r in win),
     "triggeredByRoute":dict(collections.Counter(r["side"]+"::"+r["entryVersion"] for r in triggered))}
   scored.append(rowresult)
  combos=[]
  for scope in ("LONG","SHORT","RECOVERY","BASE_LONG"):
   for r in scored:
    # approximate screen: recalc side by matching saved per trade is not held, but identify likely
    if r["n"]==0:continue
    if scope=="LONG" and all(k[0]=="SHORT" for k in r["triggeredByRoute"]):continue
    if scope=="SHORT" and all(k[0]=="LONG" for k in r["triggeredByRoute"]):continue
    combos.append(r)
  scoreboard=sorted(scored,key=lambda r:(-r["lossN"],r["winN"],-r["lossSavedJpyUpperBound"]))
  win_preserving=sorted([r for r in scored if r["winN"]<=2 and r["lossN"]>=1],
    key=lambda r:(-r["lossSavedJpyUpperBound"],-r["lossN"],r["winN"]))
  out["costs"][cost]={"ledgerSha256":sig,"trades":len(pengu),"entriesByRoute":dict(collections.Counter(r["entry_version"] for r in pengu)),
   "rankedByLossCount":scoreboard[:40],"rankedWinPreserving":win_preserving[:70],
   "allRuleOutcomes":scored}
  print("COST",cost,"PENGU_COUNT",len(pengu),"rules",len(scored))
  for r in win_preserving[:25]:
   print("TOP",cost,r["settings"],"HITS",r["n"],"LOSSES",r["lossN"],
    "WINNERS_CUT",r["winN"],"LOSSES_SAVED_JPY_UPPER",round(r["lossSavedJpyUpperBound"]),
    "WINNERS_PNL_RISK",round(r["lostWinnersJpy"]))
  output.mkdir(parents=True,exist_ok=True)
  (output/"PENGU_TIMED_NEGATIVE_PRE_SCREEN_20261023.json").write_text(json.dumps(out,indent=2,ensure_ascii=False)+"\n",encoding="utf8",newline="\n")
 print("SCREEN_COMPLETE")
if __name__=="__main__":
 pa=argparse.ArgumentParser();pa.add_argument("--output",type=Path,required=True)
 args=pa.parse_args()
 run_screen(args.output)
