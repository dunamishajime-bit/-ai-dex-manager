#!/usr/bin/env python3
"""Causal selective B SHORT entry delay (pre-entry state -> M5 confirmation).
Control #4427 A/X routes always immediate. Completed 1h/4h/1D, OI lagged.
Source M5 exact replay and no retrospective calendar feature.
"""
from __future__ import annotations
import collections,hashlib,json,importlib.util,math
from pathlib import Path

ROOT=Path('C:/tmp')
OUT=ROOT/'render-mtf-study-20261024'
SRC=ROOT/'render-multiregime-study-20261024/docs/research/results/render-three-regime-20261024'
def load(p):
 spec=importlib.util.spec_from_file_location('render_causal_confirm_screener',p)
 m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
m=load(Path(__file__).resolve().parent/'render-4427-causal-m5-confirmed-delayed-entry-20261024.py')
M=m.M;H=m.H
ENTRY_CHOICES=[
 ('B_bear2_30min', 'bear2',30,.001),
 ('B_break30_30min','break_prev30',30,.001),
 ('B_momentum_60min','momentum_15',60,.002),
 ('B_reject_60min','reject_rebound',60,.002),
]
STATE_CHOICES={
 'OI_weaker_deleveraging':lambda e,h4,d1:e['causalFeatures']['oi3Pct']>=-.6,
 'OI_stronger_deleveraging':lambda e,h4,d1:e['causalFeatures']['oi3Pct']<=-1,
 'Last_H1_green':lambda e,h4,d1:e['causalFeatures']['ret1']>=0,
 'Last_H1_red':lambda e,h4,d1:e['causalFeatures']['ret1']<0,
 'H4_green':lambda e,h4,d1:h4 is not None and h4>=0,
 'H4_red':lambda e,h4,d1:h4 is not None and h4<0,
 'D1_green':lambda e,h4,d1:d1 is not None and d1>=0,
 'D1_red':lambda e,h4,d1:d1 is not None and d1<0,
 'BTC_H1_positive':lambda e,h4,d1:e['causalFeatures']['btc1']>=0,
 'BTC_24H_positive':lambda e,h4,d1:e['causalFeatures']['btc24']>=0,
 'RENDER_rel6_positive':lambda e,h4,d1:e['causalFeatures']['rel6']>=0,
 'RangePos1_upper':lambda e,h4,d1:e['causalFeatures']['rangePos1']>=.35,
 'VolumeRatio_low':lambda e,h4,d1:e['causalFeatures']['volumeRatio']<=.8,
 'SellerImbalance_low':lambda e,h4,d1:e['causalFeatures']['seller1']<=.10,
 'WickLarge':lambda e,h4,d1:e['causalFeatures']['hourWick']>=1,
 'RENDER_24h_down':lambda e,h4,d1:e['causalFeatures']['ret24']<0,
 'OI_negative_and_H4_green':lambda e,h4,d1:h4 is not None and h4>=0 and e['causalFeatures']['oi3Pct']>=-.6,
 'OI_negative_and_H4_red':lambda e,h4,d1:h4 is not None and h4<0 and e['causalFeatures']['oi3Pct']>=-.6,
}
def tf(arr,ix,t,step):
 end=t-t%step
 idx_by_timestamp=getattr(tf,'idx',None)
 # Indexed global map set by main.
 v=idx_by_timestamp.get((arr[0][0],end-step))
 last=idx_by_timestamp.get((arr[0][0],end-M))
 if v is None or last is None or last-v+1!=step//M or arr[last][0]-arr[v][0]!=step-M:
  return None
 return 100*(arr[last][4]/arr[v][1]-1)
