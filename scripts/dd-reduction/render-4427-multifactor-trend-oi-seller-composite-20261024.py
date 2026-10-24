#!/usr/bin/env python3
"""RENDER 4427 multi-factor causal routing, research only.

Structural hypotheses are combinations of completed H1/H4/D1 trend,
observable OI, BTC and relative strength, aggressive selling, location within
prior H1 candle. The joint pattern decides whether B SHORT enters immediately
or waits up to 30/60m for completed M5 seller confirmation, with unconditional
fallback at deadline to retain coverage. Reprice all exits from delayed entry.
Historical windows are previously viewed; NOT pristine OOS.
"""
from __future__ import annotations
import collections,hashlib,importlib.util,json,math,statistics,sys
from pathlib import Path
ROOT=Path('C:/tmp')
REPO=ROOT/'render-multiregime-study-20261024'
HERE=REPO/'scripts/dd-reduction'
OUT=ROOT/'render-mtf-study-20261024'
BANK=REPO/'docs/research/results/render-three-regime-20261024'
def load(n,p):
 spec=importlib.util.spec_from_file_location(n,p)
 obj=importlib.util.module_from_spec(spec);sys.modules[spec.name]=obj;spec.loader.exec_module(obj);return obj
m=load('composite_source_render_m5',HERE/'render-4427-causal-m5-confirmed-delayed-entry-20261024.py')
H=m.H;M=m.M
# Predicates expressed exclusively with data that were final BEFORE signal time.
def signal_features(e,h4,d1):
 f=e['causalFeatures'];oi=f['oi3Pct']
 return {
  'h4up':h4 is not None and h4>=0,
  'h4down':h4 is not None and h4<0,
  'd1up':d1 is not None and d1>=0,
  'd1down':d1 is not None and d1<0,
  'range_up':f['rangePos1']>=.35,
  'range_bottom':f['rangePos1']<.35,
  'oi_weak':oi>=-.6,
  'oi_strong':oi<=-1,
  'oi_change_rebound':f['oi1Pct']>=0,
  'btc_rise':f['btc24']>=0,
  'btc_fall':f['btc24']<0,
  'btc_h1rise':f['btc1']>=0,
  'rel_positive':f['rel6']>=0,
  'rel_weak':f['rel6']<=-.7,
  'seller_weak':f['seller1']<=.1,
  'seller_strong':f['seller1']>.1,
  'seller_weakening':f['sellerAcceleration']<=0,
  'seller_strengthening':f['sellerAcceleration']>=.1,
  'h1rebound':f['ret1']>=0,
  'h1drop':f['ret1']<0,
  'rv_high':f['renderRV7']>=5,
  'vol_low':f['volumeRatio']<.8,
  'vol_high':f['volumeRatio']>=1.2,
  'prior_rebound_high':f['priorRebound']>=2,
  'wick_high':f['hourWick']>=1,
 }
