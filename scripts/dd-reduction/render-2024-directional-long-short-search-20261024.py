#!/usr/bin/env python3
"""Directional RENDER/RNDR 2024-origin entries for the 3-expert research system.

These are 12 long/short structurally independent entry families, not merely
filters placed over a SHORT candidate bank. All price/M5/OI/CVD/funding
measurements are historical-as-of, old RNDR and new RENDER are separate
execution instruments, 5m next-open and stop-first, no live modification.
Never use research scores alone to enable native-8 real order routes.
"""
from __future__ import annotations
import bisect,collections,datetime as dt,json,math
from pathlib import Path
from importlib import util
import numpy as np
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
OUT=ROOT/'docs/research/results/render-three-regime-20261024'
def load(n,path):
 spec=util.spec_from_file_location(n,path)
 x=util.module_from_spec(spec);spec.loader.exec_module(x);return x
three=load('render_three_data_2024',HERE/'render-2024-fullyear-three-experts-20261024.py')
b=three.base;m=three.m;e=three.e
M5=300000;HOUR=3600000
# Prices in fractions. Realized return is net of both-side total 10/30bps.
EXITS={
 'TAKE15_STOP20_H6':(.015,.020,6,0,0),
 'TAKE20_STOP20_H12':(.020,.020,12,0,0),
 'TAKE25_STOP25_H12':(.025,.025,12,0,0),
 'TAKE30_STOP25_H18':(.030,.025,18,0,0),
 'TAKE40_STOP30_H24':(.040,.030,24,0,0),
 'TRAIL_MFE15_FLOOR05_H18':(.035,.030,18,.015,.005),
 'TRAIL_MFE25_FLOOR10_H24':(.050,.035,24,.025,.010),
}
PERIODS={
 '2024_RNDR_JAN_MAY':(e.ms('2024-01-01'),e.ms('2024-06-01')),
 '2024_RNDR_JUN_JUL16':(e.ms('2024-06-01'),b.OLD_EXPIRY),
 '2024_RENDER_JUL_DEC':(b.NEW_START,e.ms('2025-01-01')),
 '2025_RENDER_JAN_MAR':(e.ms('2025-01-01'),e.ms('2025-04-01')),
 '2025_RENDER_APR_JUL':(e.ms('2025-04-01'),e.ms('2025-08-01')),
 '2025_RENDER_AUG_DEC':(e.ms('2025-08-01'),e.ms('2026-01-01')),
 '2026_RENDER_JAN_MAR':(e.ms('2026-01-01'),e.ms('2026-04-01')),
 '2026_RENDER_APR_AUG':(e.ms('2026-04-01'),e.ms('2026-08-10')),
}
# Fixed candidate families, combining PRICE structure, market trend and
# as-of official Binance OI/aggressive seller/buyer observations.
def family(f,v):
 def above(x,n):return x>=n
 o=v['oi1Pct'];o3=v['oi3Pct']
 s=v['seller1'];s3=v['seller3']
 r1=f['ret1'];r3=f['ret3'];r6=f['ret6'];r24=f['ret24']
 btc1=f['btc1'];btc6=f['btc6'];btc24=f['btc24']
 fl={}
 # LONG: buy the real demand transition, not any rebound during an unbroken dump.
 fl['LONG_BTC_UP_RENDER_PULLBACK_CONFIRM']=(
  btc24>=.5 and r6>=1.0 and -.9<=r1<=.6 and f['last15']>=.12
  and f['rangePos1']>=.58 and s<=-.02)
 fl['LONG_RSI_REBOUND_BUYERS_ENTER']=(
  r24<=-3.5 and r3>=-.2 and f['last15']>=.22
  and f['rangePos1']>=.68 and s<=-.08 and (s3-s)>=.05)
 fl['LONG_BTC_UP_RELATIVE_LEADER']=(
  btc6>=.9 and f['rel6']>=.7 and r1>=.25 and f['last15']>=.1
  and f['rangePos1']>=.7 and s<=-.03)
 fl['LONG_2024_UPTREND_BREAKOUT_OI']=(
  r24>=2 and r6>=1 and r1>=.35 and f['last15']>=.12
  and f['rangePos1']>=.80 and f['volumeRatio']>=1.15
  and s<=-.02 and o>=-.35)
 fl['LONG_SHORT_COVER_BREAK_AFTER_SQUEEZE']=(
  r6<=-1 and r1>=.5 and f['last15']>=.20
  and s<=-.10 and o3<=.1 and f['rangePos1']>=.67)
 fl['LONG_DEEP_DUMP_REVERSAL_CONFIRMED']=(
  r24<=-5 and r3>=.45 and f['last15']>=.3
  and s<=-.11 and (s3-s)>=.08 and f['rangePos1']>=.65)
 # SHORT: 2024 BTC rally-failure type and bearish pullback confirmation
 fl['SHORT_2024_BTC_RALLY_FAILURE']=(
  btc1>=.28 and r3>=.7 and f['hourWick']>=.40
  and f['last15']<=-.12 and f['rangePos1']<=.65 and s>=.03)
 fl['SHORT_BEAR_REBOUND_2H_FADE']=(
  r24<=-2 and r3>=.7 and f['priorRebound']>=1.0
  and f['last15']<=-.17 and f['rangePos1']<=.50 and s>=.03)
 fl['SHORT_BTC_RALLY_RENDER_DIVERGENCE']=(
  btc6>=.7 and f['rel6']<=-1.0 and r1<=-.1
  and f['last15']<=-.1 and s>=.08 and o3>=-.15)
 fl['SHORT_WEAK_BEAR_BREAK_OI_EXPAND']=(
  btc24<=-1 and r6<=-1.8 and r1<=-.35
  and f['last15']<=-.13 and s>=.10 and o>=.12)
 fl['SHORT_RALLY_TOP_BUYER_EXHAUST']=(
  r6>=1.7 and r3>=.8 and f['hourWick']>=.42
  and f['last15']<=-.15 and s>=.03 and s3<=.04)
 fl['SHORT_DEEP_DROP_FAILED_RETEST']=(
  r24<=-4 and r3>=.65 and f['last15']<=-.18
  and f['priorRebound']>=.9 and s>=.06 and o>=0)
 return {k:(v,'LONG' if k.startswith('LONG') else 'SHORT') for k,v in fl.items() if v}
