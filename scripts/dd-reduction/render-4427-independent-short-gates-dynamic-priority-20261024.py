#!/usr/bin/env python3
"""RENDER: independent no-OI SHORT gates and causal dynamic priority (research only).

Use official Binance 5m candles with aggressive sell volume, structurally
independent gates scanned on EVERY completed H1, not just existing #4427 signals.
On same H1, choose the highest score using ONLY completed shadow-trade outcomes
from prior 180d, market fit, and conservative incumbent prior.
No future-trained rank, no duplicate fills, symbol/route/gross conflicts.
No LIVE, VPS, production, HP, actual orders.
"""
from __future__ import annotations
import bisect,collections,csv,datetime as dt,gzip,hashlib,importlib.util,io,json,math,statistics,sys,zipfile
from pathlib import Path
ROOT=Path('C:/tmp')
REPO=ROOT/'render-multiregime-study-20261024'
BASE=REPO/'scripts/dd-reduction'
OUT=ROOT/'render-mtf-study-20261024'
SRC=REPO/'docs/research/results/render-three-regime-20261024'
M=300000;H=3600000;D=24*H
PERIODS={
'2024':(1704067200000,1735689600000),
'2025H1':(1735689600000,1754006400000),
'2025H2':(1754006400000,1767225600000),
'2026JanAug':(1767225600000,1786320000000),
'2026AugOct':(1786320000000,1792800000000),
}
POLS={
'S6':(.015,.020,6,0,0),
'S12':(.025,.025,12,0,0),
'T24':(.050,.035,24,.025,.010)}
SOURCES=[
 ROOT/'render-rndr-2024-history-20261024',
 ROOT/'idle-render-independent-older-m5-20261024',
 ROOT/'render-flow-raw-data-20261024',
 ROOT/'render-2026-aug-oct-research-20261024',
 ROOT/'render-btc-complete-20261024']
def load_m5(sym):
 data={}
 files=sorted(set(p for r in SOURCES for p in r.rglob(sym+'-5m-*.zip')))
 assert files
 for p in files:
  with zipfile.ZipFile(p) as f:
   assert f.testzip() is None
   candidates=[x for x in f.namelist() if x.endswith('.csv')]
   assert len(candidates)==1
   for row in csv.reader(io.TextIOWrapper(f.open(candidates[0]),encoding='utf-8-sig')):
    try:
     t=int(row[0]);op,hi,lo,cl,v=map(float,row[1:6])
     buyer=float(row[9])
    except (ValueError,IndexError):continue
    assert 0<=buyer<=v*1.00001
    x=(t,op,hi,lo,cl,v,buyer)
    if t in data and data[t]!=x:raise AssertionError(('OVERLAP_MISMATCH',sym,t))
    data[t]=x
 arr=sorted(data.values())
 print('LOADED',sym,len(arr),'ARCHIVES',len(files),'FROM',arr[0][0],'TO',arr[-1][0],flush=True)
 return arr
def sim(a,i,params):
 tp,sl,hold,trig,protect=params
 if i<0 or i>=len(a):return None
 start=a[i][0];lim=i+hold*12
 if lim>=len(a) or a[lim][0]!=start+hold*H:return None
 entry=a[i][1];hard=entry*(1+sl);target=entry*(1-tp)
 stop_extra=None;mfe=0.
 exitp=a[lim][1];exitt=a[lim][0];reason='TIME'
 for j in range(i,lim):
  bar=a[j];op,hi,lo=bar[1:4]
  stop=min(hard,stop_extra) if stop_extra is not None else hard
  if hi>=stop:exitp=max(op,stop);exitt=bar[0];reason='STOP';break
  if lo<=target:exitp=target;exitt=bar[0];reason='TAKE';break
  mfe=max(mfe,1-lo/entry)
  if trig and mfe>=trig:stop_extra=entry*(1-protect)
 return {'entry':start,'exitTs':exitt,'net30':100*(1-exitp/entry)-.30,'reason':reason,
         'entryPrice':entry,'exitPrice':exitp}

