from __future__ import annotations
import argparse,json,os,statistics
from pathlib import Path
import research_lab_pair_specific_v109 as v109

H=v109.HOUR
PAIRS=('BTC','ETH','BNB','SOL','LINK','AVAX')
ROLE={
 'BTC':'V109 primary + breadth-sponsored profitable wave ownership',
 'ETH':'V109 primary + residual-rotation secondary scout + medium ownership',
 'BNB':'V109 primary + compression-release tactical secondary scout',
 'SOL':'V109 high-profit primary + breadth-gated profitable ownership extension',
 'LINK':'V109 broad primary + quality-gated 24h->48h forecast handoff',
 'AVAX':'V109 primary + volatility-event directional secondary scout',
}

def med(xs): return statistics.median(xs) if xs else None

def ctx(pair,candles,idx,ts):
    i=idx[pair].get(ts)
    if i is None or i<900:return None
    c=candles[pair];v24=v109.b.vol(c,i,24);v96=v109.b.vol(c,i,96);v336=v109.b.vol(c,i,336)
    if min(v96,v336)<=1e-12:return None
    rr12,rr48=v109.residual_feature(pair,candles,idx,ts)
    return {'i':i,'px':float(c[i]['close']),'r3':v109.ret(c,i,3) or 0,'r6':v109.ret(c,i,6) or 0,'r12':v109.ret(c,i,12) or 0,'r24':v109.ret(c,i,24) or 0,
            'vr':v24/v96,'v24':v24,'v96':v96,'v336':v336,'breadth':v109.b.breadth(candles,idx,ts,24),'rr12':rr12,'rr48':rr48}

def secondary_direction(pair,x,prev):
    if pair=='ETH':
        # Residual rotation: previously lagging/neutral medium residual becomes fast leader with absolute support.
        if prev and prev['rr12']<=0 < x['rr12'] and x['r6']>0 and x['r12']>0 and x['breadth']>=.5:return 1
        if prev and prev['rr12']>=0 > x['rr12'] and x['r6']<0 and x['r12']<0 and x['breadth']<=.5:return -1
    elif pair=='BNB':
        # Compression -> release, direction from fast+medium absolute move.
        if prev and prev['vr']<1 and x['vr']>=1 and x['r6']>0 and x['r12']>0:return 1
        if prev and prev['vr']<1 and x['vr']>=1 and x['r6']<0 and x['r12']<0:return -1
    elif pair=='AVAX':
        # Volatility event route: fresh expansion with synchronized 6h/12h direction.
        if prev and x['vr']>prev['vr'] and x['vr']>=1 and x['r6']>0 and x['r12']>0:return 1
        if prev and x['vr']>prev['vr'] and x['vr']>=1 and x['r6']<0 and x['r12']<0:return -1
    return 0

