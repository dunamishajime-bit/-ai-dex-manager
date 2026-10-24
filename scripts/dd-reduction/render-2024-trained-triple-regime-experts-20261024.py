#!/usr/bin/env python3
"""Three simultaneous causal expert scores for RENDER SHORT with a genuine 2024
market specialist trained solely on pre-June 2024 RNDRUSDT.
Expert 0: 2024 mean-reversion/rally-failure environment.
Expert 1: deep-selloff risk/regime transition.
Expert 2: lower-stress sell-pressure continuation.
Old RNDRUSDT (until 2024-07-16 09UTC) and new RENDERUSDT
(since 2024-07-26 10UTC) are separate instrument episodes. No gap splice.
Research only: standalone market signal bank, not native all8 or signed venue.
"""
from __future__ import annotations
import bisect,collections,datetime as dt,hashlib,json,math
from pathlib import Path
from importlib import util
import numpy as np
HERE=Path(__file__).resolve().parent
R=HERE.parents[1]
OUT=R/'docs/research/results/render-three-regime-20261024'
def load(n,p):
 sp=util.spec_from_file_location(n,p);m=util.module_from_spec(sp);sp.loader.exec_module(m);return m
base=load('triple_market_2024_cohorts',HERE/'render-full-2024-rndr-render-separated-bt-20261024.py')
m=base.m;e=base.e
TRAIN_END=e.ms('2024-06-01')
OLD_EXPIRY=base.OLD_EXPIRY
START_NEW=base.NEW_START
def metrics_small(files):
 samples=[];bad=0
 for f in files:
  for row in m.csv_from_archive(f)[1:]:
   if len(row)<8:bad+=1;continue
   try:
    stamped=m.parse_metric_time(row[0])
    nums=[float(row[k]) for k in (2,3,4,5,6,7)]
    if not all(math.isfinite(x) for x in nums) or min(nums[:2])<=0:
     bad+=1;continue
    samples.append((stamped+600000,*nums))
   except Exception:bad+=1
 bytime={}
 for r in samples:
  if r[0] in bytime and bytime[r[0]]!=r:
   bytime[r[0]]=None
  else:bytime.setdefault(r[0],r)
 clean=sorted(r for r in bytime.values() if r is not None)
 assert len(clean)>500 and len(clean)==len({r[0] for r in clean})
 return clean,bad
def funding_small(files):
 vals=[]
 for f in files:
  for row in m.csv_from_archive(f)[1:]:
   try:
    t=int(row[0]);rate=float(row[2])
    if math.isfinite(rate):vals.append((t+300000,rate))
   except Exception:continue
 vals.sort()
 return vals
def add_macro(rows,bars,btc,metrics,funding):
 btcmap={int(r[0]):int(i) for i,r in enumerate(btc)}
 mtimes=[z[0] for z in metrics]
 ftimes=[z[0] for z in funding]
 frates=[z[1] for z in funding]
 cumul=m.history_features(bars)
 excluded=collections.Counter()
 passed=[]
 for z in rows:
  i=int(z['index']);t=int(z['t'])
  if i<2016:excluded['7dNotReady']+=1;continue
  tbar=int(bars[i][0])
  if tbar not in btcmap:excluded['missingBtc']+=1;continue
  j=btcmap[tbar]
  if j<2016 or btc[j-2016][0]!=btc[j][0]-2016*300000:
   excluded['btc7dGap']+=1;continue
  if bars[i-2016][0]!=bars[i][0]-2016*300000:
   excluded['symbol7dGap']+=1;continue
  f=m.metrics_for_event(z,metrics,mtimes,ftimes,frates,bars,cumul)
  if f is None:excluded['metricNotFresh']+=1;continue
  hist=np.array([float(r[4]) for r in bars[i-2016:i+1]],dtype=float)
  # macroscopic 1-day-normalized realized vol on 5-minute returns
  rv=float(np.std(np.diff(np.log(hist)))*math.sqrt(288)*100)
  r7=100*(float(bars[i][4])/float(bars[i-2016][4])-1)
  b7=100*(float(btc[j][4])/float(btc[j-2016][4])-1)
  z['macro']={'ret7':r7,'btc7':b7,'rv7':rv,
      'oi1':f['oi1Pct'],'oi3':f['oi3Pct'],
      'seller1':f['seller1'],'seller3':f['seller3'],
      'sellerAccel':f['sellerAcceleration'],'volumeSpike':f['volumeSpike1h'],
      'fundBps':f['fundingBps']}
  passed.append(z)
 return passed,dict(excluded)
