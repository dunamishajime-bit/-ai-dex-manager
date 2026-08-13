from __future__ import annotations
import argparse,json,os,statistics
from pathlib import Path
import research_lab_pair_specific_v109 as v109

H=v109.HOUR
PAIRS=('BTC','ETH','BNB','SOL','LINK','AVAX')
MODES={
 'SOL':['V109_BASE','OWNER_REVALIDATE'],
 'LINK':['V2_STAGED_HANDOFF','STRESS_REVALIDATE'],
 'ETH':['PRIMARY_ONLY','MISSING_WINNER_RESIDUAL'],
 'AVAX':['PRIMARY_ONLY','POST_SHOCK_OUTCOME'],
 'BTC':['BREADTH_MOMENTUM_HANDOFF','PANIC_RECOVERY'],
 'BNB':['RELATIVE_RESIDUAL_IMPULSE','COMPRESSION_DIRECTION_SYNC'],
}

def med(xs):return statistics.median(xs) if xs else None

def ctx(pair,candles,idx,ts):
    i=idx[pair].get(ts)
    if i is None or i<900:return None
    c=candles[pair];v24=v109.b.vol(c,i,24);v96=v109.b.vol(c,i,96);v336=v109.b.vol(c,i,336)
    if min(v96,v336)<=1e-12:return None
    rr12,rr48=v109.residual_feature(pair,candles,idx,ts)
    return {'i':i,'px':float(c[i]['close']),'r3':v109.ret(c,i,3) or 0,'r6':v109.ret(c,i,6) or 0,'r12':v109.ret(c,i,12) or 0,'r24':v109.ret(c,i,24) or 0,'r72':v109.ret(c,i,72) or 0,
            'vr':v24/v96,'v24':v24,'v96':v96,'v336':v336,'breadth':v109.b.breadth(candles,idx,ts,24),'rr12':rr12,'rr48':rr48}

def entry_direction(pair,mode,x,prev,pr,th):
    d=1 if pr>=th else -1 if pr<=-th else 0
    if pair in ('SOL','LINK','ETH','AVAX') and d:return d,'V109_PRIMARY',1.0
    if pair=='BTC':
        if mode=='BREADTH_MOMENTUM_HANDOFF':
            if x['r12']>0 and x['r24']>0 and x['breadth']>.55:return 1,'BTC_BREADTH_HANDOFF',.78
            if x['r12']<0 and x['r24']<0 and x['breadth']<.45:return -1,'BTC_BREADTH_HANDOFF',.78
        elif prev:
            panic_up=prev['r72']<0 and x['r6']>0 and x['r12']>0 and x['breadth']>prev['breadth']
            panic_dn=prev['r72']>0 and x['r6']<0 and x['r12']<0 and x['breadth']<prev['breadth']
            if panic_up:return 1,'BTC_PANIC_RECOVERY',.78
            if panic_dn:return -1,'BTC_PANIC_RECOVERY',.78
    if pair=='BNB':
        if mode=='RELATIVE_RESIDUAL_IMPULSE':
            if x['rr12']>0 and x['rr48']>0 and x['r6']>0 and x['r12']>0:return 1,'BNB_RELATIVE_IMPULSE',.72
            if x['rr12']<0 and x['rr48']<0 and x['r6']<0 and x['r12']<0:return -1,'BNB_RELATIVE_IMPULSE',.72
        elif prev and prev['vr']<1<=x['vr']:
            if x['r6']>0 and x['r12']>0 and x['rr12']>0:return 1,'BNB_COMPRESSION_SYNC',.72
            if x['r6']<0 and x['r12']<0 and x['rr12']<0:return -1,'BNB_COMPRESSION_SYNC',.72
    if pair=='ETH' and mode=='MISSING_WINNER_RESIDUAL' and prev:
        if x['rr48']>0 and x['rr12']>0 and x['r6']>0 and x['r12']>0 and x['breadth']>=.5:return 1,'ETH_MISSING_WINNER',.33
        if x['rr48']<0 and x['rr12']<0 and x['r6']<0 and x['r12']<0 and x['breadth']<=.5:return -1,'ETH_MISSING_WINNER',.33
    if pair=='AVAX' and mode=='POST_SHOCK_OUTCOME' and prev:
        shock=prev['vr']>1 and x['vr']<prev['vr']
        if shock and x['r6']>0 and x['r12']>0:return 1,'AVAX_POST_SHOCK',.33
        if shock and x['r6']<0 and x['r12']<0:return -1,'AVAX_POST_SHOCK',.33
    return 0,None,1.0

