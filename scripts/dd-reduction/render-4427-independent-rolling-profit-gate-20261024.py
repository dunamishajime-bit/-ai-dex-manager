#!/usr/bin/env python3
"""Independent short gate with as-of rolling profit/WR/PF admission and
original #4427 protected priority. All cost scenarios are retrospective.
"""
from __future__ import annotations
import collections,datetime as dt,gzip,json,math,statistics
from pathlib import Path
ROOT=Path('C:/tmp/render-mtf-study-20261024')
M=300000;H=3600000;D=24*H
PERIODS={
'2024':(1704067200000,1735689600000),'2025H1':(1735689600000,1754006400000),
'2025H2':(1754006400000,1767225600000),'2026JanAug':(1767225600000,1786320000000),
'2026AugOct':(1786320000000,1792800000000)
}
with gzip.open(ROOT/'RENDER_4427_INDEPENDENT_ALL_GATE_SHADOW_ENTRY_BANK_20261024.json.gz','rt',encoding='utf8') as stream:
 DATA=json.load(stream)['rows']
DATA.sort(key=lambda x:x['t'])
FAMILIES=['TREND_BREAK','TREND_PRESSURE','REBOUND_FAIL','PULLBACK_FADE','FALSE_BREAKOUT','SELL_IMBALANCE','BTC_RENDER_DIVERGE']
def stats(rows,cost):
 x=[r['net30']+(.30-cost/100) for r in rows];win=sum(v>0 for v in x)
 gains=sum(v for v in x if v>0);loss=-sum(v for v in x if v<0)
 eq=peak=1.;dd=0.
 for v in x:
  eq*=1+v/100;peak=max(eq,peak);dd=min(dd,(eq/peak-1)*100)
 return {'n':len(x),'wins':win,'wrPct':round(win/len(x)*100,2) if x else None,
  'pf':round(gains/loss,4) if loss else None,'compoundPct':round((eq-1)*100,3),
  'closedDdPct':round(dd,3)}
def hist_score(xs):
 n=len(xs);pos=[x for x in xs if x>0];neg=[-x for x in xs if x<0]
 return {'n':n,'wr':len(pos)/n if n else 0,'mean':sum(xs)/n if n else 0,
   'pf':sum(pos)/sum(neg) if neg else (5 if n>=3 else 0)}
