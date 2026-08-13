from __future__ import annotations
import argparse,json,os,statistics
from pathlib import Path
import research_lab_pair_specific_v109 as v109

H=v109.HOUR
PAIRS=('BTC','ETH','BNB','SOL','LINK','AVAX')

def med(xs): return statistics.median(xs) if xs else None

def ctx(pair,candles,idx,ts):
    i=idx[pair].get(ts)
    if i is None or i<900:return None
    c=candles[pair]
    v24=v109.b.vol(c,i,24);v96=v109.b.vol(c,i,96);v336=v109.b.vol(c,i,336)
    if min(v96,v336)<=1e-12:return None
    rr12,rr48=v109.residual_feature(pair,candles,idx,ts)
    return {'i':i,'px':float(c[i]['close']),'r3':v109.ret(c,i,3) or 0,'r6':v109.ret(c,i,6) or 0,'r12':v109.ret(c,i,12) or 0,'r24':v109.ret(c,i,24) or 0,'r72':v109.ret(c,i,72) or 0,
            'vr':v24/v96,'v24':v24,'v96':v96,'v336':v336,'breadth':v109.b.breadth(candles,idx,ts,24),'rr12':rr12,'rr48':rr48}

def entry_dir(pair,arch,x,prev,pr,th):
    frozen=x['v24']<3.2*x['v336']
    if not frozen:return 0,None,1.0
    d=1 if pr>=th else -1 if pr<=-th else 0
    if pair in ('SOL','LINK'):
        return (d,'V109_PRIMARY',1.0) if d else (0,None,1.0)
    if pair=='ETH':
        if d:return d,'V109_PRIMARY',1.0
        if arch=='ETH_LAG_CATCHUP' and prev:
            if x['rr48']<0 and prev['rr12']<=0<x['rr12'] and x['r6']>0 and x['r12']>0 and x['breadth']>=.5:return 1,'SECONDARY',.33
            if x['rr48']>0 and prev['rr12']>=0>x['rr12'] and x['r6']<0 and x['r12']<0 and x['breadth']<=.5:return -1,'SECONDARY',.33
        return 0,None,1.0
    if pair=='AVAX':
        if d:return d,'V109_PRIMARY',1.0
        if arch=='AVAX_COMPRESSION_EVENT' and prev:
            if prev['vr']<.85 and x['vr']>=1 and x['r6']>0 and x['r12']>0 and x['breadth']>=.5:return 1,'SECONDARY',.33
            if prev['vr']<.85 and x['vr']>=1 and x['r6']<0 and x['r12']<0 and x['breadth']<=.5:return -1,'SECONDARY',.33
        return 0,None,1.0
    if pair=='BTC':
        if arch=='BTC_PULLBACK_RECLAIM' and prev:
            if x['r72']>0 and prev['r6']<=0<x['r6'] and x['r12']>0 and x['breadth']>=.5:return 1,'FRESH_ENTRY',1.0
            if x['r72']<0 and prev['r6']>=0>x['r6'] and x['r12']<0 and x['breadth']<=.5:return -1,'FRESH_ENTRY',1.0
        if arch=='BTC_COMPRESSION_IMPULSE' and prev:
            if prev['vr']<.75 and x['vr']>prev['vr'] and x['r6']>0 and x['r12']>0:return 1,'FRESH_ENTRY',1.0
            if prev['vr']<.75 and x['vr']>prev['vr'] and x['r6']<0 and x['r12']<0:return -1,'FRESH_ENTRY',1.0
        return 0,None,1.0
    if pair=='BNB':
        if arch=='BNB_TREND_REACCEL' and prev:
            if x['r72']>0 and prev['r6']<=0<x['r6'] and x['r12']>0 and x['breadth']>=.5:return 1,'FRESH_ENTRY',1.0
            if x['r72']<0 and prev['r6']>=0>x['r6'] and x['r12']<0 and x['breadth']<=.5:return -1,'FRESH_ENTRY',1.0
        if arch=='BNB_SPONSOR_ROTATION' and prev:
            if prev['breadth']<.5<=x['breadth'] and x['r6']>0 and x['r12']>0:return 1,'FRESH_ENTRY',1.0
            if prev['breadth']>.5>=x['breadth'] and x['r6']<0 and x['r12']<0:return -1,'FRESH_ENTRY',1.0
        return 0,None,1.0
    return 0,None,1.0

