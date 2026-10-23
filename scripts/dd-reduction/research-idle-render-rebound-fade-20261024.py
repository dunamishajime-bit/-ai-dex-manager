#!/usr/bin/env python3
"""RENDER SHORT: causal price-action rebound->fade entrances.
Features at candidate H1 time are computed from CLOSED prior 5m bars only.
All outcomes and later price bars are exclusively labels in screen, never filters.
Rejected portfolio candidates remain rejected unless full8 native reselection permits them.
"""
from __future__ import annotations
import bisect,importlib.util,math
from pathlib import Path
M5=300000
CACHE={}
def get(source,sym,ts):
 key=(id(source),sym,int(ts))
 if key in CACHE:return CACHE[key]
 bars,times=source.getdata(sym)
 i=bisect.bisect_left(times,int(ts))-1
 if i<84 or int(times[i])+M5>int(ts) or any(int(times[k])-int(times[k-1])!=M5 for k in range(i-83,i+1)):
  CACHE[key]=None;return None
 recent=bars[i-11:i+1]
 prior=bars[i-35:i-11]
 first3=bars[i-35:i+1]
 last3=bars[i-2:i+1]
 last6=bars[i-5:i+1]
 last18=bars[i-17:i+1]
 def last_return(steps):
  close=float(bars[i][4]);old=float(bars[i-steps][4])
  return 100*(close/old-1)
 closing=float(bars[i][4])
 lowprior=min(float(z[3]) for z in prior)
 hrecent=max(float(z[2]) for z in recent)
 h3=max(float(z[2]) for z in first3)
 l3=min(float(z[3]) for z in first3)
 lrecent=min(float(z[3]) for z in recent)
 hlast3=max(float(z[2]) for z in last3)
 if min(lowprior,hrecent,closing,h3,l3,lrecent,hlast3)<=0:return None
 result={
 'ret3h':last_return(36),
 'ret1h':last_return(12),
 'last15':last_return(3),
 'last30':last_return(6),
 'first45':100*(float(bars[i-6][4])/float(bars[i-15][4])-1),
 'rebound2to1':100*(hrecent/lowprior-1),
 'fadefrom1hhigh':100*(hrecent/closing-1),
 'fadefrom3hhigh':100*(h3/closing-1),
 'fadefrom15high':100*(hlast3/closing-1),
 'last1hRangePct':100*(hrecent/lrecent-1),
 'rangepos3h':(closing-l3)/(h3-l3) if h3>l3 else .5,
 'lowprior':lowprior,'highrecent':hrecent
 }
 if not all(isinstance(x,(int,float)) and math.isfinite(x) for x in result.values()):
  CACHE[key]=None;return None
 CACHE[key]=result
 return result
def rule_accept(f,name):
 if f is None:return False
 if name=='BASE':return True
 if name=='BOUNCE_FADE_TIGHT':return f['rebound2to1']>=1 and f['last15']<=-.2 and f['fadefrom1hhigh']>=.4
 if name=='BOUNCE_FADE_MID':return f['rebound2to1']>=.8 and f['last15']<=-.1 and f['fadefrom1hhigh']>=.2
 if name=='BOUNCE_FADE_LIGHT':return f['rebound2to1']>=.5 and f['last15']<=-.05
 if name=='RETRACE_FADE':return f['first45']>=.4 and f['last15']<=-.15 and f['fadefrom1hhigh']>=.25
 if name=='PEAK_RESISTANCE_FADE':return f['fadefrom3hhigh']>=.8 and f['last30']<=-.3 and f['rangepos3h']<=.65
 if name=='VETO_KNIFE_WITHOUT_REBOUND':return not (f['ret3h']< -1.0 and f['rebound2to1']<.8)
 if name=='VETO_KNIFE_WITHOUT_FADE':return not (f['ret3h']<-1.5 and f['last15']>0)
 if name=='VETO_WEAK_REBOUND_LATE_DUMP':return not (f['ret3h']<-1.0 and f['last15']<-.4 and f['rebound2to1']<1.0)
 if name=='VETO_BEAR_CONTINUATION':return not (f['ret3h']<-1.5 and f['rangepos3h']<.2)
 if name=='VETO_BTC_INDEPENDENT_CHASE':return not (f['ret3h']<-2 and f['fadefrom1hhigh']>1.25)
 if name=='VETO_BOUNCE_WITHOUT_TURN':return not (f['rebound2to1']>=1.5 and f['last15']>=.25)
 if name=='VETO_LAST1H_SHARP_DUMP':return f['ret1h']>=-1.5 or f['rebound2to1']>=1.0
 if name=='VETO_3H_CHASE_AND_NO_REBOUND':return f['ret3h']>=-1.5 or f['rebound2to1']>=1.0
 if name=='VETO_LAST30_DUMP_NO_RETRACE':return f['last30']>=-.8 or f['rebound2to1']>=.8
 raise KeyError(name)
NAMES=('BASE','BOUNCE_FADE_TIGHT','BOUNCE_FADE_MID','BOUNCE_FADE_LIGHT',
 'RETRACE_FADE','PEAK_RESISTANCE_FADE','VETO_KNIFE_WITHOUT_REBOUND','VETO_KNIFE_WITHOUT_FADE',
 'VETO_WEAK_REBOUND_LATE_DUMP','VETO_BEAR_CONTINUATION','VETO_BTC_INDEPENDENT_CHASE',
 'VETO_BOUNCE_WITHOUT_TURN','VETO_LAST1H_SHARP_DUMP','VETO_3H_CHASE_AND_NO_REBOUND',
 'VETO_LAST30_DUMP_NO_RETRACE')
