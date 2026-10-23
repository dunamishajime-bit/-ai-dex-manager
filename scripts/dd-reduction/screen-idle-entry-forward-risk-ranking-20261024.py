#!/usr/bin/env python3
"""Non-production chronological frozen-fit risk ranking on raw IDLE candidate opportunities.
Train first half, purge nonfinal train outcomes, apply unchanged to second half.
Candidate exits are ex-post model labels ONLY, never entrance features; historical late
half has prior research exposure and is not untouched OOS. Not native full8.
"""
from __future__ import annotations
import bisect,collections,datetime,hashlib,importlib.util,json,math
from pathlib import Path
import numpy as np
HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
ROOT=Path('C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-22_hype_entry_plus_exit_full8')
ANCHOR=ROOT/'rv24penguInitialCombinedNormal8Recovery24'
CASE='NORMAL_8H_HARDCOOL_PLUS_RECOVERY_24H_3P'
OUT=REPO/'docs/research/results/idle-entry-three-20261024'
SYMS=('RENDERUSDT','DOTUSDT','JUPUSDT')
SPLIT=1770681600000
DAY=86400000
FEATS=('ret1h','ret3h','ret6h','rel3h','rel6h','btc3h','btc6h','volratio','atr3h','rangepos3h')
def load(name,file):
 p=HERE/file;spec=importlib.util.spec_from_file_location(name,p)
 m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
screen=load('wf_features_m5', 'screen-idle-five-symbol-entry-caused-20261022.py')
native=load('wf_anchor_source','research-residual-avax-composite-entry-veto-full8-20261023.py')
def checksum(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1<<20),b''):h.update(b)
 return h.hexdigest()
def ledger_path(cost):
 j=json.loads((ANCHOR/'PENGU_TIMED_NEGATIVE_NATIVE_FULL8_20261023.json').read_text('utf8'))
 wanted=j['cases'][CASE]['costs'][str(cost)]['ledgerSha256']
 for p in (ANCHOR/'engine').rglob('portfolio-trades.jsonl'):
  if checksum(p)==wanted:return p
 raise RuntimeError('LEDGER_SHA_NOT_FOUND:'+wanted)
def stat(rows):
 n=len(rows);w=sum(x['win'] for x in rows)
 return {'n':n,'wins':w,'wrPct':round(100*w/n,2) if n else None,
  'returnSumPct':round(sum(x['netRetPct'] for x in rows),3)}
def apply_stats(rows,threshold):
 good=[x for x in rows if x['riskScore']>=threshold]
 bad=[x for x in rows if x['riskScore']<threshold]
 return {'all':stat(rows),'admit':stat(good),'reject':stat(bad),
 'retainedPct':round(100*len(good)/len(rows),2) if rows else None}
def logistic(X,y,weights):
 n,k=X.shape
 means=X.mean(axis=0);scales=X.std(axis=0)
 scales[scales<1e-6]=1.0
 Z=np.clip((X-means)/scales,-3,3)
 Z=np.c_[np.ones(n),Z]
 beta=np.zeros(k+1);beta[0]=math.log((np.mean(y)+.03)/(1-np.mean(y)+.03))
 reg=.15
 for i in range(550):
  logits=np.clip(Z@beta,-20,20)
  pred=1/(1+np.exp(-logits))
  g=Z.T@(weights*(pred-y))/sum(weights)
  g[1:]+=reg*beta[1:]
  beta-=.08*g
 return means,scales,beta
def score(x,model):
 means,scales,beta=model
 v=np.array([x['features'][k] for k in FEATS],float)
 z=np.r_[1.0,np.clip((v-means)/scales,-3,3)]
 logit=float(z@beta)
 return 1/(1+math.exp(-max(-20,min(20,logit))))
def metric(rows,field='netRetPct'):
 pos=[z[field] for z in rows if z[field]>0]
 neg=[z[field] for z in rows if z[field]<=0]
 return round(sum(pos)/abs(sum(neg)),3) if sum(neg)<0 else None
