#!/usr/bin/env python3
"""Research-only causal M5 loss hedge for RESIDUAL AVAXUSDT LONG.
First touch <= -3.5% arms 2h. At maturity, close <= -3.5% exits next M5 open.
A -5% intrabar low always hard-stops first, at floor or worse opening gap.
Bar event timestamp is M5 completion for the historical engine; LIVE needs venue native STOP.
"""
from __future__ import annotations
import bisect,math
M5=300000
HOUR=3600000
SOFT_TOUCH_PCT=-3.5
HARD_STOP_PCT=-5.0
SOFT_WATCH_MS=2*HOUR
def find_risk_exit(row,source,obs=None, *, enable_watch=True, enable_hard=True):
 assert row.get("strategy_id")=="RESIDUAL"
 assert row.get("symbol")=="AVAXUSDT" and row.get("side")=="LONG"
 entry=float(row["entry_price"])
 t0=int(row["entry_ts_ms"]);oldexit=int(row["exit_ts_ms"])
 assert entry>0 and oldexit>t0
 bars,times=source.getdata("AVAXUSDT")
 ix=bisect.bisect_left(times,t0)
 if ix>=len(times) or times[ix]!=t0:
  raise RuntimeError(("M5_ENTRY_BAR_UNAVAILABLE",t0))
 base=float(bars[ix][1])
 if base<=0 or not math.isfinite(base):
  raise RuntimeError(("M5_ENTRY_INVALID_SOURCE_PRICE",base,entry))
 anchor_deviation=100*(base/entry-1)
 # Existing H1 research entry can deviate >2.5% from M5 opening spot.
 # Rescale M5 to H1 research entry ONLY for model sensitivity, never certify venue parity.
 if abs(anchor_deviation)>6.0:
  raise RuntimeError(("M5_ENTRY_BASE_PRICE_MISMATCH",base,entry,anchor_deviation))
 if obs is not None:
  if abs(anchor_deviation)>2.5:obs["m5AnchorMismatchOver2P5"]+=1
  obs["m5MaxAnchorMismatchPct"]=max(abs(anchor_deviation),obs.get("m5MaxAnchorMismatchPct",0.))
 scale=entry/base
 touch_ms=None
 for j in range(ix,len(times)):
  candle=bars[j];timestamp=int(candle[0]);complete=timestamp+M5
  if complete>=oldexit:break
  if j>ix and timestamp!=int(times[j-1])+M5:
   raise RuntimeError(("M5_INTERNAL_DATA_GAP",int(times[j-1]),timestamp))
  if j+1>=len(times) or int(times[j+1])!=complete:
   raise RuntimeError(("M5_NEXT_OPEN_MISSING",complete))
  op=float(candle[1])*scale;low=float(candle[3])*scale;close=float(candle[4])*scale
  if not all(math.isfinite(v) and v>0 for v in (op,low,close)):
   raise RuntimeError(("M5_INVALID_PRICE",timestamp))
  low_pct=100*(low/entry-1)
  if enable_hard and low_pct<=HARD_STOP_PCT+1e-10:
   px=min(entry*(1+HARD_STOP_PCT/100),op)
   return {"ts":complete,"fill":px,"trigger":"HARD_MINUS5_ANY_TOUCH",
      "touchTsMs":touch_ms,"watchDeadlineMs":None if touch_ms is None else touch_ms+SOFT_WATCH_MS,
      "lowRetPct":low_pct,"closeRetPct":100*(close/entry-1),
      "fillRetPct":100*(px/entry-1),"priceBasis":"intrabar low trigger; worse-of stop and opening gap"}
  if enable_watch and touch_ms is not None and complete>=touch_ms+SOFT_WATCH_MS:
   if close<=entry*(1+SOFT_TOUCH_PCT/100)+1e-10:
    nextop=float(bars[j+1][1])*scale
    if not math.isfinite(nextop) or nextop<=0:
     raise RuntimeError(("M5_INVALID_NEXT_OPEN",complete))
    return {"ts":complete,"fill":nextop,"trigger":"SOFT_MINUS3P5_WATCH2H",
      "touchTsMs":touch_ms,"watchDeadlineMs":touch_ms+SOFT_WATCH_MS,
      "lowRetPct":low_pct,"closeRetPct":100*(close/entry-1),
      "fillRetPct":100*(nextop/entry-1),"priceBasis":"two-hour deadline close; next M5 open"}
   touch_ms=None
  if enable_watch and touch_ms is None and low<=entry*(1+SOFT_TOUCH_PCT/100)+1e-10:
   touch_ms=complete
 return None