def source():
 a=json.loads((OUT/'RENDER_RNDR_2024_OFFICIAL_CROSS_CONTRACT_SOURCE_MANIFEST_20261024.json').read_text('utf8'))
 assert a['goodN']==a['requestedN']==227 and a['errorN']==0
 old=json.loads((ROOT/'docs/research/results/render-orderflow-20261024/RENDER_ORDERFLOW_SOURCE_MANIFEST_20261024.json').read_text('utf8'))
 files=a['files']
 rn=[r for r in b.bars(files,'RNDRUSDT') if r[0]<b.OLD_EXPIRY]
 btc2024=b.bars(files,'BTCUSDT')
 rjul=b.bars(files,'RENDERUSDT')
 rAug=m.read_render_bars(old['files'],True)
 btcAugmani=json.loads((ROOT/'docs/research/results/idle-entry-three-20261024/IDLE_RENDER_OLDER_BINANCE_PUBLIC_M5_SOURCE_MANIFEST_20261024.json').read_text('utf8'))
 btcAug,_=e.old_mod.parse_months(btcAugmani,'BTCUSDT')
 nativem=e.imp('2024_native_provider_extra',HERE/'research-residual-avax-composite-entry-veto-full8-20261023.py')
 provider,_=nativem.native.m.m.core.task8.legacy.bootstrap()
 rnew=m.read_render_bars(old['files'],False)
 btcnew,_=provider.getdata('BTCUSDT')
 tokenRENDER=rjul+rAug+rnew
 btcALL=btc2024+btcAug+btcnew
 assert b.continuous(rn) and b.continuous(tokenRENDER) and b.continuous(btcALL)
 oldmet,badold=three.metrics_small([x for x in files if x['symbol']=='RNDRUSDT' and x['kind']=='metrics'])
 newmet0,badnew=three.metrics_small([x for x in old['files'] if x['kind']=='metrics'])
 newmet7,badjuly=three.metrics_small([x for x in files if x['symbol']=='RENDERUSDT' and x['kind']=='metrics'])
 newmet=sorted(newmet0+newmet7)
 oldfund=three.funding_small([x for x in files if x['symbol']=='RNDRUSDT' and x['kind']=='fundingRate'])
 newfund0=m.read_funding(old['files'])
 newfund7=three.funding_small([x for x in files if x['symbol']=='RENDERUSDT' and x['kind']=='fundingRate'])
 newfund=sorted(newfund0+newfund7)
 return [(rn,btcALL,oldmet,oldfund,'RNDRUSDT',b.OLD_EXPIRY),
         (tokenRENDER,btcALL,newmet,newfund,'RENDERUSDT',e.ms('2026-08-10'))]
