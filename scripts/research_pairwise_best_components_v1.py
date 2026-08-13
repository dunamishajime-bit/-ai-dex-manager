from __future__ import annotations
import argparse,json,os,statistics
from pathlib import Path
import research_lab_pair_specific_v109 as v109

PAIR_CFG={
 'BTC':{'role':'V109 wave entry + profitable predictor-decay ownership extension','maxhold':144},
 'ETH':{'role':'V109 wave entry + residual/medium-supported ownership extension','maxhold':144},
 'BNB':{'role':'V109 wave entry + relative/breadth-supported tactical ownership','maxhold':96},
 'SOL':{'role':'V109 high-profit wave entry + profitable medium/slow ownership extension','maxhold':144},
 'LINK':{'role':'V109 broad entry + staged 24h->48h forecast handoff','maxhold':48},
 'AVAX':{'role':'V109 entry + volatility-event directional ownership router','maxhold':96},
}
H=v109.HOUR

def med(xs): return statistics.median(xs) if xs else None

def ctx(pair,candles,idx,ts):
    i=idx[pair].get(ts)
    if i is None or i<900:return None
    c=candles[pair]; v24=v109.b.vol(c,i,24);v96=v109.b.vol(c,i,96);v336=v109.b.vol(c,i,336)
    if min(v96,v336)<=1e-12:return None
    return {'i':i,'px':float(c[i]['close']),'r6':v109.ret(c,i,6) or 0,'r12':v109.ret(c,i,12) or 0,'r24':v109.ret(c,i,24) or 0,'vr':v24/v96,'v24':v24,'v336':v336,'breadth':v109.b.breadth(candles,idx,ts,24)}

def simulate(pair,candles,idx,start,end,cost_bps,delay,model):
    c=candles[pair];th=model['threshold'];state=0;entry=peak=trough=None;entry_i=entry_ts=signal_ts=None;vals=[];recs=[]
    def close(ts,i,reason):
        nonlocal state,entry,peak,trough,entry_i,entry_ts,signal_ts
        xi=i+1+delay
        if xi>=len(c) or int(c[xi]['ts'])>=end: xi=i; xp=float(c[i]['close'])
        else: xp=float(c[xi]['open'])
        gross=state*((xp/entry-1)*100);pnl=(gross-cost_bps/100.0)*v109.RISK[pair]
        lo,hi=min(entry_i,xi),max(entry_i,xi);hs=[float(c[j].get('high',c[j]['close'])) for j in range(lo,hi+1)];ls=[float(c[j].get('low',c[j]['close'])) for j in range(lo,hi+1)]
        mfe=(max(hs)/entry-1)*100 if state>0 else (entry/min(ls)-1)*100
        mae=(min(ls)/entry-1)*100 if state>0 else (entry/max(hs)-1)*100
        recs.append({'pair':pair,'side':'LONG' if state>0 else 'SHORT','entryTs':entry_ts,'exitTs':int(c[xi]['ts']),'heldHours':(int(c[xi]['ts'])-entry_ts)/H,'pnl':pnl,'mfePct':mfe,'maePct':mae,'exitReason':reason})
        vals.append(pnl);state=0;entry=peak=trough=None;entry_i=entry_ts=signal_ts=None
    for row in c:
        ts=int(row['ts'])
        if not(start<=ts<end):continue
        x=ctx(pair,candles,idx,ts)
        if x is None:continue
        i=x['i'];pr=v109.predict('regime_wave',pair,candles,idx,ts,model);px=x['px']
        if state:
            peak=max(peak,px);trough=min(trough,px);held=(ts-signal_ts)//H
            fav=(peak/entry-1)*100 if state>0 else (entry/trough-1)*100
            adverse=(px/peak-1)*100 if state>0 else (trough/px-1)*100
            trail=adverse<=-v109.TRAIL[pair]
            decay=(state>0 and pr<.10*th) or (state<0 and pr>-.10*th)
            reason=None
            if trail: reason='FROZEN_TRAIL'
            elif pair=='LINK':
                if held>=24:
                    owner_ok=fav>0 and pr*state>=0 and x['r12']*state>0 and x['r24']*state>0
                    if held<48 and owner_ok: pass
                    else: reason='STAGED_FORECAST_RELEASE' if held<48 else 'FORECAST_END'
                elif decay: reason='PREDICTOR_DECAY'
            elif pair=='SOL':
                if decay and not (fav>0 and x['r12']*state>0 and x['r24']*state>0): reason='PREDICTOR_DECAY'
                elif held>=144: reason='MAXHOLD'
            elif pair=='BTC':
                if decay and not (fav>0 and x['r12']*state>0 and x['r24']*state>0): reason='PREDICTOR_DECAY'
                elif held>=144: reason='MAXHOLD'
            elif pair=='ETH':
                rr12,_=v109.residual_feature(pair,candles,idx,ts)
                if decay and not (fav>0 and x['r12']*state>0 and rr12*state>0): reason='PREDICTOR_DECAY'
                elif held>=144: reason='MAXHOLD'
            elif pair=='BNB':
                sponsor=1 if x['breadth']>.5 else -1 if x['breadth']<.5 else 0
                if decay and not (fav>0 and x['r6']*state>0 and x['r12']*state>0 and sponsor==state): reason='TACTICAL_RELEASE'
                elif held>=96: reason='MAXHOLD'
            elif pair=='AVAX':
                event_support=x['vr']>=1 and x['r6']*state>0 and x['r12']*state>0
                if decay and not (fav>0 and event_support): reason='EVENT_RELEASE'
                elif held>=96: reason='EVENT_EXPIRY'
            if reason: close(ts,i,reason);continue
        if state: continue
        d=1 if pr>=th else -1 if pr<=-th else 0
        if d and x['v24']<3.2*x['v336']:
            ei=i+1+delay
            if ei<len(c) and int(c[ei]['ts'])<end:
                state=d;entry_i=ei;entry_ts=int(c[ei]['ts']);signal_ts=ts;entry=float(c[ei]['open']);peak=entry;trough=entry
    if state:
        last=max(int(r['ts']) for r in c if start<=int(r['ts'])<end);close(last,idx[pair][last],'PERIOD_END')
    return vals,recs