def main():
 bank=sorted([e for f in m.BANKS for e in json.loads((SRC/f).read_text('utf8'))['events']],key=lambda x:x['t'])
 bars=m.prices()
 timestamps={sym:{row[0]:ix for ix,row in enumerate(rows)} for sym,rows in bars.items()}
 tf.idx={(rows[0][0],row[0]):ix for sym,rows in bars.items() for ix,row in enumerate(rows)}
 enriched=[]
 for e in bank:
  fam=m.choose_family(e)
  if fam is None:continue
  arr=bars[e['symbol']];i=timestamps[e['symbol']].get(e['t'])
  assert i is not None
  orig=m.simulate(arr,i,fam)
  assert orig is not None
  expected=e['exitModels']['TAKE15_STOP20_H6' if fam=='X' else 'TRAIL_MFE25_FLOOR10_H24']
  assert orig['exitTs']==expected['exitTs'] and abs(orig['net30']-expected['net30'])<1e-6
  state=(tf(arr,i,e['t'],4*H),tf(arr,i,e['t'],24*H)) if fam=='B' else (None,None)
  versions={}
  if fam=='B':
   for name,mode,window,margin in ENTRY_CHOICES:
    at=m.detect(arr,i,mode,window//5,1,margin)
    if at is None:
     at=i+window//5
     if at>=len(arr) or arr[at][0]!=e['t']+window*60000:
      continue
    outcome=m.simulate(arr,at,fam)
    if outcome is not None:versions[name]=outcome
  enriched.append({'e':e,'fam':fam,'arr':arr,'index':i,'immediate':orig,'versions':versions,
       'h4':state[0],'d1':state[1]})
 print('FROZEN_SIGNAL_EVENTS',len(bank),'ELIGIBLE',len(enriched),'STATE_MISSING',
     sum(x['h4'] is None or x['d1'] is None for x in enriched if x['fam']=='B'),flush=True)
 def run(state_key,model_key):
  rows=[];locked={}
  for info in enriched:
   e=info['e'];t=e['t'];sym=e['symbol'];fam=info['fam']
   if t<locked.get(sym,0):continue
   delayed=fam=='B' and STATE_CHOICES[state_key](e,info['h4'],info['d1'])
   outcome=info['versions'].get(model_key) if delayed else info['immediate']
   if outcome is None:raise AssertionError(('MISSING_DELAYED_EXIT',state_key,model_key,sym,t))
   locked[sym]=outcome['exitTs']+12*H
   rows.append({'t':t,'fam':fam,'symbol':sym,'net30':outcome['net30'],
       'entryTs':outcome['entryTs'],'exitTs':outcome['exitTs'],'delayed':delayed})
  return rows
 rs=[]
 baseline=[]
 lock={}
 for v in enriched:
  t=v['e']['t'];sym=v['e']['symbol'];out=v['immediate']
  if t<lock.get(sym,0):continue
  lock[sym]=out['exitTs']+12*H
  baseline.append({'t':t,'net30':out['net30'],'fam':v['fam']})
 assert len(baseline)==188
 def summary(rows):
  return {y:{str(c):m.metrics([z for z in rows if lo<=z['t']<hi],c)
            for c in (10,30)} for y,(lo,hi) in m.PERIODS.items()}
 old=summary(baseline)
 candidates=[]
 for state in STATE_CHOICES:
  for mod in (t[0] for t in ENTRY_CHOICES):
   tr=run(state,mod)
   met=summary(tr)
   gating={}
   for y in m.PERIODS:
    a=met[y]['30'];b=old[y]['30']
    gating[y]=a['n']==b['n'] and (a['pf'] or 0)>=1 and a['compoundPct']>=b['compoundPct'] and a['closedDdPct']>=b['closedDdPct']
   candidates.append({'state':state,'entry':mod,'meta':met,
      'strictNoLossAll5':all(gating.values()),'cost30ByPeriodPass':gating,
      'entryReclassifiedCount':sum(z['delayed'] for z in tr),
      'selectedTradeCount':len(tr)})
 print('BASELINE',old,flush=True)
 print('TOTAL',len(candidates),'STRICT_ALL5',sum(x['strictNoLossAll5'] for x in candidates),flush=True)
 for x in sorted(candidates,key=lambda z:(
    -sum(z['cost30ByPeriodPass'].values()),
    -(z['meta']['2025H2']['30']['compoundPct']-old['2025H2']['30']['compoundPct'])))[:30]:
  print('CAND',x['state'],x['entry'],'PASS',x['cost30ByPeriodPass'],
    'N',x['selectedTradeCount'],'H2',x['meta']['2025H2']['30'],
    'H1',x['meta']['2025H1']['30'],
    '2024',x['meta']['2024']['30'],'2026',x['meta']['2026JanAug']['30'],
    'LATE',x['meta']['2026AugOct']['30'],flush=True)
 out={'status':'RESEARCH_ONLY_ASOF_STRUCTURAL_B_SHORT_SELECTIVE_CONFIRMATION',
      'bankBaselineParity':'Exact 235 selected signal exits verified',
      'preentryStateFeatures':list(STATE_CHOICES),
      'newWindowModes':[z[0] for z in ENTRY_CHOICES],
      'costBps':[10,30], 'cases':len(candidates),'strictAll5':sum(x['strictNoLossAll5'] for x in candidates),
      'baseline':old,'candidateSummaries':candidates,
      'caveats':['All historical time windows were reviewed previously: non-pristine retrospective',
       'Entry price and TP/STOP dynamically recalculated; confirm at next completed M5',
       'No shared-wallet Native8 until cross-period robustness established',
       'Preserve original symbol cooldown, old/new contract separate',
       'No LIVE, VPS, production, funds or real orders touched']}
 p=OUT/'render_4427_selective_confirm_with_asof_oi_1h_4h_1d_20261024.json'
 p.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n','utf8')
 print('SAVED',p,flush=True)
if __name__=='__main__':main()