# Up-front conceptual state machines (never calendar/retrospective cohort splits).
P={
 'range_oi_h4up':['range_up','oi_weak','h4up'],
 'range_oi_d1up':['range_up','oi_weak','d1up'],
 'range_oi_sellerweak':['range_up','oi_weak','seller_weak'],
 'range_btc_rel_up':['range_up','btc_rise','rel_positive'],
 'h4up_oi_sellerweak':['h4up','oi_weak','seller_weak'],
 'h4up_btc_sellerweak':['h4up','btc_rise','seller_weak'],
 'h4up_btc_h1rebound':['h4up','btc_rise','h1rebound'],
 'h4up_oi_btc':['h4up','oi_weak','btc_rise'],
 'h4up_rel_range':['h4up','rel_positive','range_up'],
 'd1up_h4up_range':['d1up','h4up','range_up'],
 'd1up_oi_sellerweak':['d1up','oi_weak','seller_weak'],
 'd1up_btc_range':['d1up','btc_rise','range_up'],
 'd1up_h1rebound_range':['d1up','h1rebound','range_up'],
 'h4down_oiweak_range':['h4down','oi_weak','range_up'],
 'h4down_btc_range':['h4down','btc_rise','range_up'],
 'h4down_rel_sellerweak':['h4down','rel_positive','seller_weak'],
 'h4down_h1rebound_range':['h4down','h1rebound','range_up'],
 'oi_weak_sellerweak_h1rebound':['oi_weak','seller_weak','h1rebound'],
 'oi_weak_btc_sellerweak':['oi_weak','btc_rise','seller_weak'],
 'oi_rebound_sellerweak_range':['oi_change_rebound','seller_weak','range_up'],
 'oi_rebound_h4up_rel':['oi_change_rebound','h4up','rel_positive'],
 'h4up_sellerweak_wick':['h4up','seller_weak','wick_high'],
 'btc_rise_rel_strong_sellerweak':['btc_rise','rel_positive','seller_weak'],
 'btc_rise_rel_weak_range':['btc_rise','rel_weak','range_up'],
 'btc_fall_oiweak_range':['btc_fall','oi_weak','range_up'],
 'btc_fall_h4down_oiweak':['btc_fall','h4down','oi_weak'],
 'h4down_oi_strong_vol_low':['h4down','oi_strong','vol_low'],
 'h4down_oi_weak_vol_high':['h4down','oi_weak','vol_high'],
 'h4up_oi_weak_vol_low':['h4up','oi_weak','vol_low'],
 'h4down_sellerweak_vol_low':['h4down','seller_weak','vol_low'],
 'h4up_wick_rvhigh':['h4up','wick_high','rv_high'],
 'h4down_wick_rvhigh':['h4down','wick_high','rv_high'],
 'range_h1rebound_oiweak':['range_up','h1rebound','oi_weak'],
 'range_h1rebound_sellerweak':['range_up','h1rebound','seller_weak'],
 'range_priorebound_oiweak':['range_up','prior_rebound_high','oi_weak'],
 'range_oi_sellweak_btc':['range_up','oi_weak','seller_weak','btc_rise'],
 'range_h4up_sellweak_oi':['range_up','h4up','seller_weak','oi_weak'],
 'range_d1up_h4up_oi':['range_up','d1up','h4up','oi_weak'],
 'range_h4down_btc_oi':['range_up','h4down','btc_rise','oi_weak'],
 'range_h4up_btc_oi':['range_up','h4up','btc_rise','oi_weak'],
}
# Thresholds are a complexity test, NOT fitted by years. >= all or >= all-1.
POLICIES=[
 ('break30',('break_prev30',30,.001)),
 ('bear2',('bear2',30,.001)),
 ('bear3',('bear3',60,.001)),
 ('momentum',('momentum_15',60,.002)),
 ('rebound',('reject_rebound',60,.002)),
 ('volume',('red_volume',60,.001))
]
def completed(arr,idx_by_time,t,length):
 end=t-t%length;beg=end-length;last=end-M
 i=idx_by_time.get(beg);j=idx_by_time.get(last)
 if i is None or j is None or j-i+1!=length//M or arr[j][0]-arr[i][0]!=length-M:return None
 return 100*(arr[j][4]/arr[i][1]-1)