def regime(z):
 f=z['macro']
 # Fixed human-interpretable classes, no future calendar in any decision.
 if f['ret7']<=-10 and (f['btc7']<=-3 or f['rv7']>=5):
  return 1
 if f['seller1']>=.05 and f['oi1']>=0 and f['ret7']>-10:
  return 2
 return 0
MACRO_KEYS=('ret7','btc7','rv7','oi1','oi3','seller1','seller3','sellerAccel','volumeSpike','fundBps')
def raw(rows):
 return np.asarray([z['feat']+[z['macro'][k] for k in MACRO_KEYS] for z in rows],dtype=float)
def fit_matrix(train,other):
 a=raw(train)
 med=np.median(a,axis=0)
 std=np.maximum(np.std(a,axis=0),.10)
 def norm(rows):
  b=np.clip((raw(rows)-med)/std,-4,4)
  n=b.shape[1]
  # Price/regime and position/flow interactions are predeclared
  pairs=[(0,3),(1,6),(7,11),(9,11),(12,13),
   (n-10,n-4),(n-9,n-7),(n-8,n-5),
   (n-4,n-3),(n-5,n-4),(n-6,n-3),(n-2,n-4)]
  products=np.column_stack([b[:,i]*b[:,j] for i,j in pairs])
  relu=np.column_stack([np.maximum(0,b[:,i]) for i in (0,3,5,11,n-10,n-9,n-8,n-5,n-4,n-3)])
  return np.column_stack([np.ones(len(rows)),b,products,relu])
 return norm(train),norm(other)
def ridge(X,Y,alpha):
 reg=np.eye(X.shape[1])*alpha;reg[0,0]=0
 return np.linalg.solve(X.T@X+reg,X.T@Y)
def fit(train,X):
 y=np.asarray([[z['exits'][policy]['netPct'] for policy in e.POLICIES] for z in train],dtype=float)
 global_coef=ridge(X,y,150)
 specialists=[global_coef]
 sizes=[len(train)]
 labels=np.asarray([regime(z) for z in train],dtype=int)
 for k in (1,2):
  mask=(labels==k)
  sizes.append(int(mask.sum()))
  if mask.sum()<25:
   specialists.append(global_coef)
  else:
   local=ridge(X[mask],y[mask],150)
   specialists.append(.65*global_coef+.35*local)
 return np.stack(specialists,axis=0),sizes
def score_rows(rows,X,coef):
 # run all three experts at every event
 return np.einsum('nf,kfp->nkp',X,coef,optimize=True)
def predict(selection,score,model):
 z=selection
 r=regime(z)
 if model=='2024_expert_only':
  pscore=score[0];i=int(np.argmax(pscore));return i,float(pscore[i]),0
 if model=='hard_triple':
  pscore=score[r];i=int(np.argmax(pscore));return i,float(pscore[i]),r
 if model=='soft_triple':
  mix=.20*score.sum(axis=0)+.40*score[r]
  i=int(np.argmax(mix));return i,float(mix[i]),r
 if model=='priority_triple':
  v=score.copy()
  for k in (0,1,2):
   if k!=r:v[k]-=.5
  a,b=np.unravel_index(int(np.argmax(v)),v.shape)
  return int(b),float(v[a,b]),int(a)
 raise ValueError(model)
def select(rows,X,coefs,cutoff,mode):
 candidates=score_rows(rows,X,coefs)
 out=[];allowed=-1
 for i,z in enumerate(rows):
  if z['t']<allowed:continue
  policy,score,k=predict(z,candidates[i],mode)
  if score<cutoff:continue
  item=dict(z,policy=list(e.POLICIES)[policy],expert=k,
    signalScore=round(float(score),5),observedRegime=regime(z))
  out.append(item);allowed=int(item['exits'][item['policy']]['exitTs'])+12*e.screen.HOUR
 return out
