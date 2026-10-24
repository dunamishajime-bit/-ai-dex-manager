#!/usr/bin/env python3
"""Research-only RENDER SHORT: causal multi-regime, two-stage reversal and
cross-horizon risk/return ensemble. Train 2024-08..2025-03, calibrate
2025-04..07, freeze rules before replaying 2025-08..2026-08.
No VPS, orders, production code, or other trading strategies are touched.
OLDER/HOLDOUT were inspected in prior studies: NOT pristine OOS evidence.
"""
from __future__ import annotations
import datetime as dt, importlib.util, json, math, bisect, hashlib
from pathlib import Path
import numpy as np
HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
BASE=REPO/'docs/research/results/idle-entry-three-20261024'
OUT=REPO/'docs/research/results/render-multiregime-20261024'
OUT.mkdir(parents=True,exist_ok=True)
def imp(n,p):
    sp=importlib.util.spec_from_file_location(n,p)
    m=importlib.util.module_from_spec(sp); sp.loader.exec_module(m); return m
old_mod=imp('render_old_archive_loader',HERE/'evaluate-render-new-short-older-2024-2025-m5-20261024.py')
screen=imp('render_m5_retrace',HERE/'screen-render-fresh-rally-fade-m5-20261024.py')
def ms(x):return int(dt.datetime.fromisoformat(x).replace(tzinfo=dt.timezone.utc).timestamp()*1000)
TRAIN_END=ms('2025-04-01'); OLD_BEGIN=ms('2024-08-10'); CAL_END=ms('2025-08-01')
NEW_BEGIN=ms('2025-08-10'); NEW_END=ms('2026-08-10'); NEW_SPLIT=ms('2026-02-10')
POLICIES={'fast':(.0175,.025,6),'normal':(.0175,.025,12),'wide':(.02,.03,12)}
KEYS=['ret1','ret3','ret6','ret24','btc1','btc6','btc24','rel6','last15','last30',
      'first45','hourWick','priorRebound','hourRange','high24','rangePos1','rangePos24','volumeRatio']
def regime(f):
    b='BTC_BEAR' if f['btc24']<=-1.5 else ('BTC_BULL' if f['btc24']>=1.5 else 'BTC_RANGE')
    r='RENDER_DUMP' if f['ret24']<=-4 else ('RENDER_RALLY' if f['ret24']>=3 else 'RENDER_BALANCE')
    v='VOL_HIGH' if f['hourRange']>=2 else 'VOL_LOW'
    return b,r,v
def triggers(f,prev):
    # Two-stage: preparation from the PREVIOUS completed hour, then
    # lower-high/rejection on the current completed hour.
    prepare=prev['ret3']>=0.8 and (prev['priorRebound']>=0.6 or prev['rel6']>=0.7)
    confirm=(f['last15']<=-0.10 and f['hourWick']>=0.25
             and f['rangePos1']<=0.72 and f['last30']<=0.12)
    prior_failed_rally=prepare and confirm and f['ret3']>=-0.3
    # Alternative routes keep opportunity flow in bearish/trend environments.
    riskoff_break=f['btc24']<=-1.5 and f['ret24']<=-2 and f['last15']<=-0.18 and f['ret1']<=-0.2
    relative_top=f['rel6']>=1.2 and f['ret3']>=0.75 and f['last15']<=-0.16 and f['hourWick']>=0.35
    btc_up_trap=f['btc1']>=0.35 and f['ret3']>=1.0 and f['hourWick']>=0.45 and f['last15']<=-0.18
    return {'two_stage':prior_failed_rally,'bear_break':riskoff_break,
            'relative_top':relative_top,'btc_trap':btc_up_trap}
def rowfeatures(f,prev,tags):
    vals=[f[k] for k in KEYS]
    vals+= [f['ret1']-prev['ret1'],f['ret3']-prev['ret3'],
             f['btc6']-prev['btc6'], f['hourWick']-prev['hourWick'],
             max(0, f['ret3']-f['btc6']),
             max(0,-f['ret1']), max(0,f['hourWick']-.4)]
    vals+= [float(tags[k]) for k in ('two_stage','bear_break','relative_top','btc_trap')]
    b,r,v=regime(f)
    vals+= [float(b==x) for x in ('BTC_BEAR','BTC_BULL')]
    vals+= [float(r==x) for x in ('RENDER_DUMP','RENDER_RALLY')]
    vals+= [float(v=='VOL_HIGH')]
    return vals
