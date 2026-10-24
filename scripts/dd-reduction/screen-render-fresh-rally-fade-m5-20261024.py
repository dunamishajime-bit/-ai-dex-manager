#!/usr/bin/env python3
"""Research-only truly NEW RENDER SHORT hourly price-action signals after upside retrace.
No market future information in any entrance. Independently replays M5 exits and
1-sleeve cooldown WITHOUT shared wallet or ownership. Not a LIVE-ready backtest.
"""
from __future__ import annotations
import bisect,datetime,importlib.util,json,statistics,math
from pathlib import Path
REPO=Path(__file__).resolve().parents[2]
HERE=Path(__file__).resolve().parent
OUT=REPO/'docs/research/results/idle-entry-three-20261024'
HOUR=3600000;M5=300000
START=int(datetime.datetime(2025,8,10,tzinfo=datetime.timezone.utc).timestamp()*1000)
END=int(datetime.datetime(2026,8,10,tzinfo=datetime.timezone.utc).timestamp()*1000)
HALF=int(datetime.datetime(2026,2,10,tzinfo=datetime.timezone.utc).timestamp()*1000)
def load(n,p):
 sp=importlib.util.spec_from_file_location(n,p)
 m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m);return m
native=load('render_new_route_source',HERE/'research-residual-avax-composite-entry-veto-full8-20261023.py')
def proc(e,b,i,ib):
 def ret(v,j,h):
  c=float(v[j][4]);old=float(v[j-12*h][4])
  return 100*(c/old-1)
 p=float(e[i][4]);hour=e[i-11:i+1]
 high=max(float(z[2]) for z in hour);lo=min(float(z[3]) for z in hour)
 earlier=e[i-35:i-11]
 priorlow=min(float(z[3]) for z in earlier)
 priorhigh=max(float(z[2]) for z in earlier)
 day=e[i-287:i+1]
 dh=max(float(z[2]) for z in day);dl=min(float(z[3]) for z in day)
 vol=sum(float(z[5]) for z in hour)/12
 oldvol=sum(float(z[5]) for z in e[i-83:i-11])/72
 out={'ret1':ret(e,i,1),'ret3':ret(e,i,3),'ret6':ret(e,i,6),
 'ret24':ret(e,i,24),'btc1':ret(b,ib,1),'btc6':ret(b,ib,6),
 'btc24':ret(b,ib,24),'rel6':ret(e,i,6)-ret(b,ib,6),
 'last15':100*(p/float(e[i-3][4])-1),
 'last30':100*(p/float(e[i-6][4])-1),
 'first45':100*(float(e[i-6][4])/float(e[i-15][4])-1),
 'hourWick':100*(high/p-1),'priorRebound':100*(high/priorlow-1),
 'hourRange':100*(high/lo-1),'high24':100*(dh/p-1),
 'rangePos1':(p-lo)/(high-lo) if high>lo else .5,
 'rangePos24':(p-dl)/(dh-dl) if dh>dl else .5,
 'volumeRatio':vol/oldvol if oldvol else 0}
 assert all(math.isfinite(v) for v in out.values())
 return out
PATTERNS={
 'RALLY3_FADE':lambda a:a['ret3']>=1 and a['last15']<=-.2 and a['hourWick']>=.4,
 'RALLY6_FADE_BTC':lambda a:a['ret6']>=2 and a['btc6']<=1.0 and a['last15']<=-.2 and a['hourWick']>=.3,
 'DOWNTREND_24_RETRACE':lambda a:a['ret24']<=-3 and a['ret3']>=1 and a['last15']<=-.15,
 'DOWNTREND_24_STRICT':lambda a:a['ret24']<=-5 and a['ret3']>=1.5 and a['last15']<=-.2,
 'RELATIVE_OVERBOUGHT':lambda a:a['rel6']>=2 and a['ret3']>=1.5 and a['btc6']<1 and a['last15']<=-.2,
 'HIGH_WICK_RESISTANCE':lambda a:a['ret1']>=.75 and a['hourWick']>=.75 and a['rangePos1']<=.5,
 'UPRALLY_VOLUME_SHOCK':lambda a:a['ret3']>=2 and a['volumeRatio']>=1.4 and a['last15']<=-.3,
 'BTC_TRAP_REJECTION':lambda a:a['btc1']>=.5 and a['ret3']>=1.5 and a['last15']<=-.2 and a['hourWick']>=.5,
 'COUNTERTREND_BOUNCE_FADE':lambda a:a['ret6']<=-2 and a['first45']>=.3 and a['last15']<=-.2 and a['priorRebound']>=1,
 'BROAD_RETRACE_RESISTANCE':lambda a:a['ret3']>=.75 and a['hourWick']>=.3 and a['rangePos24']>=.6 and a['last15']<=-.15,
 'WEAK_BTC_STRONG_RENDER_FADE':lambda a:a['btc6']<0 and a['ret3']>1.0 and a['rel6']>=1.0 and a['last15']<=-.15
}
EXIT_POLICIES={'TP1P75_SL2P5_HOLD6':(.0175,.025,6),
               'TP1P75_SL2P5_HOLD12':(.0175,.025,12),
               'TP2_SL3_HOLD12':(.02,.03,12)}