def replay(config,events=DATA,save=False):
 ledger=collections.defaultdict(list);cursor=0
 hist_ends=sorted([(z['exitTs'],z['family']+'__'+z['exit'],z['net30'])
     for e in events for z in e['candidates']],key=lambda x:x[0])
 locked={};newlock=-1;selected=[];counts=collections.Counter()
 for item in events:
  t=item['t'];sym=item['sym']
  while cursor<len(hist_ends) and hist_ends[cursor][0]<t:
   ex,key,net=hist_ends[cursor]
   ledger[key].append((ex,net));cursor+=1
  if t<locked.get(sym,0):continue
  finalists=[];oldoptions=[]
  for c in item['candidates']:
   fam=c['family'];ex=c['exit'];kind=c['kind']
   if kind=='INDEPENDENT' and ex!=config.get('routeRules',{}).get(fam,{}).get('exit',config['exit']):continue
   if kind=='INDEPENDENT' and fam not in config['families']:continue
   h=ledger[fam+'__'+ex]
   recent90=[v for end,v in h if t-90*D<=end<t]
   recent180=[v for end,v in h if t-180*D<=end<t]
   rec30=[v for end,v in h if t-30*D<=end<t]
   rec365=[v for end,v in h if t-365*D<=end<t]
   s90=hist_score(recent90);s180=hist_score(recent180);s30=hist_score(rec30);s365=hist_score(rec365)
   f=item['features']
   if kind=='INDEPENDENT':
    if t<newlock:counts['failed_new_cap']+=1;continue
    gate=config.get('routeRules',{}).get(fam,{}).get('policy',config['policy'])
    passing={
     'ninety_strict':s90['n']>=12 and s90['wr']>=.65 and s90['pf']>=1.4 and s90['mean']>=.12,
     'ninety_mid':s90['n']>=10 and s90['wr']>=.60 and s90['pf']>=1.2 and s90['mean']>=0,
     'ninety_loose':s90['n']>=7 and s90['wr']>=.58 and s90['pf']>=1.2 and s90['mean']>=0,
     'dual_90_180':s90['n']>=8 and s90['pf']>=1.1 and s180['n']>=20 and s180['pf']>=1.25 and s180['wr']>=.59,
     'recent30_180':s30['n']>=5 and s30['pf']>=1.3 and s30['wr']>=.65 and s180['n']>=16 and s180['pf']>=1.15,
     'long365_90':s365['n']>=25 and s365['pf']>=1.4 and s90['n']>=7 and s90['pf']>=1.2,
     'improving_90':s90['n']>=10 and s90['wr']>=.62 and s90['pf']>=1.3 and s180['n']>=18 and s90['wr']>=s180['wr']+.02,
     'conservative_180':s180['n']>=20 and s180['pf']>=1.4 and s180['wr']>=.65,
    }
    if not passing[gate]:counts['rejected_shadow_'+fam]+=1;continue
    if config['structure']=='bear_h4' and f['h4']>=0:continue
    if config['structure']=='bear_d1' and f['d1']>=0:continue
    if config['structure']=='bear_both' and not(f['h4']<0 and f['d1']<0):continue
    if config['structure']=='sell54' and f['sellPct']<.54:continue
    if config['structure']=='sell56' and f['sellPct']<.56:continue
    if config['structure']=='vol1p0' and f['volRatio']<1.0:continue
   n=s180['n'];recentWR=(sum(v>0 for v in recent180)+4)/(n+8)
   recentMean=sum(recent180)/(n+8)
   score=50*recentWR+18*max(-1,min(1,recentMean))
   score+=12*max(0,min(1,(f['sellPct']-.5)*10))
   score+=8*max(0,min(1,-f['h4']/2))
   score+=5*max(0,min(1,-f['d1']/3))
   score+=4*max(0,min(1,f['volRatio']-1))
   score+=config['oldBonus'] if kind=='ORIGINAL' else 0
   data={'score':score,'candidate':c,'recent90':s90,'recent180':s180}
   finalists.append(data)
   if kind=='ORIGINAL':oldoptions.append(data)
  if not finalists:continue
  # Pre-commit to protecting original gate except when independent has
  # strictly higher causally known predictive score + requested margin.
  finalists.sort(key=lambda z:(z['score'],z['candidate']['kind']=='ORIGINAL',z['candidate']['family']),reverse=True)
  chosen=finalists[0]
  if oldoptions and chosen['candidate']['kind']=='INDEPENDENT':
   orig=max(oldoptions,key=lambda z:z['score'])
   if chosen['score']<orig['score']+config['upgradeMargin']:
    chosen=orig;counts['protect_original_overlap']+=1
  c=chosen['candidate'];locked[sym]=c['exitTs']+12*H
  if c['kind']=='INDEPENDENT':
   newlock=c['exitTs']+config['newCooldownHours']*H
  trade={'sym':sym,'t':t,'family':c['family'],'kind':c['kind'],'exit':c['exit'],
    'net30':c['net30'],'entry':c['entry'],'exitTs':c['exitTs'],
    'score':round(chosen['score'],4),'gateCompetitors':len(finalists)-1}
  selected.append(trade)
  counts['selected_'+c['family']]+=1
  if len(finalists)>1:counts['live_overlap_h1']+=1
 ret={'selectedTrades':len(selected),'addedIndependents':sum(z['kind']=='INDEPENDENT' for z in selected),
  'byFamily':dict(collections.Counter(z['family'] for z in selected)),
  'selectionReasons':dict(counts),'periods':{
   y:{str(cost):stats([z for z in selected if a<=z['t']<b],cost)
     for cost in (10,30)} for y,(a,b) in PERIODS.items()}}
 if save:ret['trades']=selected
 return ret
BASE_CONF={'families':[],'exit':'S6','policy':'ninety_strict','oldBonus':6,
  'upgradeMargin':0,'structure':'any','newCooldownHours':12}
