#!/usr/bin/env python3
"""Compare original causal entry unmodified; no 6h-shadow quality gate. Research-only."""
from __future__ import annotations
import bisect,datetime as dt,hashlib,importlib.util,json,math,statistics,collections
from pathlib import Path
ROOT=Path('C:/tmp/render-dual-preflight-native8-20261025')
spec=importlib.util.spec_from_file_location('render_exact_prior',ROOT/'calc_exact_render_m5.py')
e=importlib.util.module_from_spec(spec);spec.loader.exec_module(e)
M=e.M;H=e.H;START=e.START_MS;END=e.END_MS
def exit_model(t,bars,hold_min,tp_pct,stop_pct=2):
 entry=bars[t][1];sl=entry*(1+stop_pct/100);tp=entry*(1-tp_pct/100)
 max_minutes=hold_min if hold_min is not None else 30*24*60
 end=t+max_minutes*60_000
 for bar_ts in range(t,end,M):
  bar=bars.get(bar_ts)
  if bar is None:return None
  _,op,hi,lo,*_=bar
  if hi>=sl:
   px=max(op,sl)
   return dict(entryTs=t,exitTs=bar_ts,entryPrice=entry,exitPrice=px,
    grossPct=100*(1-px/entry),reason='STOP')
  if lo<=tp:
   return dict(entryTs=t,exitTs=bar_ts,entryPrice=entry,exitPrice=tp,
    grossPct=tp_pct,reason='TP')
 if hold_min is None:return None  # no unconditional TIME liquidation permitted in no-time variant
 row=bars.get(end)
 if row is None:return None
 ep=row[1]
 return dict(entryTs=t,exitTs=end,entryPrice=entry,exitPrice=ep,
  grossPct=100*(1-ep/entry),reason='TIME')
def gate_times(r,b):
 start=max(min(r),min(b))+72*H
 stop=min(max(r),max(b))-30*24*H
 raw=[]
 for t in range(((start+H-1)//H)*H,stop,H):
  rb=[r.get(x) for x in range(t-H,t,M)]
  bb=[b.get(x) for x in range(t-H,t,M)]
  h4end=(t//(4*H))*4*H
  h4=[r.get(x) for x in range(h4end-4*H,h4end,M)]
  if any(x is None for x in rb+bb+h4):raise RuntimeError(('GAP',t))
  vol=sum(x[5] for x in rb)
  if vol<=0:continue
  btc=100*(bb[-1][4]/bb[0][1]-1)
  h1=100*(rb[-1][4]/rb[0][1]-1)
  h4ret=100*(h4[-1][4]/h4[0][1]-1)
  sell=(vol-sum(x[6] for x in rb))/vol
  wick=100*(max(x[2] for x in rb)-max(rb[0][1],rb[-1][4]))/rb[0][1]
  if btc>=.15 and h1<=-.5 and h4ret<=-.15 and sell>=.53 and wick>=.35:
   raw.append(t)
 return raw
def stats(trades,cost):
 vals=[x['grossPct']-cost/100 for x in trades]
 q=e.quality(vals);equity=peak=1;min_dd=0
 for x in vals:
  equity*=1+x/100;peak=max(peak,equity);min_dd=min(min_dd,100*(equity/peak-1))
 return {**q,'netTotalPct':round(sum(vals),6),'compoundPct':round(100*(equity-1),6),
         'closedTradeDdPct':round(min_dd,6),'netPerTrade':[round(x,4) for x in vals],
         'stops':sum(t['reason']=='STOP' for t in trades),
         'takeProfits':sum(t['reason']=='TP' for t in trades),
         'timeExits':sum(t['reason']=='TIME' for t in trades)}
def main():
 rr,rm,rmanifest=e.read_series('RENDERUSDT')
 bb,bm,bmanifest=e.read_series('BTCUSDT')
 raw=gate_times(rm,bm)
 annual=[t for t in raw if START<=t<END]
 print('SOURCE_MONTHS',len(rmanifest),len(bmanifest),'RAW_ALL',len(raw),'RAW_12M',len(annual),flush=True)
 holds=[55,120,360,720,1440,None]
 tp_pcts=[1.5,2.,3.]
 cases=[]
 for tp in tp_pcts:
  for hold in holds:
   trades=[];last_entry=None;occupied_until=0;unresolved=[]
   for t in annual:
    if last_entry is not None and t-last_entry<12*H:continue
    if t<occupied_until:continue
    outcome=exit_model(t,rm,hold,tp)
    if outcome is None:
     unresolved.append(t)
     # If true TP/SL-only never exits, block later signals; never silently settle.
     occupied_until=2**63
     break
    trades.append(outcome)
    last_entry=t
    # Conservative duration: next H1 decision cannot reuse the same owner until exit.
    occupied_until=outcome['exitTs']+M
   case_id=f'TP{str(tp).replace(".","p")}_SL2_'+('NO_TIME' if hold is None else f'H{hold}M')
   case={'id':case_id,'tpPct':tp,'stopPct':2,'maxHoldMinutes':hold,
         'rawMarketSignalCountAllHistory':len(raw),'rawMarketSignalCount12m':len(annual),
         'trades':trades,'unresolved':unresolved,'10bps':stats(trades,10),'30bps':stats(trades,30)}
   cases.append(case)
   print('CASE',case_id,'N',len(trades),'UNRESOLVED',len(unresolved),
         '10bps', {k:v for k,v in case['10bps'].items() if k!='netPerTrade'},
         '30bps', {k:v for k,v in case['30bps'].items() if k!='netPerTrade'},flush=True)
 result={'status':'RESEARCH_PUBLIC_BINANCE_OFFICIAL_M5_NO_SHADOW_QUALITY_GATE',
 'sourceChecksums':{'RENDERUSDT':rmanifest,'BTCUSDT':bmanifest},
 'periodStartUTC':'2025-08-10T00:00:00Z','periodEndUTC':'2026-08-10T00:00:00Z',
 'rawFullPeriod':len(raw),'raw12Month':len(annual),'cases':cases,
 'executionAssumptions':'After completed H1 enter next M5 open; if SL and TP touched same M5 assume STOP first; 12-hour entry cooldown; same-symbol no overlap; stop2% all; TP variants 1.5%,2%,3%; no-time exits only on TP or SL, no forced closing. Cost is total roundtrip basis points.',
 'limitation':'RESEARCH-only independent signal outcomes; capital/gross ownership and portfolio effects require separate Native8 replay; no signed Aster fills, funding or L2 evidence.'}
 out=ROOT/'RENDER_NO_SHADOW_EXIT_HOLD_COMPARISON_20261026.json'
 out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 print('RESULT_SAVED',out,'CASE_COUNT',len(cases),flush=True)
if __name__=='__main__':main()