def collect(bars,btc,metrics,funding,symbol,expiry):
 times=[int(r[0]) for r in bars]
 btcmap={int(row[0]):i for i,row in enumerate(btc)}
 mt=[r[0] for r in metrics];ft=[r[0] for r in funding]
 fr=[r[1] for r in funding]
 cum=m.history_features(bars)
 marks=collections.Counter()
 records=[]
 for i in range(2017,len(bars)-300):
  t=times[i]+M5
  if t>=expiry-24*HOUR or t%HOUR:continue
  ib=btcmap.get(times[i])
  if ib is None or ib<2017:marks['btcMissing']+=1;continue
  if (times[i-2016]!=times[i]-2016*M5
      or btc[ib-2016][0]!=btc[ib][0]-2016*M5):
   marks['historyMissing']+=1;continue
  if times[i+1]!=t:marks['next5Missing']+=1;continue
  v=m.metrics_for_event({'t':t,'index':i},metrics,mt,ft,fr,bars,cum)
  if v is None:marks['flowMissing']+=1;continue
  f=e.screen.proc(bars,btc,i,ib)
  eligible=family(f,v)
  marks['h1Reviewed']+=1
  if not eligible:continue
  rv7=float(np.std(np.diff(np.log(np.asarray([float(q[4]) for q in bars[i-2016:i+1]],dtype=float))))*math.sqrt(288)*100)
  row={'time':t,'i':i,'symbol':symbol,'signals':eligible,
    'mfeSignals':{
      **{k:round(float(f[k]),5) for k in ('ret1','ret3','ret6','ret24','btc1','btc6','btc24','rel6','last15','last30','hourWick','priorRebound','rangePos1','rangePos24','volumeRatio')},
      **{k:round(float(v[k]),5) for k in ('seller1','seller3','sellerAcceleration','oi1Pct','oi3Pct','fundingBps')},
      'render7':round(100*(float(bars[i][4])/float(bars[i-2016][4])-1),5),
      'btc7':round(100*(float(btc[ib][4])/float(btc[ib-2016][4])-1),5),
      'renderRV7':round(rv7,5)},
    'exits':{}}
  records.append(row)
  marks['anySignal']+=1
  for k in eligible:marks[k]+=1
 print('FULL_H1_SCAN',symbol,'ELIGIBLE',len(records),'SAMPLE_COUNT',dict(marks),flush=True)
 return records,marks
def simulate(bars,index,side,policy):
 tp,sl,hold,trig,protect=policy
 assert side in ('LONG','SHORT')
 t0=index+1
 epx=float(bars[t0][1])
 target=epx*(1+tp if side=='LONG' else 1-tp)
 hard=epx*(1-sl if side=='LONG' else 1+sl)
 protective=None
 limit=min(index+1+hold*12,len(bars)-1)
 reason='TIME'
 px=float(bars[limit][1])
 exit_ts=int(bars[limit][0])
 hi_mfe=0.0
 for k in range(t0,limit):
  op,high,low=(float(bars[k][idx]) for idx in (1,2,3))
  if side=='LONG':
   stop=max(hard,protective) if protective is not None else hard
   if low<=stop:
    px=min(op,stop);reason='STOP_OR_TRAIL';exit_ts=int(bars[k][0]);break
   if high>=target:
    px=target;reason='TAKE';exit_ts=int(bars[k][0]);break
   hi_mfe=max(hi_mfe,high/epx-1)
   if trig and hi_mfe>=trig:protective=epx*(1+protect)
  else:
   stop=min(hard,protective) if protective is not None else hard
   if high>=stop:
    px=max(op,stop);reason='STOP_OR_TRAIL';exit_ts=int(bars[k][0]);break
   if low<=target:
    px=target;reason='TAKE';exit_ts=int(bars[k][0]);break
   hi_mfe=max(hi_mfe,1-low/epx)
   if trig and hi_mfe>=trig:protective=epx*(1-protect)
 ret=100*(px/epx-1)*(1 if side=='LONG' else -1)
 return {'net30':ret-.30,'exitTs':exit_ts,'reason':reason,'maxMfePct':round(hi_mfe*100,3)}