def simulate(pair,mode,candles,idx,start,end,cost_bps,delay,model):
    c=candles[pair];th=model['threshold'];state=0;entry=peak=trough=None;entry_i=entry_ts=signal_ts=None;source=None;size_mult=1.0;life='BASE';vals=[];recs=[]
    def close(ts,i,reason):
        nonlocal state,entry,peak,trough,entry_i,entry_ts,signal_ts,source,size_mult,life
        xi=i+1+delay
        if xi>=len(c) or int(c[xi]['ts'])>=end:xi=i;xp=float(c[i]['close'])
        else:xp=float(c[xi]['open'])
        gross=state*((xp/entry-1)*100);pnl=(gross-cost_bps/100.0)*v109.RISK[pair]*size_mult
        lo,hi=min(entry_i,xi),max(entry_i,xi);hs=[float(c[j].get('high',c[j]['close'])) for j in range(lo,hi+1)];ls=[float(c[j].get('low',c[j]['close'])) for j in range(lo,hi+1)]
        mfe=(max(hs)/entry-1)*100 if state>0 else (entry/min(ls)-1)*100;mae=(min(ls)/entry-1)*100 if state>0 else (entry/max(hs)-1)*100
        recs.append({'source':source,'side':'LONG' if state>0 else 'SHORT','entryTs':entry_ts,'exitTs':int(c[xi]['ts']),'heldHours':(int(c[xi]['ts'])-entry_ts)/H,'pnl':pnl,'mfePct':mfe,'maePct':mae,'exitReason':reason,'life':life})
        vals.append(pnl);state=0;entry=peak=trough=None;entry_i=entry_ts=signal_ts=None;source=None;size_mult=1.0;life='BASE'
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
            current=state*((px/entry-1)*100)
            decay=(state>0 and pr<.10*th) or (state<0 and pr>-.10*th);trail=adverse_peak<=-v109.TRAIL[pair]
            reason=None
            if trail:reason='FROZEN_TRAIL'
            elif pair=='SOL':
                if mode=='V109_BASE':
                    if decay:reason='PREDICTOR_DECAY'
                else:
                    owner=fav>adverse_entry and x['r12']*state>0 and x['r24']*state>0 and ((x['breadth']>.5 and state>0) or (x['breadth']<.5 and state<0))
                    if decay and owner:life='EXTENSION_OWNER'
                    if life=='EXTENSION_OWNER' and ((x['r6']*state<0 and x['r12']*state<0) or current<=0):reason='EXTENSION_RIGHT_LOST'
                    elif decay and not owner:reason='PREDICTOR_DECAY'
                if held>=144 and not reason:reason='MAXHOLD'
            elif pair=='LINK':
                if held>=24:
                    quality=current>0 and pr*state>=0 and x['r12']*state>0 and x['r24']*state>0
                    if mode=='STRESS_REVALIDATE' and held<48 and quality:
                        life='DURABLE_OWNER'
                        if x['r6']*state<0 and x['r12']*state<0:reason='FAST_MEDIUM_OWNER_LOSS'
                    elif held>=48:reason='FORECAST_END'
                    elif not quality:reason='24H_HANDOFF_CASH'
                elif decay:reason='PREDICTOR_DECAY'
            elif source!='V109_PRIMARY':
                if pair=='ETH' and (held>=72 or current<=0 or (x['r12']*state<0 and x['rr12']*state<0)):reason='SECONDARY_END'
                elif pair=='AVAX' and (held>=48 or current<=0 or (x['r6']*state<0 and x['r12']*state<0)):reason='EVENT_END'
                elif pair in ('BTC','BNB') and (held>=72 or current<=0 or (x['r6']*state<0 and x['r12']*state<0)):reason='ENTRY_FAMILY_END'
            else:
                if decay:reason='PREDICTOR_DECAY'
                elif held>=144:reason='MAXHOLD'
            if reason:close(ts,i,reason);continue
        if state:continue
        prev=ctx(pair,candles,idx,ts-6*H);d,src,mult=entry_direction(pair,mode,x,prev,pr,th)
        if d and x['v24']<3.2*x['v336']:
            ei=i+1+delay
            if ei<len(c) and int(c[ei]['ts'])<end:
                state=d;entry_i=ei;entry_ts=int(c[ei]['ts']);signal_ts=ts;entry=float(c[ei]['open']);peak=entry;trough=entry;source=src;size_mult=mult
    if state:
        last=max(int(r['ts']) for r in c if start<=int(r['ts'])<end);close(last,idx[pair][last],'PERIOD_END')
    return vals,recs