def prepare(bars,btc,start,end,title):
    times=[int(x[0]) for x in bars]
    btct=[int(x[0]) for x in btc]
    candidate=[]
    for i in range(300,len(bars)-200):
        t=times[i]+screen.M5
        if t<start or t>=end or t%screen.HOUR: continue
        ib=bisect.bisect_left(btct,times[i])
        if ib<300 or ib>=len(btct) or btct[ib]!=times[i]:continue
        if times[i-289]!=times[i]-289*screen.M5 or btct[ib-289]!=btct[ib]-289*screen.M5:continue
        if times[i+1]!=t:continue
        f=screen.proc(bars,btc,i,ib)
        prev=screen.proc(bars,btc,i-12,ib-12)
        tags=triggers(f,prev)
        if not any(tags.values()):continue
        d={'t':t,'index':i,'feat':rowfeatures(f,prev,tags),
           'tags':[k for k,v in tags.items() if v],'regime':regime(f)}
        d['exits']={}
        for name,policy in POLICIES.items():
            d['exits'][name]=screen.settle(bars,i,*policy,30)
        candidate.append(d)
    print('EVENT_BANK',title,'n',len(candidate),'route_distribution',
          {k:sum(k in z['tags'] for z in candidate) for k in ('two_stage','bear_break','relative_top','btc_trap')},flush=True)
    return candidate
def make_X(older,newer):
    train=np.array([r['feat'] for r in older if r['t']<TRAIN_END],dtype=float)
    med=np.median(train,axis=0)
    scale=np.std(train,axis=0);scale=np.maximum(scale,.1)
    def expand(rows):
        v=np.array([r['feat'] for r in rows],dtype=float)
        x=np.clip((v-med)/scale,-4,4)
        # fixed causal interaction families: market regime x entry quality,
        # momentum deceleration and volatility x rejection strength
        pairs=[(0,4),(3,6),(7,6),(8,11),(10,11),(12,13),(1,15),
               (6,15),(14,16),(8,17),(9,17),(5,12),(22,11),
               (23,8),(18,3),(21,9),(24,4),(25,11),(27,8)]
        p=np.column_stack([x[:,a]*x[:,b] for a,b in pairs])
        # nonlinear saturation for asymmetric adverse movement
        u=np.column_stack([np.maximum(0,x[:,i]) for i in (0,1,3,5,8,11,13,17)])
        return np.column_stack([np.ones(len(rows)),x,p,u])
    return expand(older),expand(newer),int((np.array([r['t'] for r in older])<TRAIN_END).sum())
def fit(X,rows,trainN,alpha=120):
    y=np.array([[r['exits'][name]['netPct'] for name in POLICIES] for r in rows])
    a=X[:trainN];b=y[:trainN]
    penalty=np.eye(a.shape[1])*alpha;penalty[0,0]=0
    coef=np.linalg.solve(a.T@a+penalty,a.T@b)
    return coef
def summarize(chosen, cost):
    pnl=[z['exits'][z['policy']]['netPct']+(30-cost)/100 for z in chosen]
    plus=sum(x for x in pnl if x>0);minus=-sum(x for x in pnl if x<=0)
    equity=1.; peak=1.; maxdd=0
    for x in pnl:
        equity*=1+x/100;peak=max(peak,equity);maxdd=min(maxdd,100*(equity/peak-1))
    return {'n':len(pnl),'wins':sum(x>0 for x in pnl),'wrPct':round(100*sum(x>0 for x in pnl)/len(pnl),2) if pnl else None,
            'pf':round(plus/minus,4) if minus>0 else None,
            'sumPct':round(sum(pnl),3),'compoundPct':round((equity-1)*100,3),
            'closeDDPct':round(maxdd,3),'maxLossPct':round(min(pnl),3) if pnl else None,
            'byRoute':{k:sum(k in z['tags'] for z in chosen) for k in ('two_stage','bear_break','relative_top','btc_trap')}}
def pick(rows,X,coef,cutoff,agree=False):
    predictions=X@coef
    out=[];allowed=-1
    for j,row in enumerate(rows):
        if row['t']<allowed:continue
        scores=predictions[j]
        chosen_policy=int(np.argmax(scores))
        if scores[chosen_policy]<cutoff:continue
        if agree and sum(x>0 for x in scores)<2:continue
        item=dict(row)
        item['policy']=list(POLICIES)[chosen_policy]
        out.append(item)
        allowed=int(item['exits'][item['policy']]['exitTs'])+12*screen.HOUR
    return out