def struct(a,i,btc_lookup=None):
 """Return completed H1, H4, D1 and seller features as of entry t=a[i][0]."""
 if i<288:return None
 t=a[i][0]
 prev=a[i-12:i]
 prevprev=a[i-24:i-12]
 if len(prev)!=12 or prev[0][0]!=t-H or prev[-1][0]!=t-M:return None
 if prevprev[0][0]!=t-2*H or prevprev[-1][0]!=t-H-M:return None
 close=a[i-1][4]
 h1open=prev[0][1];h1high=max(z[2] for z in prev);h1low=min(z[3] for z in prev)
 prevhigh=max(z[2] for z in prevprev);prevlow=min(z[3] for z in prevprev)
 pos=(close-h1low)/max(h1high-h1low,1e-12)
 recent_vol=sum(z[5] for z in prev)
 seller=(recent_vol-sum(z[6] for z in prev))/max(recent_vol,1e-12)
 vol6=[sum(a[j][5] for j in range(i-12*h,i-12*(h-1))) for h in range(2,8) if i>=12*h]
 ratio=recent_vol/max(statistics.median(vol6) if vol6 else 1,1e-9)
 h4end=t-t%(4*H);diend=t-t%D
 def tf(last,period):
  j=last-period
  if j< a[0][0] or (last-M) not in ix or j not in ix:return None
  k=ix[j];l=ix[last-M]
  if l-k+1!=period//M or a[l][0]-a[k][0]!=period-M:return None
  return 100*(a[l][4]/a[k][1]-1)
 # identity maps kept in global DATA
 ix=INDEX[a[0][0]]
 d1=tf(diend,D);h4=tf(h4end,4*H)
 if d1 is None or h4 is None:return None
 ret1=100*(close/h1open-1)
 r3=100*(close/a[i-36][1]-1) if a[i-36][0]==t-3*H else None
 wick=100*(h1high-max(close,h1open))/h1open
 last15=100*(close/a[i-3][1]-1) if a[i-3][0]==t-15*M//5 else 0
 # 3 M5 = 15 minutes, index t-15m.
 if btc_lookup is not None and t-H in btc_lookup and t-M in btc_lookup:
  ob=btc_lookup[t-H];cb=btc_lookup[t-M]
  btc1=100*(cb[4]/ob[1]-1)
 else:btc1=None
 return {'t':t,'h1':ret1,'h4':h4,'d1':d1,'h3':r3,
  'position':pos,'h1High':h1high,'h1Low':h1low,
  'prevHigh':prevhigh,'prevLow':prevlow,'close':close,
  'sellPct':seller,'volRatio':ratio,'wickPct':wick,'last15':last15,
  'btc1':btc1}
INDEX={}
def gates(f):
 h4=f['h4'];d1=f['d1'];r1=f['h1'];p=f['position'];sell=f['sellPct'];vol=f['volRatio']
 close=f['close'];h3=f['h3'];btc=f['btc1'];last=f['last15']
 # Independent gates: NONE requires OI, none requires an existing #4427 signal.
 return {
  'TREND_BREAK':d1<=-.5 and h4<=-.25 and r1<=-.2 and close<f['prevLow']*.999 and sell>=.52,
  'TREND_PRESSURE':h4<=-.25 and r1<=-.35 and sell>=.555 and vol>=1.05 and p<=.40,
  'REBOUND_FAIL':d1<=-.5 and h3 is not None and h3>=.15 and r1<=-.25 and f['wickPct']>=.18 and sell>=.52,
  'PULLBACK_FADE':h4<=-.45 and r1<=-.25 and a_prev_h1_return(f)<0 and sell>=.545 and last<=-.1,
  'FALSE_BREAKOUT':h4>=.2 and f['h1High']>=f['prevHigh']*1.0015 and close<f['prevHigh'] and f['wickPct']>=.22 and sell>=.53,
  'SELL_IMBALANCE':h4<=-.25 and r1<=-.20 and sell>=.60 and vol>=1.15,
  'BTC_RENDER_DIVERGE':btc is not None and btc>=.15 and r1<=-.20 and h4<=-.15 and sell>=.53,
 }
def a_prev_h1_return(f):
 # Placeholder: compute from cached prior H1 event information below.
 return f['prevH1ret']
def period(t):
 return next((p for p,(lo,hi) in PERIODS.items() if lo<=t<hi),None)
def stats(arr,cost):
 x=[r['net30']+(.30-cost/100) for r in arr]
 wins=sum(v>0 for v in x);gain=sum(v for v in x if v>0);loss=-sum(v for v in x if v<0)
 eq=peak=1.;dd=0
 for v in x:
  eq*=1+v/100
  peak=max(eq,peak);dd=min(dd,100*(eq/peak-1))
 return {'n':len(x),'wins':wins,'wrPct':round(100*wins/len(x),2) if x else None,
         'pf':round(gain/loss,4) if loss else None,
         'compoundPct':round((eq-1)*100,3),'closedDdPct':round(dd,3)}
