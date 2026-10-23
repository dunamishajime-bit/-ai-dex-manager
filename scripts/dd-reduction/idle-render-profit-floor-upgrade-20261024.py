#!/usr/bin/env python3
"""Research-only RENDER SHORT protective floor upgrade.
Keep original native exit if earlier. Arm on previous *completed* M5 close +1.5%,
and on any later M5 first upward touch of entry-relative +0.5% or +0.75% floor,
model reduce-only stop-market fill at max(bar open, stop) with one cost_bps fill
adjustment, exactly like existing RENDER profit guard baseline.
Does NOT implement a venue order or relax native hard-stop; new event only if earlier.
"""
from __future__ import annotations
import bisect,collections,math
M5=300000
def upgrade(row,source,cost_bps,floor,stats=None):
 if row.get('strategy_id')!='IDLE' or row.get('symbol')!='RENDERUSDT' or row.get('side')!='SHORT':return row
 assert .0025 < floor <= .015,(floor,'FLOOR_BOUNDS')
 entry=float(row['entry_price']);entry_ts=int(row['entry_ts_ms'])
 orig_exit=int(row['exit_ts_ms'])
 if orig_exit<=entry_ts+2*M5:return row
 bars,times=source.getdata('RENDERUSDT')
 start=bisect.bisect_left(times,entry_ts)
 end=bisect.bisect_left(times,orig_exit)
 if start>=len(bars) or start>=end or int(times[start])>entry_ts+M5:
  raise RuntimeError(('RENDER_ENTRY_M5_MISSING',entry_ts,orig_exit))
 anchor=float(bars[start][1])
 if entry<=0 or anchor<=0 or abs(anchor/entry-1)>.025:
  raise RuntimeError(('RENDER_ENTRY_ANCHOR_MISMATCH',entry_ts,entry,anchor))
 scale=entry/anchor
 armed=False
 threshold=entry*(1-floor)
 for i in range(start,end):
  ts,op,high,low,close,_=bars[i]
  if i>start and int(ts)-int(times[i-1])!=M5:
   raise RuntimeError(('RENDER_INTERNAL_M5_GAP',entry_ts,ts))
  o=float(op)*scale;hi=float(high)*scale;c=float(close)*scale
  if armed and (o>=threshold or hi>=threshold):
   fill=max(o,threshold)*(1+float(cost_bps)/10000)
   new_exit=int(ts+M5)
   if new_exit<=orig_exit and fill>0 and math.isfinite(fill):
    if stats is not None:
     stats['triggered']+=1
     stats.setdefault('audit',[]).append({
      'entryTs':entry_ts,'oldExit':orig_exit,'newExit':new_exit,
      'oldPrice':float(row['exit_price']),'newPrice':fill,
      'floor':floor,'oldReason':row.get('exit_reason')})
    return dict(row,exit_ts_ms=new_exit,exit_price=fill,
       unit_price_return=1-fill/entry,
       exit_reason=f'RESEARCH_RENDER_PROFIT_ARM1P5_FLOOR{floor:.5f}')
  # Arm only on completed M5 closing below profit threshold.
  if c<=entry*(1-.015):armed=True
 return row