def main():
    manifest=json.loads((BASE/'IDLE_RENDER_OLDER_BINANCE_PUBLIC_M5_SOURCE_MANIFEST_20261024.json').read_text('utf8'))
    ob,ot=old_mod.parse_months(manifest,'RENDERUSDT');bc,bt=old_mod.parse_months(manifest,'BTCUSDT')
    assert ot==bt
    older=prepare(ob,bc,OLD_BEGIN,CAL_END,'older')
    native=imp('multiregime_native_m5',HERE/'research-residual-avax-composite-entry-veto-full8-20261023.py')
    source,_=native.native.m.m.core.task8.legacy.bootstrap()
    nb,nt=source.getdata('RENDERUSDT');bb,bs=source.getdata('BTCUSDT')
    newer=prepare(nb,bb,NEW_BEGIN,NEW_END,'newer')
    X,Y,trainN=make_X(older,newer)
    coef=fit(X,older,trainN)
    older_train=older[:trainN]
    trainPred=X[:trainN]@coef
    # Train-only quantiles; never select based on later-year outcomes
    strengths=trainPred.max(axis=1)
    variants={}
    for q in (.4,.6,.75,.85):
        threshold=float(np.quantile(strengths,q))
        for agree in (False,True):
            name=f'ensemble_quantile_{q:.2f}'+('_agreement2' if agree else '')
            train_sel=pick(older_train,X[:trainN],coef,threshold,agree)
            cal_sel=pick(older[trainN:],X[trainN:],coef,threshold,agree)
            new_sel=pick(newer,Y,coef,threshold,agree)
            newer_early=[r for r in new_sel if r['t']<NEW_SPLIT]
            newer_late=[r for r in new_sel if r['t']>=NEW_SPLIT]
            variants[name]={'rule':{'trainQuantile':q,'trainScoreThresholdPct':round(threshold,5),'requiresTwoPoliciesPositive':agree},
               'train':{str(c):summarize(train_sel,c) for c in (10,30)},
               'calibration':{str(c):summarize(cal_sel,c) for c in (10,30)},
               'newer':{str(c):summarize(new_sel,c) for c in (10,30)},
               'newerEarly':{str(c):summarize(newer_early,c) for c in (10,30)},
               'newerLate':{str(c):summarize(newer_late,c) for c in (10,30)}}
            s=variants[name]
            print('VARIANT',name,'cut',round(threshold,3),
                'OLDER_C',s['calibration']['30']['n'],s['calibration']['30']['pf'],
                'NEW',s['newer']['30']['n'],s['newer']['30']['wrPct'],s['newer']['30']['pf'],
                'NEW_LATE_PF',s['newerLate']['30']['pf'],flush=True)
    # choose only using calibration segment; no newer-performance tuning
    ordered=sorted(variants.items(),key=lambda kv:
        ((kv[1]['calibration']['30']['pf'] or 0) if kv[1]['calibration']['30']['n']>=8 else -100,
         kv[1]['calibration']['30']['n']),reverse=True)
    best=ordered[0][0]
    report={'status':'RESEARCH_ONLY_NO_ECONOMIC_FULL8_OR_UNSEEN_FORWARD_CERTIFICATION',
            'warning':'2024-25 data has been previously inspected; calibration not untouched OOS. 2025-26 was repeatedly researched and is not pristine OOS.',
            'contracts':{'train':'2024-08-10..2025-03-31','calibration':'2025-04-01..2025-07-31',
              'newer':'2025-08-10..2026-08-09','fiveMinuteStopFirst':True,'12hCooldown':True,
              'fundingIncluded':False,'venueFillsCertified':False,'shared8Wallet':False,
              'paramChoiceUsesNewerOutcomes':False},
            'algorithm':'Causal two-stage multi-regime event OR; ridge ensemble of 3 exit policies with BTC/RENDER price and volatility interactions',
            'candidateN':{'older':len(older),'olderTrain':trainN,'olderCalibration':len(older)-trainN,'newer':len(newer)},
            'regularization':120,'featureCount':X.shape[1],
            'calibrationSelected':best,'all':variants}
    outfile=OUT/'RENDER_MULTIREGIME_ENS_HISTORICAL_SCREEN_20261024.json'
    outfile.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print('SELECTED_FROM_CALIBRATION',best,'NEW30',variants[best]['newer']['30'],
          'NEWER_EARLY30',variants[best]['newerEarly']['30'],
          'NEWER_LATE30',variants[best]['newerLate']['30'],flush=True)
    print('EVIDENCE',outfile)
if __name__=='__main__':main()
