#!/usr/bin/env python3
"""RENDER #4427: initial adverse exit and profit protection, causal M5.
No production, no live. Stop-first and next-bar scheduling, 10/30 bps.
Do not use future candle inside a stop or newly created trailing trigger.
2024 RNDR and later RENDER are independent contracts and cool-down clocks.
"""
from __future__ import annotations
import bisect,collections,hashlib,json,math
from pathlib import Path
from importlib import util
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
OUT=ROOT/'docs/research/results/render-three-regime-20261024'
def load(n,p):
 s=util.spec_from_file_location(n,p);m=util.module_from_spec(s);s.loader.exec_module(m);return m
source=load('render2024M5_earlyexit_v2',HERE/'render-2024-directional-long-short-search-20261024.py')
bank=json.loads((OUT/'RENDER_ALL_SIX_SHORT_CAUSAL_ENTRY_BANK_2024_2026AUG_20261024.json').read_text('utf8'))
A='SHORT_2024_BTC_RALLY_FAILURE'
B='SHORT_BEAR_REBOUND_2H_FADE'
X='SHORT_DEEP_DROP_FAILED_RETEST'
# Only pre-entry event feats and price history <= current bar. No future conditioning.
EARLY={
 'NONE':('NONE',),
 'H1_L10_MFE05':('TIME',1,-.010,.005),
 'H2_L10_MFE05':('TIME',2,-.010,.005),
 'H2_L15_MFE05':('TIME',2,-.015,.005),
 'H2_L20_MFE05':('TIME',2,-.020,.005),
 'H3_L15_MFE05':('TIME',3,-.015,.005),
 'H4_L15_MFE05':('TIME',4,-.015,.005),
 'H2_L15_MFE10':('TIME',2,-.015,.010),
 'H3_L20_MFE10':('TIME',3,-.020,.010),
 'TWO_H1_L15_MFE05':('TWO_H1',2,-.015,.005),
 'TOUCH20_W1_L10_MFE05':('TOUCH',.020,1,-.010,.005),
 'TOUCH20_W2_L15_MFE05':('TOUCH',.020,2,-.015,.005),
 'TOUCH25_W2_L15_MFE05':('TOUCH',.025,2,-.015,.005)
}
PROFIT={
 'BASE':('BASE',),
 'STEP10_BE25_P1':('STEP',((.010,0),(.025,.010))),
 'STEP15_P05_25_P1':('STEP',((.015,.005),(.025,.010))),
 'STEP15_P05_25_P15':('STEP',((.015,.005),(.025,.015))),
 'STEP20_P1_30_P2':('STEP',((.020,.010),(.030,.020))),
 'STEP15_P05_25_P1_30_P2':('STEP',((.015,.005),(.025,.010),(.030,.020))),
 'MFE2_GIVE15':('PEAK',.020,.015,.005),
 'MFE25_GIVE20':('PEAK',.025,.020,.010),
 'STEP15_PEAK3_GIVE15':('STEP_PEAK',((.015,.005),(.025,.010)),.030,.015),
 'STEP10_PEAK3_GIVE20':('STEP_PEAK',((.010,0),(.025,.010)),.030,.020)
}
def sim(bars,index,early,profit):
 t0=index+1
 px0=float(bars[t0][1])
 tp=.05;hard=px0*(1+.035)
 target=px0*(1-tp)
 end=min(index+1+24*12,len(bars)-1)
 maxmfe=0.;maxmae=0.;floor=None
 first_adverse=None;consec_h1=0;scheduled=False
 for i in range(t0,end):
  row=bars[i];tm=int(row[0]);op,hi,lo,cl=[float(row[k]) for k in (1,2,3,4)]
  if scheduled:
   # Stop sent on preceding closed candle; next candle opens at observable price.
   got=op
   reason='EARLY_AFTER_CONFIRMED_M5'
   break
  stop=min(hard,floor) if floor is not None else hard
  if hi>=stop:
   got=max(op,stop);reason='STOP_OR_TRAIL';break
  if lo<=target:
   got=target;reason='TAKE';break
  mfe_cand=max(maxmfe,1-lo/px0)
  maxmae=max(maxmae,hi/px0-1)
  maxmfe=mfe_cand
  close_ret=1-cl/px0
  ev=EARLY[early]
  if ev[0]=='TIME':
   _,hours,loss,mfegate=ev
   if ((i-t0+1)*5>=hours*60 and close_ret<=loss and
     maxmfe<mfegate):scheduled=True
  elif ev[0]=='TWO_H1':
   _,n,loss,mfegate=ev
   # A completed hourly candle only: candle open HH:55 and close HH+1:00.
   if tm%(3600000)==55*60000:
    if close_ret<=loss and maxmfe<mfegate:consec_h1+=1
    else:consec_h1=0
    if consec_h1>=n:scheduled=True
  elif ev[0]=='TOUCH':
   _,touch,hours,loss,mfegate=ev
   if first_adverse is None and hi>=px0*(1+touch) and maxmfe<mfegate:
    first_adverse=i
   if (first_adverse is not None and (i-first_adverse+1)*5>=hours*60
       and close_ret<=loss and maxmfe<mfegate):scheduled=True
  k=PROFIT[profit]
  z=None
  if k[0]=='BASE':
   if maxmfe>=.025:z=.01
  elif k[0]=='STEP':
   for trigger,lock in k[1]:
    if maxmfe>=trigger:z=lock
  elif k[0]=='PEAK':
   _,trigger,give,minfloor=k
   if maxmfe>=trigger:z=max(minfloor,maxmfe-give)
  elif k[0]=='STEP_PEAK':
   for trigger,lock in k[1]:
    if maxmfe>=trigger:z=lock
   if maxmfe>=k[2]:z=max(z if z is not None else 0,maxmfe-k[3])
  if z is not None:
   new_floor=px0*(1-z)
   floor=min(floor,new_floor) if floor is not None else new_floor
 else:
  got=float(bars[end][1]);reason='TIME';tm=int(bars[end][0])
 ret=100*(1-got/px0)
 assert tm>=int(bars[t0][0])
 return {'exitTs':tm,'net30':ret-.30,
  'reason':reason,'maxMfePct':round(maxmfe*100,4),'maxMaePct':round(maxmae*100,4)}