def cohort_summary(rows):
 timeframes=[
 ('train_RNDR_2024_JAN_MAY',e.ms('2024-01-01'),TRAIN_END),
 ('validation_RNDR_2024_JUN_JUL',TRAIN_END,OLD_EXPIRY),
 ('transfer_RENDER_2024_JUL_DEC',START_NEW,e.ms('2025-01-01')),
 ('check_RENDER_2025_JAN_MAR',e.ms('2025-01-01'),e.ms('2025-04-01')),
 ('check_RENDER_2025_APR_JUL',e.ms('2025-04-01'),e.ms('2025-08-01')),
 ('recent_RENDER_2025_AUG_2026_AUG',e.ms('2025-08-10'),e.ms('2026-08-10')),
 ('weak_RENDER_2026_JAN_MAR',e.ms('2026-01-01'),e.ms('2026-04-01')),
 ('strong_RENDER_2026_APR_AUG',e.ms('2026-04-01'),e.ms('2026-08-10'))]
 result={}
 for name,a,b in timeframes:
  vals=[z for z in rows if a<=z['t']<b]
  result[name]={str(c):e.summarize(vals,c) for c in (10,30)}
  result[name]['byExpert']={f'expert_{k}':sum(z['expert']==k for z in vals) for k in (0,1,2)}
 return result
