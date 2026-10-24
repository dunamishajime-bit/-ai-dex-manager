#!/usr/bin/env python3
"""RENDER #4427: causal five-minute confirmation-entry study, research only.

Use previously audited Binance publisher M5 archives and frozen causal entry bank;
old RNDR and newer RENDER are disjoint symbols, no marks manufactured.
Only completed observations can trigger entry at NEXT M5 open.
Prices/stop-first/time exits are explicitly resimulated from delayed entry.
The 2026 Aug-Oct period was already used before; never call it pristine OOS.
"""
from __future__ import annotations
import collections,csv,datetime as dt,hashlib,io,json,math,statistics,zipfile
from bisect import bisect_left
from pathlib import Path

ROOT=Path('C:/tmp')
REPO=ROOT/'render-multiregime-study-20261024'
SRC=REPO/'docs/research/results/render-three-regime-20261024'
OUT=ROOT/'render-mtf-study-20261024'
OUT.mkdir(exist_ok=True,parents=True)
BANKS=[
 'RENDER_ALL_SIX_SHORT_CAUSAL_ENTRY_BANK_2024_2026AUG_20261024.json',
 'RENDER_ALL_SIX_SHORT_POSTAUG2026_RETROSPECTIVE_HOLDOUT_BANK_20261024.json']
SIGNALS={'A':'SHORT_2024_BTC_RALLY_FAILURE',
         'X':'SHORT_DEEP_DROP_FAILED_RETEST',
         'B':'SHORT_BEAR_REBOUND_2H_FADE'}
POLICY={
  'A':(.050,.035,24,.025,.010),
  'B':(.050,.035,24,.025,.010),
  'X':(.015,.020,6,0,0)}
M=300000;H=3600000
PERIODS={
 '2024':(1704067200000,1735689600000),
 '2025H1':(1735689600000,1754006400000),
 '2025H2':(1754006400000,1767225600000),
 '2026JanAug':(1767225600000,1786320000000),
 '2026AugOct':(1786320000000,1792800000000),
}
SOURCES=[
 ROOT/'render-rndr-2024-history-20261024',
 ROOT/'idle-render-independent-older-m5-20261024',
 ROOT/'render-flow-raw-data-20261024',
 ROOT/'render-2026-aug-oct-research-20261024']
def prices():
 out={}
 for sym in ('RNDRUSDT','RENDERUSDT'):
  res={}
  zipfiles=sorted(set(q for src in SOURCES for q in src.rglob(sym+'-5m-*.zip')))
  for p in zipfiles:
   with zipfile.ZipFile(p) as z:
    corrupted=z.testzip()
    if corrupted:raise AssertionError((p,corrupted))
    names=[x for x in z.namelist() if x.endswith('.csv')]
    assert len(names)==1,(p,names)
    for row in csv.reader(io.TextIOWrapper(z.open(names[0]),encoding='utf-8-sig')):
     try:
      t=int(row[0]);o,hi,lo,close,volume=map(float,row[1:6])
     except (ValueError,IndexError):continue
     assert hi>=max(o,close) and lo<=min(o,close) and volume>=0
     rec=(t,o,hi,lo,close,volume)
     if t in res and res[t]!=rec:raise AssertionError(('ZIP_OVERLAP_MISMATCH',sym,t,p))
     res[t]=rec
  out[sym]=sorted(res.values(),key=lambda r:r[0])
  print('SOURCE_READY',sym,'N',len(res),'zip',len(zipfiles),'first',out[sym][0][0],'last',out[sym][-1][0],flush=True)
 return out

def simulate(arr,index,fam):
 """Entry at bar index open, no stop/TP action until bar after prior protection trigger."""
 tp,sl,hold,trig,protect=POLICY[fam]
 epx=arr[index][1]
 assert epx>0
 stop=epx*(1+sl)
 target=epx*(1-tp)
 limit=min(index+hold*12,len(arr)-1)
 # Prevent truncated sample forcing a false time-based gain.
 if arr[limit][0]!=arr[index][0]+hold*H:
  return None
 protective=None;mfe=0.
 px=arr[limit][1];exit_ts=arr[limit][0];reason='TIME'
 for k in range(index,limit):
  op,high,low=arr[k][1:4]
  if high >= min(stop,protective) if protective is not None else high>=stop:
   px=max(op,min(stop,protective) if protective is not None else stop)
   exit_ts=arr[k][0];reason='STOP_OR_TRAIL';break
  if low<=target:
   px=target;exit_ts=arr[k][0];reason='TAKE';break
  mfe=max(mfe,1-low/epx)
  if trig and mfe>=trig:protective=epx*(1-protect)
 return {'net30':100*(1-px/epx)-.30,'exitTs':exit_ts,'reason':reason,
  'entryTs':arr[index][0],'entryPrice':epx,'exitPrice':px}