def summary(vals,recs):
    m=v109.metric(vals);total=sum(vals);wins=sorted(vals,reverse=True)
    if vals:
        bi=max(range(len(vals)),key=lambda j:vals[j]);wo=[x for j,x in enumerate(vals) if j!=bi];pfwo=v109.metric(wo).get('pf') if wo else None
    else:pfwo=None
    bysrc={}
    for r in recs:
        z=bysrc.setdefault(r['source'],{'trades':0,'pnl':0.0});z['trades']+=1;z['pnl']+=r['pnl']
    m.update({'pfWithoutBest':pfwo,'top5ContributionPct':100*sum(wins[:5])/total if abs(total)>1e-9 else None,'medianMfePct':med([r['mfePct'] for r in recs]),'medianMaePct':med([r['maePct'] for r in recs]),'sourceAttribution':bysrc})
    return m

def score(m):
    if m.get('trades',0)<4:return -1e9
    return 1.5*m.get('returnPct',0)+8*((m.get('pf') or 0)-1)-.2*abs(m.get('maxDDPct',0))

def run(pair):
    candles,idx,_=v109.b.base.load();ps=v109.b.base.periods(candles);model=v109.train('regime_wave',pair,candles,idx,*ps['development'])
    mode_results={}
    for mode in MODES[pair]:
        dv,dr=simulate(pair,mode,candles,idx,*ps['development'],v109.NORMAL_BPS,0,model);mode_results[mode]=summary(dv,dr)
    selected=max(MODES[pair],key=lambda z:score(mode_results[z]))
    vv,vr=simulate(pair,selected,candles,idx,*ps['validation'],v109.NORMAL_BPS,0,model);sv,sr=simulate(pair,selected,candles,idx,*ps['validation'],v109.STRESS_BPS,1,model)
    bv,_=v109.pair_trades('regime_wave',pair,candles,idx,*ps['validation'],v109.NORMAL_BPS,0,model)
    val=summary(vv,vr);stress=summary(sv,sr);base=v109.metric(bv)
    out={'researchLine':'PAIRWISE_PROFIT_ATTRIBUTION_V3','pair':pair,'group':('PROFIT_OWNER' if pair in ('SOL','LINK') else 'MISSING_WINNER' if pair in ('ETH','AVAX') else 'ENTRY_REEXTRACT'),
         'developmentAttribution':mode_results,'selectedMode':selected,'selectionUsed':['development'],'validation':val,'validationBaselineV109':base,'validationStress':stress,'confirmation':'UNTOUCHED','holdout':'UNTOUCHED','frozenV109Changed':False,
         'solHighProfitReferenceNote':'Historical ~60% SOL line is not opened here because Confirmation/Holdout remain untouched; this V3 compares only isolated D/V and preserves V109 entry for SOL.' if pair=='SOL' else None}
    adequate=val.get('trades',0)>=6;robust=val.get('returnPct',0)>0 and (val.get('pf') or 0)>=1.2 and (stress.get('pf') or 0)>1 and (val.get('pfWithoutBest') or 0)>=1 and val.get('maxDDPct',-999)>-20
    if pair in ('SOL','LINK'):robust=robust and val.get('returnPct',0)>=base.get('returnPct',0)
    out['status']='PASS' if adequate and robust else 'FAIL'
    root=Path(os.environ.get('RESEARCH_STATE_DIR','.research-state'));root.mkdir(parents=True,exist_ok=True);p=root/f'{pair.lower()}-profit-attribution-v3.json';p.write_text(json.dumps(out,indent=2),encoding='utf-8');print(json.dumps(out,indent=2))

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--pair',choices=PAIRS,required=True);run(ap.parse_args().pair)
