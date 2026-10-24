#!/usr/bin/env python3
"""Two contemporaneous RENDER SHORT regime experts with causal scoring.

Two flow+price MARKET REGIMES learned by deterministic k-means exclusively on
2024-08-10..2025-03-31 older data (NO outcome labels in clustering); dedicated
regularized outcome head and exit policy for each regime. Both heads score each
H1 candidate, but the one whose causal market centroid fits better is selected
with a penalty for being off-regime. Signals remain 5m stop-first/12h cooldown.

Test 2025-04..07 calibration and later 2025-08..2026-08 as repeated HISTORICAL
diagnostics, not pristine forward OOS and NOT shared8 owner/allocation replay.
"""
import bisect,datetime as dt,hashlib,json,math,collections
from pathlib import Path
import numpy as np
HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
OUT=REPO/'docs/research/results/render-two-regime-20261024'
OUT.mkdir(parents=True,exist_ok=True)
FLOW_RESULT=REPO/'docs/research/results/render-orderflow-20261024'
from importlib import util
s=util.spec_from_file_location('rich_src',HERE/'render-orderflow-composite-20261024.py')
m=util.module_from_spec(s);s.loader.exec_module(m)
p=m.e

REGIME_KEYS=['seller1','oi3Pct','oi1Pct','seller3','volumeSpike1h']
RENDER_KEYS=['ret1','ret3','ret6','ret24','btc1','btc6','btc24','rel6',
             'last15','last30','first45','hourWick','priorRebound','hourRange',
             'high24','rangePos1','rangePos24','volumeRatio']
COOLDOWN_H=12
def regime_raw(rows):
 return np.asarray([[z['flow'][k] for k in REGIME_KEYS]+
   [z['base'][k] for k in ('ret6','btc24','rel6','hourRange')] for z in rows],dtype=float)
def fit_regimes(older,n):
 raw=regime_raw(older)
 base=raw[:n]
 median=np.median(base,axis=0)
 std=np.maximum(np.std(base,axis=0),.15)
 X=np.clip((raw-median)/std,-3,3)
 projection=.9*X[:n,0]+.6*X[:n,1]+.3*X[:n,2]+.4*X[:n,3]-.25*X[:n,4]
 centers=np.stack([X[:n][int(np.argmin(np.abs(projection-np.quantile(projection,.25))))],
                   X[:n][int(np.argmin(np.abs(projection-np.quantile(projection,.75))))]])
 for _ in range(30):
  dist=((X[:n,None,:]-centers[None,:,:])**2).sum(axis=2)
  assign=np.argmin(dist,axis=1)
  new=np.stack([X[:n][assign==k].mean(axis=0) if (assign==k).sum()>=20 else centers[k] for k in range(2)])
  if np.max(np.abs(new-centers))<1e-9:break
  centers=new
 # Canonical first class is lower seller flow (fragile/weak pressure).
 if centers[0,0]>centers[1,0]:centers=centers[::-1].copy()
 return median,std,centers
def assignments(rows,med,std,centers):
 X=np.clip((regime_raw(rows)-med)/std,-3,3)
 d=((X[:,None,:]-centers[None,:,:])**2).sum(axis=2)
 assigned=np.argmin(d,axis=1)
 # A soft probability comparing how well both regimes match the current market
 prob=1/(1+np.exp(np.clip((d[:,0]-d[:,1])/.9,-35,35)))
 fit=np.column_stack([1-prob,prob])
 return assigned,fit,X
def make_basis(older,new,n):
 # use SAME stable feature normalization for both experts.
 old_price,new_price,trainn=p.make_X(older,new)
 assert trainn==n
 variants=m.matrix(older,new,n,old_price,new_price)
 out={mode:(a,b) for mode,a,b in variants}
 return out
def ridge(X,Y,alpha=120):
 penalty=np.eye(X.shape[1])*alpha;penalty[0,0]=0
 # solve X.tX+penalty to reduce collinearity and finite sample noise
 return np.linalg.solve(X.T@X+penalty,X.T@Y)
