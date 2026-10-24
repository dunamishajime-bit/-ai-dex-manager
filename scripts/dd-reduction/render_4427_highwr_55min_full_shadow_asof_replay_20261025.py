#!/usr/bin/env python3
"""RESEARCH ONLY: full causal 55min past-shadow re-admission parity.
Change all 50 eligible BTC_RENDER_DIVERGE WICK_SHARP S6 shadows to 55m exit,
rebuild the historic ledger with EXITED trades only and re-run old-vs-new score.
Selected 2026 candidates may change; no look-ahead, no LIVE operations.
"""
from __future__ import annotations
import collections,csv,datetime as dt,gzip,hashlib,importlib.util,inspect,io,json,sys,zipfile
from pathlib import Path
ROOT=Path('C:/tmp')
SOURCE=ROOT/'render-mtf-study-20261024'
BRANCH=ROOT/'render4427-independent-gates-audit-20261024'
OUT=BRANCH/'docs/research/results/render4427-scoped-priority-native8-20261024'
TARGET=SOURCE/'render_4427_independent_rolling_profit_gate_20261024.py'
spec=importlib.util.spec_from_file_location('r4427_highwr_cap55_full_shadow_asof',TARGET)
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)
oldm=m.replay
src=inspect.getsource(m.replay)
anchor="   s90=hist_score(recent90);s180=hist_score(recent180);s30=hist_score(rec30);s365=hist_score(rec365)"
oldanchor="     'conservative_180':s180['n']>=20 and s180['pf']>=1.4 and s180['wr']>=.65,"
assert src.count(anchor)==1 and src.count(oldanchor)==1
src=src.replace(anchor,anchor+"\n   lifetime=hist_score([v for end,v in h if end<t])")
src=src.replace(oldanchor,oldanchor+"""
     'expanding_highwr':lifetime['n']>=24 and lifetime['wr']>=.75 and lifetime['pf']>=1.35 and lifetime['mean']>=.10 and s365['n']>=3 and s365['wr']>=.60 and s365['mean']>=0,""")
exec(compile(src,'<research_only_highwr_55_retrained_history>', 'exec'),m.__dict__)
assert m.replay(m.BASE_CONF)['periods']==oldm(m.BASE_CONF)['periods']
PRED=lambda f:f['h1']<=-.5 and f['wickPct']>=.35
GATE='BTC_RENDER_DIVERGE'
sources=[
 ROOT/'render-rndr-2024-history-20261024',
 ROOT/'idle-render-independent-older-m5-20261024',
 ROOT/'render-flow-raw-data-20261024',
 ROOT/'render-2026-aug-oct-research-20261024']
months={};archives={}
def getbar(sym,t):
 epoch=dt.datetime.fromtimestamp(t/1000,dt.timezone.utc)
 month=epoch.strftime('%Y-%m')
 key=(sym,month)
 if key not in months:
  ps=sorted(set(p for root in sources for p in root.rglob(sym+'-5m-'+month+'.zip')))
  if not ps:
   # Late-2026 October daily publisher zip, strictly date matched.
   day=epoch.strftime('%Y-%m-%d')
   ps=sorted(set(p for root in sources for p in root.rglob(sym+'-5m-'+day+'.zip')))
   key=(sym,day)
  assert len(ps)==1,('UNRESOLVED_OFFICIAL_PRICE_ARCHIVE',sym,month,ps)
  if key not in months:
   p=ps[0];bars={}
   with zipfile.ZipFile(p) as z:
    assert z.testzip() is None
    members=[n for n in z.namelist() if n.endswith('.csv')];assert len(members)==1
    for row in csv.reader(io.TextIOWrapper(z.open(members[0]),encoding='utf-8-sig')):
     try:x=int(row[0]);o,h,l,c=map(float,row[1:5])
     except (ValueError,IndexError):continue
     assert o>0 and h>=max(o,c) and l<=min(o,c)
     bars[x]=(o,h,l,c)
   months[key]=bars
   archives[str(key)]={'file':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'candles':len(bars)}
 if t not in months[key]:
  raise AssertionError(('MISSING_M5_BAR',sym,t,key))
 return months[key][t]
def simulator(sym,t,max_minutes):
 entry=getbar(sym,t)[0];stop=entry*1.02;take=entry*.985
 expiry=t+max_minutes*60000
 outprice=getbar(sym,expiry)[0];end=expiry;reason='TIME_LIMIT'
 for ts in range(t,expiry,300000):
  op,hi,lo,close=getbar(sym,ts)
  if hi>=stop:outprice=max(op,stop);end=ts;reason='STOP';break
  if lo<=take:outprice=take;end=ts;reason='TAKE';break
 return {'exitTs':end,'exitPrice':outprice,'net30':100*(1-outprice/entry)-.30,
  'entryPrice':entry,'reason':reason}