def main():
 base=replay(BASE_CONF)
 assert base['selectedTrades']==188
 assert [base['periods'][x]['30']['n'] for x in PERIODS]==[70,45,19,41,13]
 print('BASELINE',base['periods']['2025H2']['30'],flush=True)
 configs=[]
 policies=['ninety_strict','ninety_mid','dual_90_180','improving_90','recent30_180']
 family_sets=[[r] for r in FAMILIES]+[
  ['TREND_BREAK','REBOUND_FAIL'],
  ['TREND_BREAK','TREND_PRESSURE','REBOUND_FAIL'],
  ['TREND_BREAK','TREND_PRESSURE','REBOUND_FAIL','PULLBACK_FADE','FALSE_BREAKOUT','SELL_IMBALANCE'],
  FAMILIES]
 # Keep a manageable conceptually distinct grid (<1000).
 for fs in family_sets:
  for ex in ('S6','S12','T24'):
   for policy in policies:
    for context in ('any','bear_h4'):
     for bonus in (8,):
      configs.append({'families':fs,'exit':ex,'policy':policy,'oldBonus':bonus,
       'upgradeMargin':8,'structure':context,'newCooldownHours':12})
 print('GRID',len(configs),flush=True)
 runs=[]
 for i,c in enumerate(configs):
  z=replay(c)
  if i%180==0:print('RUN',i,flush=True)
  period=z['periods']
  valid=all(
   period[yr]['30']['compoundPct']>=base['periods'][yr]['30']['compoundPct'] and
   period[yr]['30']['closedDdPct']>=base['periods'][yr]['30']['closedDdPct'] and
   period[yr]['30']['n']>=base['periods'][yr]['30']['n'] and
   period[yr]['10']['compoundPct']>=base['periods'][yr]['10']['compoundPct']
   for yr in PERIODS)
  z['config']=c;z['strictAllFiveMaintains']=valid
  z['hasRealNewOpportunity']=z['addedIndependents']>=5
  runs.append(z)
 good=[r for r in runs if r['strictAllFiveMaintains'] and r['hasRealNewOpportunity']]
 print('RISK_GATED_GENUINE_ROBUST',len(good),'OF',len(runs),flush=True)
 for r in sorted(good,key=lambda r:-r['periods']['2025H2']['30']['compoundPct'])[:10]:
  print('SURVIVES',r['config'],'NEW',r['addedIndependents'],'H2',r['periods']['2025H2']['30'],
    '2024',r['periods']['2024']['30'],'2026',r['periods']['2026JanAug']['30'],
    'LATE',r['periods']['2026AugOct']['30'],flush=True)
 for r in sorted(runs,key=lambda r:(
  -sum(r['periods'][p]['30']['compoundPct']>=base['periods'][p]['30']['compoundPct']
    for p in PERIODS),
  -r['periods']['2025H2']['30']['compoundPct']))[:12]:
  print('BEST_FIT',r['config'],'ADDED',r['addedIndependents'],
    '2024',r['periods']['2024']['30'],
    '25H1',r['periods']['2025H1']['30'],
    '25H2',r['periods']['2025H2']['30'],
    '26JAN',r['periods']['2026JanAug']['30'],
    '26LATE',r['periods']['2026AugOct']['30'],flush=True)
 dest=ROOT/'RENDER_4427_INDEPENDENT_ROLLING_CLOSED_SHADOW_RISK_GATE_20261024.json.gz'
 with gzip.open(dest,'wt',encoding='utf8',compresslevel=6) as f:
  json.dump({'status':'RESEARCH_ONLY_ROLLING_CAUSAL_GATE_NOT_ADOPTED',
   'method':'asof history of completely closed shadow trades 30/90/180/365d, PF/win/mean thresholds and priority owner',
   'cases':runs,'baseline':base,'genuineAccepted':len(good),
   'previousResultsNotPristineHoldout':True,
   'rawShadowFullBank':'RENDER_4427_INDEPENDENT_ALL_GATE_SHADOW_ENTRY_BANK_20261024.json.gz'},
    f,ensure_ascii=False,separators=(',',':'))
 print('SAVED',dest,dest.stat().st_size,flush=True)
if __name__=='__main__':main()