def fit_heads(older,X,n,assignment):
 target=np.array([[r['exits'][k]['netPct'] for k in p.POLICIES] for r in older],dtype=float)
 assert np.all(np.isfinite(target))
 global_model=ridge(X[:n],target[:n])
 specialists=[]
 for regime in (0,1):
  mask=assignment[:n]==regime
  assert mask.sum()>=100,('NOT_ENOUGH_REGIME_TRAIN',regime,mask.sum())
  specialists.append(ridge(X[:n][mask],target[:n][mask],alpha=120))
 return global_model,specialists
def select(rows,X,assignment,fitness,globalcoef,heads,cutoff,variant):
 selected=[];next_free=-1
 probs=(X@globalcoef)
 spec=np.stack([X@coef for coef in heads],axis=1)
 for i,row in enumerate(rows):
  t=row['t']
  if t<next_free:continue
  ri=int(assignment[i])
  if variant=='global':
   policy=int(np.argmax(probs[i]));score=float(probs[i,policy]);used='GLOBAL'
  elif variant=='hard':
   policy=int(np.argmax(spec[i,ri]));score=float(spec[i,ri,policy]);used=f'REGIME_{ri}'
  elif variant=='soft':
   # Both models run every hour and are weighted by past-trained regime match.
   mix=spec[i,0]*fitness[i,0]+spec[i,1]*fitness[i,1]
   policy=int(np.argmax(mix));score=float(mix[policy]);used='SOFT_0_1'
  elif variant=='priority':
   # Both models score; worse-fit expert receives a fixed, ex-ante penalty
   # to prevent an off-regime model from dominating just from overfitting.
   raw=spec[i].copy()
   priority=raw-0.6*(1-fitness[i,:,None])
   head_policy=np.unravel_index(np.argmax(priority),priority.shape)
   policy=int(head_policy[1]);score=float(priority[head_policy])
   used=f'PARALLEL_{head_policy[0]}'
  else:raise ValueError(variant)
  if score<cutoff:continue
  r=dict(row)
  r.update({'policy':list(p.POLICIES)[policy],
            'expert':used,'regime':ri,
            'score':round(score,5),'regimeFitness':round(float(fitness[i,ri]),5),
            'fitFlowSell1':round(float(row['flow']['seller1']),5),
            'fitOI3Pct':round(float(row['flow']['oi3Pct']),4)})
  selected.append(r)
  next_free=int(r['exits'][r['policy']]['exitTs'])+COOLDOWN_H*p.screen.HOUR
 return selected
def sumby(rows):
 def one(rows,c):
  z=p.summarize(rows,c)
  z['regime0Count']=sum(r['regime']==0 for r in rows)
  z['regime1Count']=sum(r['regime']==1 for r in rows)
  z['expertCounts']=dict(collections.Counter(r['expert'] for r in rows))
  return z
 return {str(c):one(rows,c) for c in (10,30)}
def extract_masks(z):
 # Costs and exits are always post hoc for diagnostics.
 return {'train': [r for r in z if r['t']<p.TRAIN_END],
  'oldCal':[r for r in z if p.TRAIN_END<=r['t']<p.CAL_END],
  'recent':[r for r in z if p.NEW_BEGIN<=r['t']<p.NEW_END],
  'JAN_MAR_2026':[r for r in z if p.ms('2026-01-01')<=r['t']<p.ms('2026-04-01')],
  'APR_AUG_2026':[r for r in z if p.ms('2026-04-01')<=r['t']<p.ms('2026-08-10')]}
def group_summary(rows):
 return {name:sumby(values) for name,values in extract_masks(rows).items()}
def max_util(x):
 return float(np.max(x,axis=1).mean())
def attach_features(bars,btc,items):
 for r in items:
  i=int(r['index'])
  r['base']=p.screen.proc(bars,btc,i,i)