changes=[];new_events=[];skipped=0
for row in m.DATA:
 f=row['features'];old=[q for q in row['candidates'] if q['kind']=='ORIGINAL']
 original=[q for q in row['candidates'] if q['family']==GATE and q['exit']=='S6' and q['kind']=='INDEPENDENT']
 if not original or not PRED(f):
  if old:new_events.append({**row,'candidates':old})
  continue
 assert len(original)==1
 c=original[0];sym=row['sym'];t=row['t']
 full=simulator(sym,t,360)
 assert abs(full['net30']-c['net30'])<1e-5 and full['exitTs']==c['exitTs'],('S6_PRIOR_FROZEN_M5_MISMATCH',sym,t,full,c)
 try:r=simulator(sym,t,55)
 except AssertionError:
  # Venue archive unavailable -> reject independent signal, leave original.
  skipped+=1
  if old:new_events.append({**row,'candidates':old})
  continue
 fresh={**c,**r,'exit':'S6_55'}
 new_events.append({**row,'candidates':old+[fresh]})
 changes.append({'sym':sym,'t':t,'previousNet30':c['net30'],'newNet30':r['net30'],'previousExitTs':c['exitTs'],'newExitTs':r['exitTs']})
new_events.sort(key=lambda x:x['t'])
assert len(changes)+skipped==50,('EXPECTED_50_QUALITY_ELIGIBLE_EVENTS',len(changes),skipped)
baseline=oldm(m.BASE_CONF,save=True)
config={'families':[GATE],'exit':'S6_55',
        'routeRules':{GATE:{'exit':'S6_55','policy':'expanding_highwr'}},
        'policy':'expanding_highwr','oldBonus':8,'upgradeMargin':8,
        'structure':'any','newCooldownHours':12}
result=m.replay(config,events=new_events,save=True)
new=[x for x in result['trades'] if x['kind']=='INDEPENDENT']
native=[x for x in new if x['sym']=='RENDERUSDT' and 1767657600000<=x['t']<1786320000000]
def perf(rs,cost):
 x=[r['net30']+(.30-cost/100) for r in rs]
 wins=sum(q>0 for q in x);g=sum(max(0,q) for q in x);loss=-sum(min(0,q) for q in x)
 return {'n':len(x),'wins':wins,'wrPct':100*wins/len(x) if x else None,
         'pf':g/loss if loss else None,'meanNetPct':sum(x)/len(x) if x else None}
ref=json.loads((OUT/'RENDER_4427_HIGHWR_EXPANDING_CAUSAL_ASOF_OWNER_20261025.json').read_text('utf8'))
old55case=next(x for x in ref['cases'] if x['gate']=='WICK_SHARP_S6' and x['policy']=='expanding_highwr')
prior_times={x['t'] for x in old55case['accepted2026']}
new_times={x['t'] for x in native}
out={'status':'RESEARCH_ONLY_MATCHED_55MIN_ENTRY_SHADOW_HISTORY_ASOF_REPLAY',
     'dateJST':'2026-10-25','qualifiedRawSignalCount':len(changes),'missingDataRejectCount':skipped,
     'archiveManifest':archives,'baselineCount':baseline['selectedTrades'],
     'config':config,'original6HProxyNativeSignalCount':len(prior_times),
     'samePolicy55minNativeCount':len(new_times),'nativeTimingOverlap':len(prior_times&new_times),
     'original6HProxyOnlyNative':sorted(prior_times-new_times),
     'updated55OnlyNative':sorted(new_times-prior_times),
     'selectionReasons':result['selectionReasons'],
     'incrementalSelected':len(new),
     'incrementalPerformance':{str(c):perf(new,c) for c in (10,30)},
     'nativeWindowIncrementalPerformance':{str(c):perf(native,c) for c in (10,30)},
     'perPeriodWalletLike':result['periods'],
     'incumbentBaseline':baseline['periods'],
     'selectedIndependentTrades':new,'all50ShadowExitCorrections':changes,
     'limitations':['Historically selected features and 55m exit are both ex-post researched; not pristine forward',
        'No actual Aster signed fills or venue lifecycle', 'No Native8 wallet economic replay for changed signal set yet',
        'No LIVE/VPS/HP/Production modification']}
OUT.mkdir(parents=True,exist_ok=True)
dst=OUT/'RENDER_4427_HIGHWR_55MIN_FULL_SHADOW_CAUSAL_PARITY_20261025.json'
dst.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print('FULL55_ASOF_DONE','RAW',len(changes),'FILL',len(new),'30BPS',out['incrementalPerformance']['30'],
 '2026_FILL',len(native),'2026_30BPS',out['nativeWindowIncrementalPerformance']['30'],
 '2026_TIMES',sorted(new_times),'PREVIOUS_NATIVE',sorted(prior_times),'OWNER_PRIORITY',result['selectionReasons'],flush=True)
print('FULL55_ASOF_SAVED',dst,flush=True)