def simulate(pair,arch,candles,idx,start,end,cost_bps,delay,model):
    c=candles[pair];th=model['threshold'];state=0;entry=peak=trough=None;entry_i=entry_ts=signal_ts=None;source=None;mult=1.0;vals=[];recs=[];extension=False
    def close(ts,i,reason):
        nonlocal state,entry,peak,trough,entry_i,entry_ts,signal_ts,source,mult,extension
        xi=i+1+delay
        if xi>=len(c) or int(c[xi]['ts'])>=end:xi=i;xp=float(c[i]['close'])
        else:xp=float(c[xi]['open'])
        gross=state*((xp/entry-1)*100);pnl=(gross-cost_bps/100.0)*v109.RISK[pair]*mult
        lo,hi=min(entry_i,xi),max(entry_i,xi);hs=[float(c[j].get('high',c[j]['close'])) for j in range(lo,hi+1)];ls=[float(c[j].get('low',c[j]['close'])) for j in range(lo,hi+1)]
        mfe=(max(hs)/entry-1)*100 if state>0 else (entry/min(ls)-1)*100;mae=(min(ls)/entry-1)*100 if state>0 else (entry/max(hs)-1)*100
        recs.append({'pair':pair,'arch':arch,'source':source,'side':'LONG' if state>0 else 'SHORT','entryTs':entry_ts,'exitTs':int(c[xi]['ts']),'heldHours':(int(c[xi]['ts'])-entry_ts)/H,'pnl':pnl,'mfePct':mfe,'maePct':mae,'exitReason':reason,'sizeMult':mult})
        vals.append(pnl);state=0;entry=peak=trough=None;entry_i=entry_ts=signal_ts=None;source=None;mult=1.0;extension=False
    for row in c:
        ts=int(row['ts'])
        if not(start<=ts<end):continue
        x=ctx(pair,candles,idx,ts)
        if x is None:continue
        i=x['i'];pr=v109.predict('regime_wave',pair,candles,idx,ts,model);px=x['px']
        if state:
            peak=max(peak,px);trough=min(trough,px);held=(ts-signal_ts)//H
            fav=(peak/entry-1)*100 if state>0 else (entry/trough-1)*100
            cur=state*(px/entry-1)*100
            adverse_peak=(px/peak-1)*100 if state>0 else (trough/px-1)*100
            decay=(state>0 and pr<.10*th) or (state<0 and pr>-.10*th)
            trail=adverse_peak<=-v109.TRAIL[pair]
            reason=None
            if trail:reason='FROZEN_TRAIL'
            elif pair=='SOL':
                # V109 entry unchanged. On decay, profitable medium-supported waves become extension owners.
                if decay and not extension:
                    if fav>0 and x['r12']*state>0 and x['r24']*state>0: extension=True
                    else: reason='PREDICTOR_DECAY'
                if extension and reason is None:
                    # Directly attack MFE giveback: retain only while fast/medium direction survives and at least half of peak excursion remains.
                    if x['r6']*state<=0 or x['r12']*state<=0 or (fav>0 and cur<.5*fav):reason='PROFIT_LOCK_RELEASE'
                if reason is None and held>=144:reason='MAXHOLD'
            elif pair=='LINK':
                # Exact V2 staged 24h->48h handoff champion structure.
                if held>=24:
                    adverse_entry=(entry/trough-1)*100 if state>0 else (peak/entry-1)*100
                    quality=fav>adverse_entry and pr*state>=0 and x['r12']*state>0 and x['r24']*state>0
                    if held>=48:reason='FORECAST_END'
                    elif not quality:reason='24H_HANDOFF_CASH'
                elif decay:reason='PREDICTOR_DECAY'
            elif source=='SECONDARY':
                if pair=='ETH' and (held>=48 or x['rr12']*state<=0 or x['r12']*state<=0):reason='SECONDARY_END'
                elif pair=='AVAX' and (held>=48 or x['vr']<1 or x['r6']*state<=0):reason='SECONDARY_END'
            else:
                # Fresh BTC/BNB entries and ETH/AVAX primary use causal direction-loss exits; no extra entry filters.
                if source=='V109_PRIMARY':
                    if decay:reason='PREDICTOR_DECAY'
                    elif held>=144:reason='MAXHOLD'
                else:
                    if x['r6']*state<=0 and x['r12']*state<=0:reason='DIRECTION_LOSS'
                    elif held>=96:reason='MAXHOLD'
            if reason:close(ts,i,reason);continue
        if state:continue
        prev=ctx(pair,candles,idx,ts-6*H)
        d,src,m=entry_dir(pair,arch,x,prev,pr,th)
        if d:
            ei=i+1+delay
            if ei<len(c) and int(c[ei]['ts'])<end:
                state=d;entry_i=ei;entry_ts=int(c[ei]['ts']);signal_ts=ts;entry=float(c[ei]['open']);peak=entry;trough=entry;source=src;mult=m;extension=False
    if state:
        last=max(int(r['ts']) for r in c if start<=int(r['ts'])<end);close(last,idx[pair][last],'PERIOD_END')
    return vals,recs