def settle(bars,i,tp,sl,hold,cost):
 entryi=i+1;entry=float(bars[entryi][1])
 target=entry*(1-tp);stop=entry*(1+sl)
 assert entry>0
 limit=min(len(bars)-1,entryi+hold*12)
 px=float(bars[limit][1]);exit_ts=int(bars[limit][0]);reason='TIME'
 for k in range(entryi,limit):
  op=float(bars[k][1]);high=float(bars[k][2]);low=float(bars[k][3])
  # Stop wins on ambiguous high-low M5; stop gap price is adverse for short.
  if high>=stop:
   px=max(op,stop);exit_ts=int(bars[k][0]);reason='HARD_STOP';break
  if low<=target:
   px=target;exit_ts=int(bars[k][0]);reason='TARGET';break
 gross=100*(entry-px)/entry
 return {'ts':int(bars[entryi][0]),'exitTs':exit_ts,'entryPrice':entry,'exitPrice':px,
   'netPct':gross-cost/100,'exitReason':reason}
def result(a):
 w=[z['netPct'] for z in a if z['netPct']>0]
 l=[z['netPct'] for z in a if z['netPct']<=0]
 return {'n':len(a),'wins':len(w),'wrPct':round(100*len(w)/len(a),2) if a else None,
 'pf':round(sum(w)/-sum(l),4) if sum(l)<0 else None,
 'netPctSum':round(sum(z['netPct'] for z in a),3)}
def main():
 source,_=native.native.m.m.core.task8.legacy.bootstrap()
 bars,times=source.getdata('RENDERUSDT')
 btc,btct=source.getdata('BTCUSDT')
 print('M5',len(bars),len(btc),'SIGNALS',len(PATTERNS),'OUTCOMES',len(EXIT_POLICIES),flush=True)
 available=[]
 for i in range(289,len(bars)-144):
  time=int(times[i])+M5
  if time<START or time>=END or time%HOUR:continue
  if int(times[i+1])!=time or int(times[i-288])!=int(times[i])-288*M5:continue
  ib=bisect.bisect_left(btct,int(times[i]))
  if ib<289 or ib>=len(btct) or int(btct[ib])!=int(times[i]):continue
  if int(btct[ib-288])!=int(btct[ib])-288*M5:continue
  feat=proc(bars,btc,i,ib)
  available.append((i,feat))
 print('CONFIRMED_COMPLETED_M5_H1_FEATURES',len(available),flush=True)
 feature_by_index={i:feat for i,feat in available}
 out={'status':'INDEPENDENT_M5_NEW_ROUTE_EXPERIMENT_NOT_NATIVE_SHARED_WALLET',
 'period':'2025-08-10..2026-08-10','startCapitalJpy':None,
 'warnings':['No native capital capacity or collisions are modeled. Do not attribute outcomes to a tradeable portfolio.',
             'Signal generated only using previous CLOSED M5, trades on next H1 M5 open.',
             'Stop wins if both stop and target touched in same M5. No funding, latency or live venue execution.',
             'Historical period was previously used for iterative research, time split is not untouched OOS.'],
 'results':{}}
 for cost in (10,30):
  best=[]
  for name,trigger in PATTERNS.items():
   signal=[i for i,f in available if trigger(f)]
   for label,(tp,sl,hold) in EXIT_POLICIES.items():
    chosen=[];next_allowed=-1
    for i in signal:
     t=int(times[i])+M5
     if t<next_allowed:continue
     x=settle(bars,i,tp,sl,hold,cost)
     x['signalIndex']=i
     chosen.append(x);next_allowed=x['exitTs']+12*HOUR
    first=[x for x in chosen if x['ts']<HALF];second=[x for x in chosen if x['ts']>=HALF]
    stats={'signalCount':len(signal),'overall':result(chosen),'early':result(first),'late':result(second),
          'exitMix':{k:sum(z['exitReason']==k for z in chosen) for k in ('TARGET','HARD_STOP','TIME')}}
    if name in ('BTC_TRAP_REJECTION','BROAD_RETRACE_RESISTANCE') and label in ('TP1P75_SL2P5_HOLD6','TP1P75_SL2P5_HOLD12'):
     stats['selectedEventAudit']=[{'ts':z['ts'],'exitTs':z['exitTs'],
       'netPct':z['netPct'],'win':z['netPct']>0,'exitReason':z['exitReason'],
       'causalFeatures':feature_by_index[z['signalIndex']]} for z in chosen]
    out['results'].setdefault(str(cost),{})[name+'__'+label]=stats
    if stats['overall']['n']>=20 and stats['early']['n']>=6 and stats['late']['n']>=6:
     best.append((name,label,stats))
  best.sort(key=lambda row: (-(row[2]['overall']['pf'] or 0),-row[2]['overall']['n']))
  print('COST',cost,'CANDIDATES_WITH_20_TRADES_BOTH_HALVES',len(best),flush=True)
  for a,b,v in best[:12]:
   print('MODEL',a,b,'N',v['overall']['n'],'WR',v['overall']['wrPct'],'PF',v['overall']['pf'],
    'EARLY',v['early']['n'],v['early']['wrPct'],v['early']['pf'],
    'LATE',v['late']['n'],v['late']['wrPct'],v['late']['pf'],flush=True)
 target=OUT/'IDLE_RENDER_NEW_RETRACEMENT_SHORT_INDEPENDENT_5M_20261024.json'
 target.write_text(json.dumps(out,indent=2,ensure_ascii=False)+'\n',encoding='utf8',newline='\n')
 print('SAVED',target,target.stat().st_size)
if __name__=='__main__':main()