def summary(vals,recs):
    m=v109.metric(vals);wins=sorted([r['pnl'] for r in recs],reverse=True);base=sum(vals)
    m.update({'pfWithoutBest':v109.metric(vals[1:] if vals and vals[0]==max(vals) else [x for k,x in enumerate(vals) if k!=max(range(len(vals)),key=lambda j:vals[j])] if vals else []).get('pf') if vals else None,
              'top5ContributionPct':100*sum(wins[:5])/base if abs(base)>1e-9 else None,'medianMfePct':med([r['mfePct'] for r in recs]),'medianMaePct':med([r['maePct'] for r in recs])})
    return m

def run(pair):
    candles,idx,_=v109.b.base.load();ps=v109.b.base.periods(candles);model=v109.train('regime_wave',pair,candles,idx,*ps['development'])
    out={'pair':pair,'role':PAIR_CFG[pair]['role'],'confirmation':'UNTOUCHED','holdout':'UNTOUCHED','frozenV109Changed':False,'periods':{'development':ps['development'],'validation':ps['validation']}}
    for name,period in [('development',ps['development']),('validation',ps['validation'])]:
        bv,br=v109.pair_trades('regime_wave',pair,candles,idx,*period,v109.NORMAL_BPS,0,model);cv,cr=simulate(pair,candles,idx,*period,v109.NORMAL_BPS,0,model)
        out[name]={'baseline':summary(bv,[{'pnl':x,'mfePct':0,'maePct':0} for x in bv]),'composite':summary(cv,cr)}
        bret=out[name]['baseline'].get('returnPct',0);cret=out[name]['composite'].get('returnPct',0)
        out[name]['returnDeltaPctPt']=cret-bret;out[name]['returnRetentionPct']=100*cret/bret if abs(bret)>1e-9 else None
    sv,sr=simulate(pair,candles,idx,*ps['validation'],v109.STRESS_BPS,1,model);out['validationStress']=summary(sv,sr)
    v=out['validation']['composite'];b=out['validation']['baseline'];out['status']='PASS' if v.get('returnPct',0)>0 and (v.get('pf') or 0)>=1.2 and (out['validationStress'].get('pf') or 0)>1 and v.get('maxDDPct',-999)>-20 and out['validation']['returnDeltaPctPt']>=0 else 'FAIL'
    root=Path(os.environ.get('RESEARCH_STATE_DIR','.research-state'));root.mkdir(parents=True,exist_ok=True);p=root/f'{pair.lower()}-best-components-v1.json';p.write_text(json.dumps(out,indent=2),encoding='utf-8');print(json.dumps(out,indent=2))
if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--pair',choices=tuple(PAIR_CFG),required=True);run(ap.parse_args().pair)