def main():
 j=json.loads((FLOW_RESULT/'RENDER_ORDERFLOW_SOURCE_MANIFEST_20261024.json').read_text('utf8'))
 assert all(v['expected']==v['valid'] for v in j['summary'].values())
 metrics,q=m.read_metrics(j['files']);mtimes=[z[0] for z in metrics]
 funding=m.read_funding(j['files'])
 ftimes=[z[0] for z in funding];frates=[z[1] for z in funding]
 older_bars=m.read_render_bars(j['files'],True)
 newer_bars=m.read_render_bars(j['files'],False)
 oldm=json.loads((REPO/'docs/research/results/idle-entry-three-20261024/IDLE_RENDER_OLDER_BINANCE_PUBLIC_M5_SOURCE_MANIFEST_20261024.json').read_text('utf8'))
 btc_old,_=p.old_mod.parse_months(oldm,'BTCUSDT')
 native=p.imp('native_regime_bootstrap',HERE/'research-residual-avax-composite-entry-veto-full8-20261023.py')
 provider,_=native.native.m.m.core.task8.legacy.bootstrap()
 btc_new,_=provider.getdata('BTCUSDT')
 native_render,_=provider.getdata('RENDERUSDT')
 assert len(native_render)==len(newer_bars) and all(a[0]==b[0] and a[4]==b[4] for a,b in zip(native_render,newer_bars))
 older=p.prepare(older_bars,btc_old,p.OLD_BEGIN,p.CAL_END,'older_dual')
 newer=p.prepare(newer_bars,btc_new,p.NEW_BEGIN,p.NEW_END,'newer_dual')
 for rows,bars,btc in ((older,older_bars,btc_old),(newer,newer_bars,btc_new)):
  attach_features(bars,btc,rows)
  cum=m.history_features(bars)
  for r in rows:
   fl=m.metrics_for_event(r,metrics,mtimes,ftimes,frates,bars,cum)
   if fl is not None:r['flow']=fl
 oldmiss=sum('flow' not in r for r in older);newmiss=sum('flow' not in r for r in newer)
 older=[r for r in older if 'flow' in r];newer=[r for r in newer if 'flow' in r]
 assert oldmiss<=10 and newmiss<=10
 n=sum(r['t']<p.TRAIN_END for r in older)
 med,std,centers=fit_regimes(older,n)
 a,afit,_=assignments(older,med,std,centers)
 b,bfit,_=assignments(newer,med,std,centers)
 print('TRAIN_REGIMES',[(int(np.sum(a[:n]==k)),centers[k].round(2).tolist()) for k in (0,1)],flush=True)
 print('NEW_REGIMES',collections.Counter(b.tolist()),flush=True)
 data={'status':'RESEARCH_ONLY_DUAL_REGIME_CAUSAL_FROZEN_EXPERTS_NOT_NATIVE8',
 'warning':['Historical 2025-26 evaluated before, not pristine untouched OOS',
            'Single-sleeve RENDER selection only, no 8-strategy shared-wallet dynamic reallocation',
            'Training and model cutoffs use pre-Apr2025 only; calibration Apr-Jul2025',
            'All metrics lag 10m, completed M5/H1 only, next M5 entry and stop-first fill'],
 'periods':{'train':'2024-08-10..2025-03-31','calibration':'2025-04-01..2025-07-31',
            'historicalRecheck':'2025-08-10..2026-08-09',
            'weakWinPeriod':'2026-01-01..2026-03-31',
            'strongWinPeriod':'2026-04-01..2026-08-09'},
 'dataset':{'olderCandidates':len(older),'newerCandidates':len(newer),
  'olderDiscardedMissingFeature':oldmiss,'newerDiscardedMissingFeature':newmiss,
  'regimeKeys':REGIME_KEYS+['ret6','btc24','rel6','hourRange'],
  'trainRegimeCounts':[int(np.sum(a[:n]==k)) for k in (0,1)],
  'trainCentroids':centers.tolist()},
 'models':{}}
 # Previously selected 24 native trades - separate from new signal bank.
 existing=json.loads((FLOW_RESULT/'RENDER_NATIVE_SELECTED24_OI_FLOW_ATTRIBUTION_20261024.json').read_text('utf8'))
 summary=[]
 timestamps=[r['t'] for r in newer]
 for t in existing['selectedTrades']:
  pos=bisect.bisect_left(timestamps,t['ts'])
  if pos<len(newer) and newer[pos]['t']==t['ts']:
   r=int(b[pos])
   summary.append({'t':t['ts'],'modelRegime':r,'win':t['win30']})
 data['native24Mapping']={'matchedNewBank':len(summary),
  'matchedRows':summary,'note':'Mapping to new independent signal bank is optional; native24 events have different entry contract.'}
 for basis in ('price','oi+taker','all'):
  oldX,newX=make_basis(older,newer,n)[basis]
  globalcoef,heads=fit_heads(older,oldX,n,a)
  global_train_max=np.max(oldX[:n]@globalcoef,axis=1)
  hard_train_max=np.max(np.stack([oldX[:n]@h for h in heads],axis=1)[np.arange(n),a[:n]],axis=1)
  soft_train_max=np.max(np.stack([oldX[:n]@h for h in heads],axis=1)[:,:,]*afit[:n,:,None].astype(float),axis=2).sum(axis=1) if False else None
  for variant in ('global','hard','soft','priority'):
   # threshold is frozen on old training predictions (not future behavior).
   train_select=(oldX[:n]@globalcoef if variant=='global' else None)
   if variant=='hard':train_select=np.stack([oldX[:n]@h for h in heads],axis=1)[np.arange(n),a[:n]]
   if variant=='soft':train_select=np.einsum('nk,nkj->nj',afit[:n],np.stack([oldX[:n]@h for h in heads],axis=1))
   if variant=='priority':train_select=np.max(np.stack([oldX[:n]@h for h in heads],axis=1)-.6*(1-afit[:n,:,None]),axis=1)
   assert train_select.shape==(n,len(p.POLICIES))
   for q in (.40,.60,.75):
    threshold=float(np.quantile(np.max(train_select,axis=1),q))
    o=select(older,oldX,a,afit,globalcoef,heads,threshold,variant)
    r=select(newer,newX,b,bfit,globalcoef,heads,threshold,variant)
    v={'description':f'{basis} model {variant} threshold train quantile {q}',
       'trainingThreshold':threshold,'variant':variant,'basis':basis,'quantile':q,
       'older':group_summary(o),'newer':group_summary(r)}
    key=f'{basis}_{variant}_q{q}'
    data['models'][key]=v
    oc=v['older']['oldCal']['30'];recent=v['newer']['recent']['30']
    weak=v['newer']['JAN_MAR_2026']['30'];strong=v['newer']['APR_AUG_2026']['30']
    print('DUAL',key,'OLD_CAL30',oc['n'],oc['pf'],'NEW30',
      recent['n'],recent['wrPct'],recent['pf'],'WEAK',weak['n'],weak['wrPct'],weak['pf'],
      'STRONG',strong['n'],strong['wrPct'],strong['pf'],flush=True)
    if 'priority'==variant:
     print('PRIORITY_COUNTS',key,v['newer']['recent']['30']['expertCounts'],flush=True)
 good=[(k,v) for k,v in data['models'].items()
       if v['older']['oldCal']['30']['n']>=18 and
          (v['older']['oldCal']['30']['pf'] or 0)>1 and
          (v['older']['oldCal']['10']['pf'] or 0)>1]
 data['frozenOldCalibrationPass']=[k for k,_ in good]
 chosen=[(k,v) for k,v in good if v['newer']['recent']['30']['n']>=24 and (v['newer']['recent']['30']['pf'] or 0)>1
  and (v['newer']['JAN_MAR_2026']['30']['pf'] or 0)>1 and (v['newer']['APR_AUG_2026']['30']['pf'] or 0)>1]
 data['retrospectiveStrictPassNotIndependentOOS']=[k for k,_ in chosen]
 output=OUT/'RENDER_CAUSAL_PARALLEL_TWO_REGIME_SCREEN_20261024.json'
 output.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
 print('CAL_PASS',data['frozenOldCalibrationPass'],'STRICT_HISTORICAL_PASS',data['retrospectiveStrictPassNotIndependentOOS'])
 print('OUTPUT',output)
if __name__=='__main__':main()