def summarize(rows,cost):
 pnl=[r['exit']['net30']+(.30-cost/100) for r in rows]
 gain=sum(x for x in pnl if x>0); loss=-sum(x for x in pnl if x<=0)
 return {'n':len(pnl),'wins':sum(x>0 for x in pnl),
  'wrPct':round(100*sum(x>0 for x in pnl)/len(pnl),2) if pnl else None,
  'pf':round(gain/loss,4) if loss>0 else None,
  'netPct':round(sum(pnl),3),
  'maxLossPct':round(min(pnl),3) if pnl else None,
  'exitReasons':dict(collections.Counter(z['exit']['reason'] for z in rows))}
def basket(events,key,side,policy):
 out=[];allowed=0
 for ev in events:
  if key not in ev['signals'] or ev['time']<allowed:continue
  result=ev['exits'][side][policy]
  out.append({'time':ev['time'],'symbol':ev['symbol'],'side':side,'exit':result})
  allowed=result['exitTs']+12*HOUR
 return out
def main():
 episodes=source()
 allEvents=[];rollups={}
 for bars,btc,metrics,fund,symbol,expiry in episodes:
  cand,marks=collect(bars,btc,metrics,fund,symbol,expiry)
  rollups[symbol]=dict(marks)
  # compute exit path only for routed signal-side pair, cached among families
  for ev in cand:
   ev['exits']={}
   for side in {flag[1] for flag in ev['signals'].values()}:
    ev['exits'][side]={name:simulate(bars,ev['i'],side,params) for name,params in EXITS.items()}
  allEvents.extend(cand)
 allEvents.sort(key=lambda z:z['time'])
 report={'status':'RESEARCH_ONLY_INDEPENDENT_2024_DIRECTION_AWARE_ENTRY_BANK_NOT_NATIVE8',
  'source':'227 official 2024 publisher SHA matched archives plus 799 2024-2026 SHA matched archives',
  'contractEpisodes':['RNDR Jan1-Jul16 2024','RENDER Jul26 2024-Aug9 2026'],
  'causality':'completed H1/M5, OI after 10m publication lag, funding after 5m lag, next5m entry; no RNDR/RENDER splice',
  'warnings':['This research includes multiple model explorations, not untouched OOS',
   'Independent long/short entry research is NOT a live RENDER native8 order model',
   'No live venue slippage/partial fills; 10/30bps round-trip cost plus M5 stop-first'],
  'exitContracts':EXITS,'periods':PERIODS,'sourceSignalCounts':rollups,'families':{}}
 for fam in [*list({k for ev in allEvents for k in ev['signals']})]:
  one=next(ev['signals'][fam][1] for ev in allEvents if fam in ev['signals'])
  for exitname in EXITS:
   old=[ev for ev in allEvents if ev['symbol']=='RNDRUSDT']
   newer=[ev for ev in allEvents if ev['symbol']=='RENDERUSDT']
   selected=basket(old,fam,one,exitname)+basket(newer,fam,one,exitname)
   split={}
   for name,(a,btime) in PERIODS.items():
    chunk=[z for z in selected if a<=z['time']<btime]
    split[name]={str(c):summarize(chunk,c) for c in (10,30)}
   key=f'{fam}__{exitname}'
   report['families'][key]={'side':one,'periods':split}
   oldtrain=split['2024_RNDR_JAN_MAY']['30']
   valold=split['2024_RNDR_JUN_JUL16']['30']
   valnew=split['2024_RENDER_JUL_DEC']['30']
   yr25=split['2025_RENDER_APR_JUL']['30']
   yr26=split['2026_RENDER_JAN_MAR']['30']
   if min(oldtrain['n'],valold['n'],valnew['n'])>=7:
    print('STRUCT',key,'24OLD',oldtrain['n'],oldtrain['pf'],
     '24JUNE',valold['n'],valold['pf'],
     '24NEW',valnew['n'],valnew['pf'],
     '25SPRING',yr25['n'],yr25['pf'],
     '26DUMP',yr26['n'],yr26['pf'],flush=True)
 # priority shortlist uses only 2024 in-contract split and 2025 Jan-Jul
 candidates=[]
 for key,z in report['families'].items():
  P=z['periods']
  old=P['2024_RNDR_JAN_MAY']['30'];mid=P['2024_RNDR_JUN_JUL16']['30']
  aft=P['2024_RENDER_JUL_DEC']['30']
  jan=P['2025_RENDER_JAN_MAR']['30'];jul=P['2025_RENDER_APR_JUL']['30']
  if min(old['n'],mid['n'],aft['n'],jan['n'],jul['n'])<8:continue
  if all((x['pf'] or 0)>1 for x in (old,mid,aft,jan,jul)):
   candidates.append(key)
 report['allFiveHistoricalWindowsProfitable30bps']=candidates
 # Preserve independently selected trade-level causal features and modeled
 # 30bps exit returns for detailed walk-forward regime analysis.
 benchkey='SHORT_BEAR_REBOUND_2H_FADE'
 chosen=[]
 for symbol in ('RNDRUSDT','RENDERUSDT'):
  items=[v for v in allEvents if v['symbol']==symbol]
  allowed=-1
  for ev in items:
   if benchkey not in ev['signals'] or ev['time']<allowed:continue
   ex=ev['exits']['SHORT']['TAKE40_STOP30_H24']
   chosen.append({'t':ev['time'],'symbol':ev['symbol'],'signal':benchkey,
    'causalFeatures':ev['mfeSignals'],'exitModel30':ex})
   allowed=int(ex['exitTs'])+12*HOUR
 report['selectedBenchTradeAudit']=chosen
 report['allBenchSignalEvents']=[
  {'t':ev['time'],'symbol':ev['symbol'],'signal':benchkey,
   'causalFeatures':ev['mfeSignals'],
   'exitModel30':ev['exits']['SHORT']['TAKE40_STOP30_H24']}
  for ev in allEvents if benchkey in ev['signals']]
 report['dualShortResearchSignalEvents']=[
  {'t':ev['time'],'symbol':ev['symbol'],
   'signals':[k for k in ('SHORT_2024_BTC_RALLY_FAILURE','SHORT_BEAR_REBOUND_2H_FADE')
              if k in ev['signals']],
   'causalFeatures':ev['mfeSignals'],
   'exitModel30':ev['exits']['SHORT']['TAKE40_STOP30_H24']}
  for ev in allEvents if
  ('SHORT_2024_BTC_RALLY_FAILURE' in ev['signals'] or 'SHORT_BEAR_REBOUND_2H_FADE' in ev['signals'])]
 print('2024_TWO_SHORT_EXPERT_UNION',len(report['dualShortResearchSignalEvents']),flush=True)
 print('ALL_BENCH_CAUSAL_ENTRY_EVENTS',len(report['allBenchSignalEvents']),flush=True)
 print('BENCH_DETAIL',len(chosen),'2024',sum(x['t']<e.ms('2025-01-01') for x in chosen),
  '2025_2026',sum(x['t']>=e.ms('2025-01-01') for x in chosen),flush=True)
 path=OUT/'RENDER_2024_FRESH_LONG_SHORT_12_ENTRY_7_EXIT_SCREENER_20261024.json'
 path.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
 print('STRUCTURE_SCREEN_COMPLETED','CANDIDATES',candidates,'OUTPUT',path,flush=True)
if __name__=='__main__':main()