def simulate(pair,candles,idx,start,end,cost_bps,delay,model):
    c=candles[pair];th=model['threshold'];state=0;entry=peak=trough=None;entry_i=entry_ts=signal_ts=None;source=None;size_mult=1.0;vals=[];recs=[]
    def close(ts,i,reason):
        nonlocal state,entry,peak,trough,entry_i,entry_ts,signal_ts,source,size_mult
        xi=i+1+delay
        if xi>=len(c) or int(c[xi]['ts'])>=end:xi=i;xp=float(c[i]['close'])
        else:xp=float(c[xi]['open'])
        gross=state*((xp/entry-1)*100);pnl=(gross-cost_bps/100.0)*v109.RISK[pair]*size_mult
        lo,hi=min(entry_i,xi),max(entry_i,xi);hs=[float(c[j].get('high',c[j]['close'])) for j in range(lo,hi+1)];ls=[float(c[j].get('low',c[j]['close'])) for j in range(lo,hi+1)]
        mfe=(max(hs)/entry-1)*100 if state>0 else (entry/min(ls)-1)*100;mae=(min(ls)/entry-1)*100 if state>0 else (entry/max(hs)-1)*100
        recs.append({'pair':pair,'source':source,'side':'LONG' if state>0 else 'SHORT','entryTs':entry_ts,'exitTs':int(c[xi]['ts']),'heldHours':(int(c[xi]['ts'])-entry_ts)/H,'pnl':pnl,'mfePct':mfe,'maePct':mae,'exitReason':reason,'sizeMult':size_mult})
        vals.append(pnl);state=0;entry=peak=trough=None;entry_i=entry_ts=signal_ts=None;source=None;size_mult=1.0
    for row in c:
        ts=int(row['ts'])
        if not(start<=ts<end):continue
        x=ctx(pair,candles,idx,ts)
        if x is None:continue
        i=x['i'];pr=v109.predict('regime_wave',pair,candles,idx,ts,model);px=x['px']
        if state:
            peak=max(peak,px);trough=min(trough,px);held=(ts-signal_ts)//H
            fav=(peak/entry-1)*100 if state>0 else (entry/trough-1)*100
            adverse_entry=(entry/trough-1)*100 if state>0 else (peak/entry-1)*100
            adverse_peak=(px/peak-1)*100 if state>0 else (trough/px-1)*100
            decay=(state>0 and pr<.10*th) or (state<0 and pr>-.10*th)
            trail=adverse_peak<=-v109.TRAIL[pair]
            sponsor=1 if x['breadth']>.5 else -1 if x['breadth']<.5 else 0
            reason=None
            if trail:reason='FROZEN_TRAIL'
            elif source!='V109_PRIMARY':
                if pair=='ETH' and (held>=72 or (decay and not (x['r12']*state>0 and x['rr12']*state>0))):reason='SECONDARY_ROTATION_END'
                elif pair=='BNB' and (held>=48 or (decay and not (x['r6']*state>0 and x['r12']*state>0))):reason='TACTICAL_RELEASE'
                elif pair=='AVAX' and (held>=48 or x['vr']<1 or (decay and not (x['r6']*state>0 and x['r12']*state>0))):reason='EVENT_END'
            elif pair=='SOL':
                # Keep V109 opportunity. Extend only already-profitable waves with medium+slow+breadth ownership.
                owner=fav>adverse_entry and x['r12']*state>0 and x['r24']*state>0 and sponsor==state
                if decay and not owner:reason='PREDICTOR_DECAY'
                elif held>=144:reason='MAXHOLD'
            elif pair=='LINK':
                if held>=24:
                    # V1 improved return/DD but stress remained marginal. Continue only if profit quality and medium direction both survive.
                    quality=fav>adverse_entry and pr*state>=0 and x['r12']*state>0 and x['r24']*state>0
                    if held>=48:reason='FORECAST_END'
                    elif not quality:reason='24H_HANDOFF_CASH'
                elif decay:reason='PREDICTOR_DECAY'
            elif pair=='BTC':
                owner=fav>adverse_entry and x['r12']*state>0 and x['r24']*state>0 and sponsor==state
                if decay and not owner:reason='PREDICTOR_DECAY'
                elif held>=144:reason='MAXHOLD'
            else:
                # ETH/BNB/AVAX V109 primary: do not repeat failed broad ownership extensions.
                if decay:reason='PREDICTOR_DECAY'
                elif held>=144:reason='MAXHOLD'
            if reason:close(ts,i,reason);continue
        if state:continue
        d=1 if pr>=th else -1 if pr<=-th else 0
        frozen_gate=x['v24']<3.2*x['v336']
        chosen=0;src=None;mult=1.0
        if d and frozen_gate:
            chosen=d;src='V109_PRIMARY';mult=1.0
        elif pair in ('ETH','BNB','AVAX') and frozen_gate:
            prev=ctx(pair,candles,idx,ts-6*H);sd=secondary_direction(pair,x,prev)
            if sd:
                chosen=sd;src='SECONDARY_SCOUT';mult=.33
        if chosen:
            ei=i+1+delay
            if ei<len(c) and int(c[ei]['ts'])<end:
                state=chosen;entry_i=ei;entry_ts=int(c[ei]['ts']);signal_ts=ts;entry=float(c[ei]['open']);peak=entry;trough=entry;source=src;size_mult=mult
    if state:
        last=max(int(r['ts']) for r in c if start<=int(r['ts'])<end);close(last,idx[pair][last],'PERIOD_END')
    return vals,recs