def choose_family(e):
 signal=set(e['shortSignals'])
 if SIGNALS['A'] in signal:return 'A'
 if SIGNALS['X'] in signal:return 'X'
 if SIGNALS['B'] in signal and e['causalFeatures']['oi3Pct']<=-.2:return 'B'
 return None

def detect(arr,i,mode,window,minconfirm,margin):
 """Return entry index on first qualifying completed bar; only past bars inspected."""
 start=arr[i][0]
 original_open=arr[i][1]
 last=min(i+window,len(arr)-1)
 if i<13:return None
 h1lo=min(r[3] for r in arr[i-12:i])
 m30lo=min(r[3] for r in arr[i-6:i])
 had_rebound=False
 for k in range(i,min(last,len(arr)-2)):
  # completed at arr[k][0]+M; buy/sell at arr[k+1] open
  if arr[k+1][0]-arr[k][0]!=M:break
  if arr[k][2]>=original_open*1.003:had_rebound=True
  close=arr[k][4]
  prev=arr[k-1][4]
  if k<i+minconfirm-1:continue
  if mode=='break_prevH1':
   hit=close<=h1lo*(1-margin)
  elif mode=='break_prev30':
   hit=close<=m30lo*(1-margin)
  elif mode=='bear2':
   hit=(k>i and close<prev<arr[k-2][4] and close<=original_open*(1-margin))
  elif mode=='bear3':
   hit=(k>i+1 and close<arr[k-1][4]<arr[k-2][4]<arr[k-3][4]
         and close<=original_open*(1-margin))
  elif mode=='momentum_15':
   hit=k>=i+2 and close/arr[k-2][1]-1<=-max(margin,.002)
  elif mode=='reject_rebound':
   hit=had_rebound and close<=original_open*(1-margin) and close<prev
  elif mode=='red_volume':
   lookback=[r[5] for r in arr[max(0,k-12):k]]
   hit=(lookback and close< arr[k][1] and close<=original_open*(1-margin)
        and arr[k][5]>=1.5*statistics.median(lookback))
  else:raise ValueError(mode)
  if hit:return k+1
 return None

def metrics(rows,cost):
 x=[z['net30']+(.30-cost/100) for z in rows]
 wins=sum(v>0 for v in x);pos=sum(v for v in x if v>0);neg=-sum(v for v in x if v<=0)
 eq=1.;peak=1.;dd=0.
 for ret in x:
  eq*=1+ret/100;peak=max(peak,eq);dd=min(dd,(eq/peak-1)*100)
 return {'n':len(rows),'wins':wins,'winRatePct':round(wins/len(rows)*100,3) if rows else None,
 'pf':round(pos/neg,4) if neg else None,'compoundPct':round(100*(eq-1),3),
 'closedDdPct':round(dd,3),'sumNetPct':round(sum(x),3)}