def main():
 tman=json.loads((OUT/'RENDER_RNDR_2024_OFFICIAL_CROSS_CONTRACT_SOURCE_MANIFEST_20261024.json').read_text('utf8'))
 a=[x for x in tman['files'] if 'sha256' in x]
 assert len(a)==227
 original=json.loads((R/'docs/research/results/render-orderflow-20261024/RENDER_ORDERFLOW_SOURCE_MANIFEST_20261024.json').read_text('utf8'))
 rn=base.bars(a,'RNDRUSDT');rn=[z for z in rn if z[0]<OLD_EXPIRY]
 b2024=base.bars(a,'BTCUSDT')
 rjul=base.bars(a,'RENDERUSDT')
 oldrender=m.read_render_bars(original['files'],True)
 oldm=json.loads((R/'docs/research/results/idle-entry-three-20261024/IDLE_RENDER_OLDER_BINANCE_PUBLIC_M5_SOURCE_MANIFEST_20261024.json').read_text('utf8'))
 oldbtc,_=e.old_mod.parse_months(oldm,'BTCUSDT')
 nativem=e.imp('triple2024_native_prices',HERE/'research-residual-avax-composite-entry-veto-full8-20261023.py')
 provider,_=nativem.native.m.m.core.task8.legacy.bootstrap()
 newbtc,_=provider.getdata('BTCUSDT')
 newrender=m.read_render_bars(original['files'],False)
 rn_met,bad_rn=metrics_small([x for x in a if x['symbol']=='RNDRUSDT' and x['kind']=='metrics'])
 rn_fund=funding_small([x for x in a if x['symbol']=='RNDRUSDT' and x['kind']=='fundingRate'])
 rmet0,bad_rnew=metrics_small([x for x in original['files'] if x['kind']=='metrics'])
 rmetJuly,bad_rj=metrics_small([x for x in a if x['symbol']=='RENDERUSDT' and x['kind']=='metrics'])
 rmet=sorted(rmetJuly+rmet0)
 rfund0=m.read_funding(original['files'])
 rfundJuly=funding_small([x for x in a if x['symbol']=='RENDERUSDT' and x['kind']=='fundingRate'])
 rfund=sorted(rfundJuly+rfund0)
 assert base.continuous(rn) and base.continuous(b2024)
 afterr=[*rjul,*oldrender];afterbtc=[*b2024,*oldbtc]
 assert base.continuous(afterr) and base.continuous(afterbtc)
 rnrows=e.prepare(rn,b2024,rn[0][0],OLD_EXPIRY,'RNDR_2024_triple')
 ar=e.prepare(afterr,afterbtc,START_NEW,e.CAL_END,'RENDER_2024_2025_triple')
 lr=e.prepare(newrender,newbtc,e.NEW_BEGIN,e.NEW_END,'RENDER_2025_2026_triple')
 o,mr=add_macro(rnrows,rn,b2024,rn_met,rn_fund)
 b,mb=add_macro(ar,afterr,afterbtc,rmet,rfund)
 n,mn=add_macro(lr,newrender,newbtc,rmet,rfund)
 print('PREPARED_FLOW',len(o),len(b),len(n),'DROPPED',mr,mb,mn,flush=True)
 train=[x for x in o if x['t']<TRAIN_END]
 future=[x for x in o if x['t']>=TRAIN_END]+b+n
 trainX,futureX=fit_matrix(train,future)
 heads,sizes=fit(train,trainX)
 print('2024_TRAIN_EXPERT_GROUPS',sizes,'FEATURES',trainX.shape,flush=True)
 modes=('2024_expert_only','hard_triple','soft_triple','priority_triple')
 data={'status':'RESEARCH_ONLY_THREE_SIMULTANEOUS_EXPERTS_2024_TRAINED_NOT_NATIVE8',
   'contractEpisodes':{'first':'RNDRUSDT 2024-01-01..2024-07-16 UTC',
    'second':'RENDERUSDT 2024-07-26..2026-08-09 UTC',
    'noSpliceOrGapTrading':True},
   'data':{'train2024RNDR':len(train),'futureRNDR':len(o)-len(train),
     'futureRENDER2024to2025':len(b),'futureRENDER2025to2026':len(n),
     'featureMissing':{'rn':mr,'render2024_25':mb,'render2025_26':mn},
     'trainingSizes':[int(x) for x in sizes],
     'trainScope':'RNDR Jan1-May31 2024 only',
     '2024IssuerContractsVerified':227},
   'features':{'2024Expert':'RNDR Jan-May combined all modes',
     'DeepSellingExpert':'2024 RNDR observations with RENDER/RNDR 7d <= -10% and (BTC7<=-3% or realized 7d vol >=5)',
     'ConfirmedPressureExpert':'2024 RNDR observations with 1h sellers>=5%, 1h OI delta>=0 and 7d token return > -10%',
     'allExpertsEvaluatedEveryH1Candidate':True,'sharedSameSymbolCooldownHours':12,
     'winner':'after penalty based on current observed regime, highest predicted net profit'},
   'warnings':['Three experts trained solely on old RNDR perpetual 2024 Jan-May, not new RENDER venue; transfer risk is high',
     'Historic comparison windows have been researched before, not pristine untouched OOS',
     'No real venue funding/latency/execution, this is H1 independent sleeve, not native common wallet',
     'Specialist shrinkage fixed before validation and no results used to change weights',
     'After 2024 asset migration the price/market regime may change substantially'],
   'models':{}}
 for mode in modes:
  basis_preds=score_rows(train,trainX,heads)
  train_scores=np.asarray([predict(z,basis_preds[i],mode)[1] for i,z in enumerate(train)])
  for q in (.40,.60,.75):
   threshold=float(np.quantile(train_scores,q))
   selected_train=select(train,trainX,heads,threshold,mode)
   selected_future=select(future,futureX,heads,threshold,mode)
   alltrades=selected_train+selected_future
   results=cohort_summary(alltrades)
   key=f'{mode}__q{q}'
   data['models'][key]={'trainingQuantile':q,'scoreCutoff30bps':threshold,'periods':results}
   a30=results['validation_RNDR_2024_JUN_JUL']['30']
   b30=results['transfer_RENDER_2024_JUL_DEC']['30']
   c30=results['check_RENDER_2025_APR_JUL']['30']
   recent=results['recent_RENDER_2025_AUG_2026_AUG']['30']
   print('THREE_EXPERT',key,'2024_JUN',a30['n'],a30['pf'],
     '2024_RENDER',b30['n'],b30['wrPct'],b30['pf'],
     '2025_APR_JUL',c30['n'],c30['pf'],
     '2025_26',recent['n'],recent['wrPct'],recent['pf'],flush=True)
 data['calibrationAdoptionPassed']=[k for k,z in data['models'].items() if
  z['periods']['validation_RNDR_2024_JUN_JUL']['30']['n']>=12 and
  (z['periods']['validation_RNDR_2024_JUN_JUL']['30']['pf'] or 0)>1 and
  z['periods']['transfer_RENDER_2024_JUL_DEC']['30']['n']>=20 and
  (z['periods']['transfer_RENDER_2024_JUL_DEC']['30']['pf'] or 0)>1 and
  z['periods']['check_RENDER_2025_APR_JUL']['30']['n']>=12 and
  (z['periods']['check_RENDER_2025_APR_JUL']['30']['pf'] or 0)>1]
 data['status']='RESEARCH_ONLY_NOT_ADOPTED' if not data['calibrationAdoptionPassed'] else 'RESEARCH_ONLY_CANDIDATES_NOT_NATIVE8'
 file=OUT/'RENDER_2024_TRAINED_TRIPLE_EXPERT_CAUSAL_BT_20261024.json'
 file.write_text(json.dumps(data,indent=2,ensure_ascii=False)+'\n',encoding='utf8')
 print('DECISION',data['status'],'OLDCALPASS',data['calibrationAdoptionPassed'],'OUT',file)
if __name__=='__main__':main()