def summary(vals,recs):
    m=v109.metric(vals);wins=sorted(vals,reverse=True)
    if vals:
        bi=max(range(len(vals)),key=lambda j:vals[j]);wo=[x for j,x in enumerate(vals) if j!=bi];pfwo=v109.metric(wo).get('pf') if wo else None
    else:pfwo=None
    total=sum(vals)
    m.update({'pfWithoutBest':pfwo,'top5ContributionPct':100*sum(wins[:5])/total if abs(total)>1e-9 else None,
              'medianMfePct':med([r['mfePct'] for r in recs]),'medianMaePct':med([r['maePct'] for r in recs]),
              'primaryTrades':sum(r.get('source')=='V109_PRIMARY' for r in recs),'secondaryTrades':sum(r.get('source')=='SECONDARY_SCOUT' for r in recs)})
    return m

def baseline_summary(vals):
    return summary(vals,[{'pnl':x,'mfePct':0,'maePct':0,'source':'V109_PRIMARY'} for x in vals])

def run(pair):
    candles,idx,_=v109.b.base.load();ps=v109.b.base.periods(candles);model=v109.train('regime_wave',pair,candles,idx,*ps['development'])
    out={'researchLine':'PAIRWISE_BEST_COMPONENTS_V2','pair':pair,'role':ROLE[pair],'confirmation':'UNTOUCHED','holdout':'UNTOUCHED','frozenV109Changed':False,
         'antiOverfit':{'thresholdRetune':False,'riskRetune':False,'trailRetune':False,'confirmationRead':False,'holdoutRead':False,'designEvidence':['development','validation']}}
    for name,period in [('development',ps['development']),('validation',ps['validation'])]:
        bv,_=v109.pair_trades('regime_wave',pair,candles,idx,*period,v109.NORMAL_BPS,0,model);cv,cr=simulate(pair,candles,idx,*period,v109.NORMAL_BPS,0,model)
        out[name]={'baseline':baseline_summary(bv),'composite':summary(cv,cr)}
        br=out[name]['baseline'].get('returnPct',0);crr=out[name]['composite'].get('returnPct',0);out[name]['returnDeltaPctPt']=crr-br;out[name]['returnRetentionPct']=100*crr/br if abs(br)>1e-9 else None
    sv,sr=simulate(pair,candles,idx,*ps['validation'],v109.STRESS_BPS,1,model);out['validationStress']=summary(sv,sr)
    d=out['development']['composite'];v=out['validation']['composite'];s=out['validationStress']
    adequate=d.get('trades',0)>=12 and v.get('trades',0)>=6
    profitable=d.get('returnPct',0)>0 and v.get('returnPct',0)>0
    robust=(d.get('pf') or 0)>=1.2 and (v.get('pf') or 0)>=1.2 and (s.get('pf') or 0)>1 and v.get('maxDDPct',-999)>-20
    preserves=out['validation']['returnDeltaPctPt']>=0 and (out['validation']['returnRetentionPct'] is None or out['validation']['returnRetentionPct']>=100)
    concentration=(v.get('pfWithoutBest') or 0)>=1.0
    out['gates']={'adequateTrades':adequate,'profitableDV':profitable,'robust':robust,'preservesBaselineValReturn':preserves,'pfWithoutBestAtLeast1':concentration}
    out['status']='PASS' if adequate and profitable and robust and preserves and concentration else 'FAIL'
    root=Path(os.environ.get('RESEARCH_STATE_DIR','.research-state'));root.mkdir(parents=True,exist_ok=True);p=root/f'{pair.lower()}-best-components-v2.json';p.write_text(json.dumps(out,indent=2),encoding='utf-8');print(json.dumps(out,indent=2))

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--pair',choices=PAIRS,required=True);run(ap.parse_args().pair)