def main():
 events=sorted([e for f in m.BANKS for e in json.loads((BANK/f).read_text('utf8'))['events']],key=lambda r:r['t'])
 bars=m.prices()
 marks={sym:{z[0]:i for i,z in enumerate(zs)} for sym,zs in bars.items()}
 data=[]
 for e in events:
  fam=m.choose_family(e)
  if fam is None:continue
  sym=e['symbol'];t=e['t'];xs=bars[sym];idx=marks[sym][t]
  original=m.simulate(xs,idx,fam)
  assert original is not None
  prev=e['exitModels']['TAKE15_STOP20_H6' if fam=='X' else 'TRAIL_MFE25_FLOOR10_H24']
  assert abs(original['net30']-prev['net30'])<1e-6 and original['exitTs']==prev['exitTs']
  completed_h4=completed(xs,marks[sym],t,4*H) if fam=='B' else None
  completed_d1=completed(xs,marks[sym],t,24*H) if fam=='B' else None
  ff=signal_features(e,completed_h4,completed_d1) if fam=='B' else {}
  delays={}
  if fam=='B':
   for k,(mode,minut,margin) in POLICIES:
    at=m.detect(xs,idx,mode,minut//5,1,margin)
    if at is None:at=idx+minut//5
    assert xs[at][0]==t+minut*60000 or t<xs[at][0]<t+minut*60000
    zz=m.simulate(xs,at,fam)
    assert zz is not None
    delays[k]=zz
  data.append({'e':e,'fam':fam,'original':original,'features':ff,'delays':delays})
 print('READY_ELIGIBLE',len(data),'B',sum(x['fam']=='B' for x in data),flush=True)
 def select(cond=None,policy=None):
  locked={};ret=[]
  for p in data:
   e=p['e'];sym=e['symbol'];t=e['t'];fam=p['fam']
   if t<locked.get(sym,0):continue
   delayed=bool(fam=='B' and cond and cond(p['features']))
   z=p['delays'][policy] if delayed else p['original']
   locked[sym]=z['exitTs']+12*H
   ret.append({'t':t,'fam':fam,'net30':z['net30'],'delayed':delayed,'deltaTime':z['entryTs']-t})
  return ret
 base=select()
 assert len(base)==188
 def stats(rows):
  return {name:{str(cost):m.metrics([q for q in rows if a<=q['t']<b],cost)
    for cost in (10,30)} for name,(a,b) in m.PERIODS.items()}
 old=stats(base)
 out=[]
 for name,flags in P.items():
  for needed in (len(flags),len(flags)-1):
   if needed<2:continue
   for pol,_ in POLICIES:
    cond=lambda f,flags=flags,needed=needed:sum(bool(f[x]) for x in flags)>=needed
    sample=select(cond,pol)
    sc=stats(sample)
    pass30=all(
      sc[per]['30']['n']==old[per]['30']['n'] and
      sc[per]['30']['compoundPct']>=old[per]['30']['compoundPct'] and
      sc[per]['30']['closedDdPct']>=old[per]['30']['closedDdPct'] and
      (sc[per]['30']['pf'] or 0)>=(old[per]['30']['pf'] or 0)
      for per in m.PERIODS)
    pass10=all(
      sc[per]['10']['n']==old[per]['10']['n'] and
      sc[per]['10']['compoundPct']>=old[per]['10']['compoundPct'] and
      sc[per]['10']['closedDdPct']>=old[per]['10']['closedDdPct']
      for per in m.PERIODS)
    h2=sc['2025H2']['30'];b2=old['2025H2']['30']
    out.append({'rule':name,'factors':flags,'factorThreshold':needed,'model':pol,
      'selectedTradeCount':len(sample),'delayedTradeCount':sum(v['delayed'] for v in sample),
      'allFive30BpsPass':pass30,'allFive10BpsPass':pass10,
      'h2CompoundGainPctPts':round(h2['compoundPct']-b2['compoundPct'],3),
      'h2WrGainPctPts':round(h2['winRatePct']-b2['winRatePct'],3),
      'periods':sc})
 print('PREDECLARED_MULTIFACTOR_COMPOSITES',len(out),'FULL_PASS_BOTH_COSTS',
       sum(r['allFive30BpsPass'] and r['allFive10BpsPass'] for r in out),flush=True)
 better=[r for r in out if r['allFive30BpsPass'] and r['allFive10BpsPass'] and r['h2CompoundGainPctPts']>=.2]
 print('FULL_PASS_AND_H2_PROFIT_IMPROVE',len(better),flush=True)
 for z in sorted(better,key=lambda x:-x['h2CompoundGainPctPts'])[:20]:
  print('PARETO',z['rule'],z['factorThreshold'],z['model'],
   'DELAY_N',z['delayedTradeCount'],'H2',z['periods']['2025H2']['30'],
   '24',z['periods']['2024']['30']['compoundPct'],
   '25H1',z['periods']['2025H1']['30']['compoundPct'],
   '26JAN',z['periods']['2026JanAug']['30']['compoundPct'],
   '26LATE',z['periods']['2026AugOct']['30']['compoundPct'],flush=True)
 print('TOP_H2_UNCONSTRAINED',flush=True)
 for z in sorted(out,key=lambda x:-x['h2CompoundGainPctPts'])[:6]:
  print('RANK',z['rule'],z['factorThreshold'],z['model'],z['h2CompoundGainPctPts'],
      'N',z['selectedTradeCount'],'2024',z['periods']['2024']['30']['compoundPct'],
      '25H1',z['periods']['2025H1']['30']['compoundPct'],
      '26JAN',z['periods']['2026JanAug']['30']['compoundPct'],
      'LATE',z['periods']['2026AugOct']['30']['compoundPct'],flush=True)
 dest=OUT/'RENDER_4427_MULTIFACTOR_CAUSAL_ROUTING_SCREEN_20261024.json'
 dest.write_text(json.dumps({'status':'RESEARCH_ONLY_NO_APPROVAL',
  'asof':'2026-10-24','candidateCount':len(out),'originalEligible':len(data),
  'baseTradeCount':len(base),'baseline':old,'results':out,
  'assumptions':['confirmed H1/H4/D1 as of signal, lagged OI, 5m next-open',
    'Original signal policies, original 12h cooldown and exposure contract',
    '30m/60m fallback preserves trade count but entry may be worse',
    'All five time slices previously researched (NOT pristine OOS)',
    'Not Aster M5 authenticated fills; no Native8 unless portfolio economics improve']},
  ensure_ascii=False,indent=2)+'\n','utf8')
 print('SAVED',dest,flush=True)
if __name__=='__main__':main()