def run():
 output={'status':'CANDIDATE_MODEL_SCREEN_NOT_SHARED_WALLET_NOT_LIVE',
  'splitEpochMs':SPLIT,'timeSplitIsNotUntouchedHoldout':True,
  'trainingPurge':'all label exits before split minus 24h',
  'riskScoreThreshold':'training 20th percentile applied unchanged to later windows',
  'predictors':FEATS,'costs':{},'note':(
   'Pure historical conditional probability study. Rejected candidate hypothetical exits are labels, '
   'not venue fills. Correlated hourly candidates weighted equally within each symbol-day.')}
 source,_=native.native.m.m.core.task8.legacy.bootstrap()
 for cost in (10,30):
  p=ledger_path(cost)
  output['costs'][str(cost)]={'sha':checksum(p),'symbols':{}}
  dec=p.parent/'candidate-decisions.jsonl'
  raw=collections.defaultdict(list)
  with dec.open('r',encoding='utf8') as f:
   for line in f:
    x=json.loads(line)
    sym=x.get('symbol')
    if x.get('strategy_id')!='IDLE' or sym not in SYMS or x.get('side')!='SHORT':continue
    price=x.get('candidate_entry_price_usd');exit=x.get('candidate_exit_price_usd')
    if price is None or exit is None:continue
    ts=int(x['entry_ts_ms']);xts=int(x['candidate_exit_ts_ms'])
    if xts<=ts or float(price)<=0 or float(exit)<=0:continue
    z=screen.get_feat(source,sym,ts)
    if z is None:continue
    if not all(k in z and z[k] is not None and math.isfinite(z[k]) for k in FEATS):continue
    ret=100*(float(price)-float(exit))/float(price)-cost/100.0
    raw[sym].append({'ts':ts,'exitTs':xts,'candidateId':x['candidate_id'],
      'netRetPct':round(ret,6),'win':ret>0,'features':{k:float(z[k]) for k in FEATS},
      'accepted':x.get('decision')=='ACCEPTED_MODELED_ENTRY',
      'route':x.get('route')})
  for sym in SYMS:
   rows=sorted(raw[sym],key=lambda x:(x['ts'],x['candidateId']))
   train=[x for x in rows if x['ts']<SPLIT-DAY and x['exitTs']<SPLIT-DAY]
   later=[x for x in rows if x['ts']>=SPLIT]
   assert len(train)>=15 and len(later)>=30,(sym,cost,len(train),len(later))
   X=np.array([[x['features'][k] for k in FEATS] for x in train],dtype=float)
   Y=np.array([x['win'] for x in train],dtype=float)
   days=collections.Counter(x['ts']//DAY for x in train)
   W=np.array([1.0/days[x['ts']//DAY] for x in train])
   model=logistic(X,Y,W)
   for x in train+later:x['riskScore']=score(x,model)
   threshold=float(np.quantile([x['riskScore'] for x in train],0.2))
   byTime={'train':apply_stats(train,threshold),'later':apply_stats(later,threshold)}
   acceptedTime={'train':apply_stats([x for x in train if x['accepted']],threshold),
      'later':apply_stats([x for x in later if x['accepted']],threshold)}
   for subset in (train,later):
    assert all(x['features']['ret1h'] is not None for x in subset)
   output['costs'][str(cost)]['symbols'][sym]={
     'trainN':len(train),'lateN':len(later),
     'trainingDays':len(days),'trainingInsufficientIndependentDays':len(days)<20,'riskThreshold':round(threshold,6),
     'trainLabels':stat(train),'lateLabels':stat(later),
     'allRawCandidates':byTime,'acceptedPortfolioCandidates':acceptedTime,
     'trainingTopPositiveCoefficients':sorted([
        [name,round(float(beta),4)] for name,beta in zip(FEATS,model[2][1:])],
        key=lambda v:-v[1])[:3],
     'trainingTopNegativeCoefficients':sorted([
        [name,round(float(beta),4)] for name,beta in zip(FEATS,model[2][1:])],
        key=lambda v:v[1])[:3],
     'lateSelectedPF':metric([x for x in later if x['riskScore']>=threshold]),
     'lateUnselectedPF':metric([x for x in later if x['riskScore']<threshold]),
    }
   print('WF',cost,sym,'TRAIN',byTime['train'],'LATER',byTime['later'],
    'PORT_LATER',acceptedTime['later'],'PF',output['costs'][str(cost)]['symbols'][sym]['lateSelectedPF'],
    'DAY_TRAIN',len(days),flush=True)
 path=OUT/'IDLE_RENDER_DOT_JUP_FROZEN_TRAIN_CAUSAL_RISK_RANK_20261024.json'
 path.write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
 print('SAVED',path,path.stat().st_size,flush=True)
if __name__=='__main__':run()