def summary(vals,recs):
    m=v109.metric(vals);total=sum(vals);wins=sorted(vals,reverse=True)
    if vals:
        bi=max(range(len(vals)),key=lambda j:vals[j]);wo=[x for j,x in enumerate(vals) if j!=bi];pfwo=v109.metric(wo).get('pf') if wo else None
    else:pfwo=None
    m.update({'pfWithoutBest':pfwo,'top5ContributionPct':100*sum(wins[:5])/total if abs(total)>1e-9 else None,'medianMfePct':med([r['mfePct'] for r in recs]),'medianMaePct':med([r['maePct'] for r in recs]),'primaryTrades':sum(r.get('source')=='V109_PRIMARY' for r in recs),'secondaryTrades':sum(r.get('source')=='SECONDARY' for r in recs)})
    return m

def candidate_arches(pair):
    return {
      'BTC':['BTC_PULLBACK_RECLAIM','BTC_COMPRESSION_IMPULSE'],
      'BNB':['BNB_TREND_REACCEL','BNB_SPONSOR_ROTATION'],
      'ETH':['ETH_PRIMARY_ONLY','ETH_LAG_CATCHUP'],
      'AVAX':['AVAX_PRIMARY_ONLY','AVAX_COMPRESSION_EVENT'],
      'SOL':['SOL_PROFIT_LOCK_REVALIDATE'],
      'LINK':['LINK_V2_STAGED_HANDOFF'],
    }[pair]

def run(pair):
    candles,idx,_=v109.b.base.load();ps=v109.b.base.periods(candles);model=v109.train('regime_wave',pair,candles,idx,*ps['development'])
    # Development-only structural selection. Validation is never used to choose the architecture.
    devrows=[]
    for arch in candidate_arches(pair):
        actual_arch=arch
        if arch=='ETH_PRIMARY_ONLY': actual_arch='ETH_NONE'
        if arch=='AVAX_PRIMARY_ONLY': actual_arch='AVAX_NONE'
        vals,recs=simulate(pair,actual_arch,candles,idx,*ps['development'],v109.NORMAL_BPS,0,model);sm=summary(vals,recs)
        devrows.append({'arch':arch,'actualArch':actual_arch,'metric':sm,'vals':vals,'recs':recs})
    viable=[r for r in devrows if r['metric'].get('trades',0)>=8 and r['metric'].get('returnPct',0)>0 and (r['metric'].get('pf') or 0)>1]
    chosen=max(viable,key=lambda r:(r['metric'].get('returnPct',-999),r['metric'].get('pf',0))) if viable else max(devrows,key=lambda r:r['metric'].get('returnPct',-999))
    arch=chosen['actualArch']
    vv,vr=simulate(pair,arch,candles,idx,*ps['validation'],v109.NORMAL_BPS,0,model);sv,sr=simulate(pair,arch,candles,idx,*ps['validation'],v109.STRESS_BPS,1,model)
    bv,_=v109.pair_trades('regime_wave',pair,candles,idx,*ps['validation'],v109.NORMAL_BPS,0,model)
    out={'researchLine':'PAIRWISE_PROFIT_ATTRIBUTION_V4','pair':pair,'selectedBy':'DEVELOPMENT_ONLY','selectedArch':chosen['arch'],'confirmation':'UNTOUCHED','holdout':'UNTOUCHED','frozenV109Changed':False,
         'developmentCandidates':[{k:v for k,v in r.items() if k in ('arch','metric')} for r in devrows],
         'development':chosen['metric'],'validation':summary(vv,vr),'validationStress':summary(sv,sr),'validationBaselineV109':v109.metric(bv)}
    v=out['validation'];s=out['validationStress'];d=out['development']
    adequate=d.get('trades',0)>=8 and v.get('trades',0)>=6
    robust=d.get('returnPct',0)>0 and v.get('returnPct',0)>0 and (d.get('pf') or 0)>=1.2 and (v.get('pf') or 0)>=1.2 and (s.get('pf') or 0)>1 and v.get('maxDDPct',-999)>-20 and (v.get('pfWithoutBest') or 0)>=1
    out['status']='PASS' if adequate and robust else 'FAIL'
    root=Path(os.environ.get('RESEARCH_STATE_DIR','.research-state'));root.mkdir(parents=True,exist_ok=True);p=root/f'{pair.lower()}-profit-attribution-v4.json';p.write_text(json.dumps(out,indent=2),encoding='utf-8');print(json.dumps(out,indent=2))

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--pair',choices=PAIRS,required=True);run(ap.parse_args().pair)