def main():
 banks=[json.loads((SRC/f).read_text('utf8'))['events'] for f in [
  'RENDER_ALL_SIX_SHORT_CAUSAL_ENTRY_BANK_2024_2026AUG_20261024.json',
  'RENDER_ALL_SIX_SHORT_POSTAUG2026_RETROSPECTIVE_HOLDOUT_BANK_20261024.json']]
 old_event={ (e['symbol'],int(e['t'])):e for chunk in banks for e in chunk}
 assert len(old_event)==643
 print('BASE_GATE_BANK',len(old_event),flush=True)
 series={s:load_m5(s) for s in ('RNDRUSDT','RENDERUSDT')}
 btc=load_m5('BTCUSDT')
 btc_lookup={z[0]:z for z in btc}
 for x in series.values():INDEX[x[0][0]]={z[0]:i for i,z in enumerate(x)}
 # Ensure true original old entries are exactly repriced.
 import importlib.util
 spec=importlib.util.spec_from_file_location('old_4427_original',BASE/'render-4427-causal-m5-confirmed-delayed-entry-20261024.py')
 mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
 scenarios=[]
 original_n=0;independent=collections.Counter();overlap=collections.Counter();no_overlap=collections.Counter()
 for sym,arr in series.items():
  orig_map=INDEX[arr[0][0]]
  # generate independent hypotheses at exactly completed H1 time.
  for i in range(288,len(arr)-288):
   t=arr[i][0]
   if t%H:continue
   if arr[i-1][0]!=t-M:continue
   f=struct(arr,i,btc_lookup)
   if f is None:continue
   # Previous H1 return from fully closed 2-hour history.
   f['prevH1ret']=100*(arr[i-13][4]/arr[i-24][1]-1) if arr[i-13][0]==t-H-M else 0
   gd=gates(f)
   prev=old_event.get((sym,t))
   oldf=mod.choose_family(prev) if prev else None
   if not oldf and not any(gd.values()):continue
   opts=[]
   if oldf:
    pol='S6' if oldf=='X' else 'T24'
    z=sim(arr,i,POLS[pol]);assert z is not None
    prior=prev['exitModels']['TAKE15_STOP20_H6' if oldf=='X' else 'TRAIL_MFE25_FLOOR10_H24']
    if abs(z['net30']-prior['net30'])>1e-6 or z['exitTs']!=prior['exitTs']:
     raise AssertionError(('4427_NOT_EQUAL',sym,t,oldf,z,prior))
    opts.append({'family':'ORIGINAL_'+oldf,'kind':'ORIGINAL','exit':pol,**z})
    original_n+=1
   for g,ok in gd.items():
    if not ok:continue
    independent[g]+=1
    (overlap if oldf else no_overlap)[g]+=1
    for ex,params in POLS.items():
     z=sim(arr,i,params)
     if z:opts.append({'family':g,'kind':'INDEPENDENT','exit':ex,**z})
   if opts:scenarios.append({'sym':sym,'t':t,'features':f,'oldFamily':oldf,'candidates':opts})
 scenarios.sort(key=lambda z:z['t'])
 print('ALPHA_CANDIDATE_TIMES',len(scenarios),'ORIGINAL_COUNT',original_n,
       'INDEPENDENT',dict(independent),'OVERLAP',dict(overlap),'INDEPENDENT_ONLY',dict(no_overlap),flush=True)
 assert original_n==235
 # Frozen all-gate shadow candidates: independent signals evaluated even when
 # an existing position would suppress them; outcomes become known only at exitTs.
 bank_path=OUT/'RENDER_4427_INDEPENDENT_ALL_GATE_SHADOW_ENTRY_BANK_20261024.json.gz'
 with gzip.open(bank_path,'wt',encoding='utf8',compresslevel=6) as stream:
  json.dump({'status':'RESEARCH_ONLY_CAUSAL_SHADOW_ALL_H1',
    'rows':scenarios,'method':'Gate at last fully closed H1, entry next M5, no OI prerequisites',
    'source':'official Binance publisher ZIP; 2025Aug-2026Aug BTC M5 missing, BTC-only route skipped'},
    stream,ensure_ascii=False,separators=(',',':'))
 print('SHADOW_BANK_SAVED',bank_path,bank_path.stat().st_size,flush=True)
 # Primary Gate and exit structure initially: predeclare S6, S12 and T24; allow a single
 # param-independent score; never rank alternatives using the CURRENT candle's future return.
 def portfolio(config):
  locked={};selected=[]
  score_diag=collections.Counter()
  # Historical shadow previous CLOSED trades for each family+exit as-of t.
  history=collections.defaultdict(list);cursor=0;completion=sorted(
    [(candidate['exitTs'],candidate['family']+'__'+candidate['exit'],candidate['net30'],row['t'])
      for row in scenarios for candidate in row['candidates']],key=lambda z:z[0])
  for row in scenarios:
   t=row['t'];sym=row['sym']
   while cursor<len(completion) and completion[cursor][0]<t:
    ts,key,net,signal=completion[cursor];history[key].append((ts,net));cursor+=1
   if t<locked.get(sym,0):continue
   options=[]
   for c in row['candidates']:
    fam=c['family'];kind=c['kind'];ex=c['exit']
    if kind=='INDEPENDENT' and fam not in config['families']:continue
    if kind=='INDEPENDENT' and ex!=config['exit']:continue
    # Rolling 180d shadow outcomes already CLOSED, no future known.
    look=[v for ts,v in history[fam+'__'+ex] if t-180*D<=ts<t]
    wins=sum(x>0 for x in look);N=len(look)
    pwin=(wins+4)/(N+8)
    mean=sum(look)/(N+8)
    f=row['features']
    score=50*pwin + 18*max(-1,min(1,mean))
    # Score isn't HP ranking; causal stand-in based on known market.
    score+=12*max(0,min(1,(f['sellPct']-.5)*10))
    score+=8*max(0,min(1,-f['h4']/2))
    score+=5*max(0,min(1,-f['d1']/3))
    score+=4*max(0,min(1,f['volRatio']-1))
    # Incumbent gate has safety preference when similarly expected.
    score+=config['oldBonus'] if kind=='ORIGINAL' else 0
    options.append((score,c))
   if not options:continue
   # Most expected value wins, deterministic equal score tie goes to incumbent.
   options.sort(key=lambda z:(z[0],z[1]['kind']=='ORIGINAL',z[1]['family']),reverse=True)
   best=options[0][1];score=options[0][0]
   selected.append({'t':t,'sym':sym,'family':best['family'],'kind':best['kind'],
    'exit':best['exit'],'entry':best['entry'],'exitTs':best['exitTs'],'net30':best['net30'],
    'score':round(score,3),'conflicts':len(options)-1,'competitorFamilies':[x[1]['family'] for x in options[1:]]})
   locked[sym]=best['exitTs']+12*H
   if len(options)>1:score_diag['multiple_gate_eligible']+=1
   score_diag['selected_'+best['family']]+=1
  byper={p:{str(cost):stats([z for z in selected if lo<=z['t']<hi],cost)
    for cost in (10,30)} for p,(lo,hi) in PERIODS.items()}
  return {'config':config,'total':len(selected),'byFamily':dict(collections.Counter(z['family'] for z in selected)),
   'conflictCount':score_diag['multiple_gate_eligible'],
   'scoreDiagnostics':dict(score_diag),'periods':byper,'trades':selected}
 # Validate empty families reproduce old 188 trades.
 baseline=portfolio({'families':[],'exit':'S6','oldBonus':4})
 assert baseline['total']==188,baseline['total']
 assert [baseline['periods'][y]['30']['n'] for y in PERIODS]==[70,45,19,41,13]
 assert baseline['periods']['2025H2']['30']['compoundPct']==2.66
 print('BASELINE_REPRODUCED',baseline['total'],'H2',baseline['periods']['2025H2']['30'],flush=True)
 routes=list(independent)
 scenarios_config=[]
 for fam in routes:
  for ex in ('S6','S12','T24'):
   for bonus in (0,4,8):
    scenarios_config.append({'families':[fam],'exit':ex,'oldBonus':bonus})
 for families in [
  ['TREND_BREAK','REBOUND_FAIL','FALSE_BREAKOUT'],
  ['TREND_PRESSURE','REBOUND_FAIL','FALSE_BREAKOUT'],
  ['PULLBACK_FADE','TREND_PRESSURE','FALSE_BREAKOUT'],
  ['TREND_BREAK','TREND_PRESSURE','REBOUND_FAIL','FALSE_BREAKOUT'],
  ['TREND_BREAK','TREND_PRESSURE','REBOUND_FAIL','PULLBACK_FADE','FALSE_BREAKOUT','SELL_IMBALANCE'],
  routes
 ]:
  for ex in ('S6','S12','T24'):
   for bonus in (0,4,8):scenarios_config.append({'families':families,'exit':ex,'oldBonus':bonus})
 results=[]
 for ix,conf in enumerate(scenarios_config):
  x=portfolio(conf)
  # require >0 truly independent trades, not same route renamed.
  added=sum(x['byFamily'].get(k,0) for k in routes)
  pass_period=all(x['periods'][per]['30']['compoundPct']>=baseline['periods'][per]['30']['compoundPct']
    and x['periods'][per]['30']['closedDdPct']>=baseline['periods'][per]['30']['closedDdPct']
    and x['periods'][per]['30']['n']>=int(baseline['periods'][per]['30']['n']*.90)
    and x['periods'][per]['10']['compoundPct']>=baseline['periods'][per]['10']['compoundPct']
    for per in PERIODS)
  results.append({'config':conf,'total':x['total'],'addedIndependentSelected':added,
   'byFamily':x['byFamily'],'conflictCount':x['conflictCount'],'scoreDiagnostics':x['scoreDiagnostics'],
   'periods':x['periods'],'strictAllFive30And10':pass_period,
   'trades':x['trades']})
  if ix%25==0:print('SCREEN',ix,'OF',len(scenarios_config),flush=True)
 winners=[z for z in results if z['strictAllFive30And10'] and z['addedIndependentSelected']>=12]
 print('STRICT_ACCEPTABLE_ADDITION_COUNT',len(winners),'OF',len(results),flush=True)
 for z in sorted(winners,key=lambda x:-x['periods']['2025H2']['30']['compoundPct'])[:12]:
  print('GATE_WIN',z['config'],'ADD',z['addedIndependentSelected'],'P25H2',z['periods']['2025H2']['30'],
   'P24',z['periods']['2024']['30'],'P26',z['periods']['2026JanAug']['30'],
   'P26LATE',z['periods']['2026AugOct']['30'],flush=True)
 for z in sorted(results,key=lambda x:-x['periods']['2025H2']['30']['compoundPct'])[:10]:
  print('TOP_H2',z['config'],'ADD',z['addedIndependentSelected'],
   'H2',z['periods']['2025H2']['30'],'24',z['periods']['2024']['30']['compoundPct'],
   '25H1',z['periods']['2025H1']['30']['compoundPct'],
   '26',z['periods']['2026JanAug']['30']['compoundPct'],
   'LATE',z['periods']['2026AugOct']['30']['compoundPct'],flush=True)
 obj={'status':'RESEARCH_ONLY_INDEPENDENT_NO_OI_GATE_DYNAMIC_ASOF_SCORE',
  'timestamp':'2026-10-24','signalCount':len(scenarios),'originalEligible':original_n,
  'independentSignalCounts':dict(independent),'overlap':dict(overlap),'independentOnly':dict(no_overlap),
  'scoring':'score: 50*(wins+4)/(closed_shadow_n+8) +18*shrunken mean return capped +-1 + seller/H4/D1/volume fit + oldBonus. Completed prior 180d only',
  'baseline':baseline,'screenCases':len(results),'strictAccepted':len(winners),
  'cases':results,
  'caveats':['All windows previously viewed, not pristine OOS',
    'OI not required for independent gates; score uses price/seller strength and past shadow PnL, NOT production HP score',
    'BTC divergence gate may lack BTC M5 coverage in 2025 Aug-2026 Aug; such bars skipped',
    'Binance proxy only, not Aster real M5/L2 fills',
    'Native8 required for portfolio final asset/DD; no LIVE/VPS/HP changed']}
 dest=OUT/'RENDER_4427_INDEPENDENT_SHORT_DAILY_H4_SELLPRESSURE_DYNAMIC_SCORE_20261024.json'
 dest.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n','utf8')
 print('RESULT_SAVED',dest,dest.stat().st_size,flush=True)
if __name__=='__main__':main()