def main():
 bank=[e for filename in BANKS for e in json.loads((SRC/filename).read_text('utf8'))['events']]
 bank.sort(key=lambda e:e['t'])
 print('EVENTS',len(bank),flush=True)
 arrs=prices()
 indexes={k:{r[0]:i for i,r in enumerate(v)} for k,v in arrs.items()}
 b_parity={'ok':0,'mismatch':[],'skippedCensor':0}
 all_candidates=[]
 for e in bank:
  fam=choose_family(e)
  if fam is None:continue
  arr=arrs[e['symbol']];idx=indexes[e['symbol']].get(e['t'])
  if idx is None:raise AssertionError(('EVENT_MARK_MISSING',e['symbol'],e['t']))
  model_name='TAKE15_STOP20_H6' if fam=='X' else 'TRAIL_MFE25_FLOOR10_H24'
  orig=e['exitModels'][model_name]
  got=simulate(arr,idx,fam)
  if got is None:
   b_parity['skippedCensor']+=1;continue
  if got['exitTs']!=orig['exitTs'] or abs(got['net30']-orig['net30'])>1e-6:
   b_parity['mismatch'].append((e['symbol'],e['t'],model_name,got,orig))
  else:b_parity['ok']+=1
  all_candidates.append({'event':e,'fam':fam,'arr':arr,'index':idx,'baseline':got})
 print('ORIGINAL_MODEL_PARITY',b_parity['ok'],'MISMATCH',len(b_parity['mismatch']),
  'TRUNCATED',b_parity['skippedCensor'],flush=True)
 if b_parity['mismatch']:
  print('MISMATCH_EXAMPLE',b_parity['mismatch'][:3],flush=True)
  raise AssertionError('BASELINE_NOT_REPRODUCED_DO_NOT_SCREEN')
 assert b_parity['ok']>=190
 # Prefixes 1st 30m, 1st 60m used solely for diagnostic retrospective.
 baseline_bytime=[]
 active={}
 for e in all_candidates:
  t=e['event']['t'];sym=e['event']['symbol']
  if t<active.get(sym,0):continue
  active[sym]=e['baseline']['exitTs']+12*H
  baseline_bytime.append(e)
 print('SELECTED_BASELINE',len(baseline_bytime),flush=True)
 # actual selected sample baseline must match 188; after-Oct 13 included.
 if len(baseline_bytime)!=188:raise AssertionError(('BASELINE_SELECTED_MISMATCH',len(baseline_bytime)))
 diagnostics=[]
 for v in baseline_bytime:
  arr=v['arr'];i=v['index'];base=v['baseline'];dur=base['exitTs']-v['event']['t']
  measured={'t':v['event']['t'],'family':v['fam'],'symbol':v['event']['symbol'],
       'net30':base['net30'],'totalMinutesToExit':dur/M*5}
  for minutes in (15,30,60,120):
   lim=min(i+minutes//5,len(arr)-1)
   # future path only for retrospective attribution, never used to choose as-of trade.
   seen=[r for r in arr[i:lim] if r[0]<base['exitTs']]
   if not seen:continue
   entry=arr[i][1]
   measured['mfe_'+str(minutes)]=round(100*(1-min(x[3] for x in seen)/entry),4)
   measured['mae_'+str(minutes)]=round(100*(max(x[2] for x in seen)/entry-1),4)
   measured['lastCloseRet_'+str(minutes)]=round(100*(1-seen[-1][4]/entry),4)
  diagnostics.append(measured)
 print('ATTRIBUTION_DONE',len(diagnostics),flush=True)
 # Always include baseline; only 37 predeclared causal structural models.
 configs=[{'name':'BASELINE','mode':'none','scope':'none','window':0,'fallback':False,'margin':0,'minconfirm':1}]
 for scope in ('B','A_AND_B'):
  for mode in ('break_prevH1','break_prev30','bear2','bear3','momentum_15','reject_rebound','red_volume'):
   for minutes in (30,60,120):
    for fb in (False,True):
     configs.append({'name':f'{scope}_{mode}_{minutes}M_'+('FALLBACK' if fb else 'REQUIRE'),
       'mode':mode,'scope':scope,'window':minutes//60 if minutes%60==0 else minutes/60,
       'windowMinutes':minutes,'fallback':fb,'margin':.001 if mode not in ('momentum_15','reject_rebound') else .002,
       'minconfirm':1})
 # We will cross-mode test after initial candidates are screened: all configs already fixed.
 results=[]
 for config in configs:
  rows=[]
  inactive_until={}
  triggered=collections.Counter()
  for e in all_candidates:
   t=e['event']['t'];sym=e['event']['symbol'];fam=e['fam']
   if t<inactive_until.get(sym,0):continue
   idx=e['index'];arr=e['arr'];new_idx=idx
   if config['mode']!='none' and (config['scope']=='A_AND_B' or fam=='B'):
    new_idx=detect(arr,idx,config['mode'],config['windowMinutes']//5,
       config['minconfirm'],config['margin'])
    if new_idx is None:
     triggered['missed']+=1
     if not config['fallback']:
      inactive_until[sym]=t+config['windowMinutes']*60000
      continue
     new_idx=idx+config['windowMinutes']//5
     if new_idx>=len(arr) or arr[new_idx][0]!=t+config['windowMinutes']*60000:
      inactive_until[sym]=t+config['windowMinutes']*60000
      continue
     triggered['fallback']+=1
    else:triggered['confirmed']+=1
   sim=simulate(arr,new_idx,fam)
   if sim is None:triggered['no_executable_future_window']+=1;continue
   if sim['entryTs']<t:raise AssertionError('ENTRY_BEFORE_SIGNAL')
   # make the new position own symbol from original signal through exit and cooldown.
   inactive_until[sym]=sim['exitTs']+12*H
   rows.append({'t':t,'entryTs':sim['entryTs'],'symbol':sym,'fam':fam,'net30':sim['net30'],
     'exitTs':sim['exitTs'],'exitReason':sim['reason']})
  stats={key:{str(c):metrics([v for v in rows if lo<=v['t']<hi],c) for c in (10,30)}
         for key,(lo,hi) in PERIODS.items()}
  results.append({'config':config,'triggerCounts':dict(triggered),
    'selectedTradeCount':len(rows),'familyCounts':dict(collections.Counter(x['fam'] for x in rows)),
    'periods':stats})
  if len(results)%15==0:print('DONE_CASES',len(results),'of',len(configs),flush=True)
 base=results[0]
 assert [base['periods'][y]['30']['n'] for y in PERIODS]==[70,45,19,41,13]
 assert [base['periods'][y]['30']['pf'] for y in PERIODS]==[1.1579,1.6853,1.131,2.4013,1.1998]
 b={'results':results,'status':'RESEARCH_ONLY_NO_NATIVE_NO_LIVE',
    'bankBaselineParity':b_parity,
    'priorYearsUsed':'All periods previously viewed; no pristine holdout',
    'source':'Binance Vision official M5 archives, previously verified; ZIP CRC/testzip checked',
    'entryEventCount':len(bank),'baselineSelectedTrades':len(baseline_bytime),
    'warnings':['entry decisions only after confirmed completed M5, next M5 open',
      'exits dynamically resimulated with new entry price; hard stop first',
      'every candidate redoes ownership and 12h cooldown, no extra FOMO same symbol',
      'no real venue fills / funding / portfolio MTM DD',
      '2026Aug-Oct already explored retrospective window, not pristine holdout']}
 out=OUT/'render_4427_causal_delayed_entry_confirmation_screen_20261024.json'
 out.write_text(json.dumps(b,ensure_ascii=False,indent=2)+'\n','utf8')
 diag=OUT/'render_4427_selected_trade_5m_first_120min_attribution_20261024.json'
 diag.write_text(json.dumps({'warnings':['ex post path diagnostic, not causal feature used by entry'],'records':diagnostics},
                           ensure_ascii=False,indent=2)+'\n','utf8')
 feasible=[]
 for r in results[1:]:
  # strict by chronology and equal-bar comparability before any Native8 run
  cond=all(r['periods'][y]['30']['n']>=max(5,int(base['periods'][y]['30']['n']*.90))
         and (r['periods'][y]['30']['pf'] or 0)>=1.0 and
          r['periods'][y]['30']['compoundPct']>=base['periods'][y]['30']['compoundPct']
          and r['periods'][y]['30']['closedDdPct']>=base['periods'][y]['30']['closedDdPct']-.01
          for y in PERIODS)
  if cond:feasible.append(r)
 print('STRICT_5PERIODS_30BPS_NONDEGRADATION_N',len(feasible),flush=True)
 print('BASELINE',[(y,base['periods'][y]['30']) for y in PERIODS],flush=True)
 for r in sorted(results[1:],key=lambda x:(
  -(x['periods']['2025H2']['30']['compoundPct']-base['periods']['2025H2']['30']['compoundPct']),
  -(x['periods']['2026JanAug']['30']['compoundPct']-base['periods']['2026JanAug']['30']['compoundPct'])
  ))[:18]:
  print('CANDIDATE',r['config']['name'],'COUNT',r['selectedTradeCount'],
  '2024',r['periods']['2024']['30'],'25H2',r['periods']['2025H2']['30'],
  '26JAN',r['periods']['2026JanAug']['30'],'26POST',r['periods']['2026AugOct']['30'],flush=True)
 print('SAVED',out,diag,flush=True)

if __name__=='__main__':main()