def main():
 events=bank['events']
 relevant={(e['symbol'],int(e['t'])):e for e in events if
  A in e['shortSignals'] or (B in e['shortSignals'] and e['causalFeatures']['oi3Pct']<=-.2)}
 print('TOTAL_SIGNALS',len(events),'NEED_REPLAY',len(relevant),'EARLY',len(EARLY),
   'PROFIT',len(PROFIT),flush=True)
 errors=[]
 for bars,_btc,_met,_fund,symbol,expiry in source.source():
  ts=[int(x[0]) for x in bars]
  n=0
  for (name,t),ev in relevant.items():
   if name!=symbol:continue
   idx=bisect.bisect_left(ts,t)-1
   assert idx>=1 and ts[idx]+source.M5==t and ts[idx+1]==t
   original=source.simulate(bars,idx,'SHORT',source.EXITS['TRAIL_MFE25_FLOOR10_H24'])
   hand=sim(bars,idx,'NONE','BASE')
   assert hand['exitTs']==original['exitTs'] and abs(hand['net30']-original['net30'])<1e-9,(name,t,hand,original)
   for ea in EARLY:
    for pr in PROFIT:
     label='E_'+ea+'__P_'+pr
     ev['exitModels'][label]=sim(bars,idx,ea,pr)
   n+=1
  print('EPISODE_REPLAYED',symbol,n,flush=True)
 assert len(relevant)>150
 output={'status':'RESEARCH_ONLY_RENDER_4427_M5_INITIAL_NEGATIVE_AND_PEAK_PROFIT_BANK',
  'source':'2024-2026 causally signed market M5 source; original BASE exact price+exit parity',
  'modelCostBps':30,
  'baseline':'E_NONE__P_BASE (A and B), X original TAKE15_STOP20_H6',
  'allEarlyModels':EARLY,'allProfitModels':PROFIT,
  'entryEvents':len(events),
  'variantsPerCandidate':len(EARLY)*len(PROFIT),
  'events':events,
  'warnings':['Past 2024-2026 data repeatedly explored, not pristine future holdout',
   'Check 2026 Aug-Oct additionally, then no relabel as independent OOS',
   '5m OHLC best/worst timing conservative: prior stop first, newly triggered protective stop becomes active next M5',
   'Additional candidate exits are hypothetical not Aster real venue stop order',
   'No live, orders, VPS, Production or HP changed']}
 dest=OUT/'RENDER_4427_INITIAL_NEGATIVE_AND_PROFIT_PROTECTION_M5_MODEL_BANK_20261024.json'
 dest.write_text(json.dumps(output,ensure_ascii=False,separators=(',',':'))+'\n','utf8')
 print('SAVED',dest,'bytes',dest.stat().st_size,flush=True)
if __name__=='__main__':main()
