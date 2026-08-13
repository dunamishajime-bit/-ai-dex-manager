from __future__ import annotations
import argparse,json,os,statistics
from pathlib import Path
import research_lab_pair_specific_v109 as v109
import research_pairwise_profit_attribution_v4 as v4

H=v109.HOUR
PAIRS=('SOL','LINK','ETH','BNB','AVAX')
ROLE={
 'SOL':'V109 broad wave entry + full-size probation + durable owner + tiered MFE profit lock',
 'LINK':'V109 broad entry + exact 24h quality handoff + post-handoff MFE lock + 48h contract',
 'ETH':'V109 rare primary + V101 tail-state normalization reversal event',
 'BNB':'V101 range-escape quality entry + breadth-sponsored tactical ownership',
 'AVAX':'V109 primary + proven compression event + V101 tail-normalization diversification event',
}

def med(xs): return statistics.median(xs) if xs else None

def hist_signal(mech,pair,candles,idx,ts):
    try:return v109.b.signal(mech,pair,candles,idx,ts,{})
    except Exception:return None

def entry_signal(pair,candles,idx,ts,x,prev,pr,th):
    if x['v24']>=3.2*x['v336']:return (0,None,1.0,None)
    d=1 if pr>=th else -1 if pr<=-th else 0
    if pair in ('SOL','LINK'):
        return (d,'V109_PRIMARY',1.0,144 if pair=='SOL' else 48) if d else (0,None,1.0,None)
    if pair=='ETH':
        if d:return d,'V109_PRIMARY',1.0,144
        sg=hist_signal('tail_state_normalization',pair,candles,idx,ts)
        if sg:
            side,hold,w=sg;return side,'V101_TAIL_NORMALIZATION',.40*w,hold
        return 0,None,1.0,None
    if pair=='BNB':
        sg=hist_signal('range_escape_quality',pair,candles,idx,ts)
        if sg:
            side,hold,w=sg;return side,'V101_RANGE_ESCAPE',w,hold
        return 0,None,1.0,None
    if pair=='AVAX':
        if d:return d,'V109_PRIMARY',1.0,144
        if prev:
            if prev['vr']<.85 and x['vr']>=1 and x['r6']>0 and x['r12']>0 and x['breadth']>=.5:return 1,'COMPRESSION_EVENT',.33,48
            if prev['vr']<.85 and x['vr']>=1 and x['r6']<0 and x['r12']<0 and x['breadth']<=.5:return -1,'COMPRESSION_EVENT',.33,48
        sg=hist_signal('tail_state_normalization',pair,candles,idx,ts)
        if sg:
            side,hold,w=sg;return side,'V101_TAIL_NORMALIZATION',.30*w,hold
        return 0,None,1.0,None
    return 0,None,1.0,None

def simulate(pair,candles,idx,start,end,cost_bps,delay,model):
    c=candles[pair];th=model['threshold'];state=0;entry=peak=trough=None;entry_i=entry_ts=signal_ts=None;source=None;mult=1.0;target_hold=None;vals=[];recs=[];extension=False
    def close(ts,i,reason):
        nonlocal state,entry,peak,trough,entry_i,entry_ts,signal_ts,source,mult,target_hold,extension
        xi=i+1+delay
        if xi>=len(c) or int(c[xi]['ts'])>=end:xi=i;xp=float(c[i]['close'])
        else:xp=float(c[xi]['open'])
        gross=state*((xp/entry-1)*100);pnl=(gross-cost_bps/100.0)*v109.RISK[pair]*mult
        lo,hi=min(entry_i,xi),max(entry_i,xi);hs=[float(c[j].get('high',c[j]['close'])) for j in range(lo,hi+1)];ls=[float(c[j].get('low',c[j]['close'])) for j in range(lo,hi+1)]
        mfe=(max(hs)/entry-1)*100 if state>0 else (entry/min(ls)-1)*100;mae=(min(ls)/entry-1)*100 if state>0 else (entry/max(hs)-1)*100
        recs.append({'pair':pair,'source':source,'side':'LONG' if state>0 else 'SHORT','entryTs':entry_ts,'exitTs':int(c[xi]['ts']),'heldHours':(int(c[xi]['ts'])-entry_ts)/H,'pnl':pnl,'mfePct':mfe,'maePct':mae,'exitReason':reason,'sizeMult':mult})
        vals.append(pnl);state=0;entry=peak=trough=None;entry_i=entry_ts=signal_ts=None;source=None;mult=1.0;target_hold=None;extension=False
    for row in c:
        ts=int(row['ts'])
        if not(start<=ts<end):continue
        x=v4.ctx(pair,candles,idx,ts)
        if x is None:continue
        i=x['i'];pr=v109.predict('regime_wave',pair,candles,idx,ts,model);px=x['px']
        if state:
            peak=max(peak,px);trough=min(trough,px);held=(ts-signal_ts)//H
            fav=(peak/entry-1)*100 if state>0 else (entry/trough-1)*100
            cur=state*(px/entry-1)*100
            adverse_peak=(px/peak-1)*100 if state>0 else (trough/px-1)*100
            decay=(state>0 and pr<.10*th) or (state<0 and pr>-.10*th)
            reason=None
            if adverse_peak<=-v109.TRAIL[pair]:reason='FROZEN_TRAIL'
            elif pair=='SOL':
                # Preserve every V109 opportunity at full size. Probation is post-entry loss control, never a pre-entry filter.
                if held>=6 and held<18 and cur<0 and x['r6']*state<=0 and x['r12']*state<=0:reason='PROBATION_REJECT'
                if reason is None and decay and not extension:
                    if fav>=1.0 and x['r12']*state>0 and x['r24']*state>0:extension=True
                    else:reason='PREDICTOR_DECAY'
                if reason is None and extension:
                    keep=.65 if fav>=2.0 else .45
                    if x['r6']*state<=0 or x['r12']*state<=0 or cur<keep*fav:reason='TIERED_PROFIT_LOCK'
                if reason is None and held>=144:reason='MAXHOLD'
            elif pair=='LINK':
                if held>=24:
                    adverse_entry=(entry/trough-1)*100 if state>0 else (peak/entry-1)*100
                    quality=fav>adverse_entry and pr*state>=0 and x['r12']*state>0 and x['r24']*state>0
                    if held>=48:reason='FORECAST_END'
                    elif not quality:reason='24H_HANDOFF_CASH'
                    elif fav>=1.0 and cur<.60*fav:reason='POST_HANDOFF_PROFIT_LOCK'
                elif decay:reason='PREDICTOR_DECAY'
            elif source=='V109_PRIMARY':
                if decay:reason='PREDICTOR_DECAY'
                elif held>=144:reason='MAXHOLD'
            elif source=='V101_RANGE_ESCAPE':
                sponsor=1 if x['breadth']>.5 else -1 if x['breadth']<.5 else 0
                if held>=6 and sponsor==-state and x['r6']*state<=0:reason='SPONSOR_LOSS'
                elif x['r6']*state<=0 and x['r12']*state<=0:reason='DIRECTION_LOSS'
                elif held>=target_hold:reason='EVENT_END'
            elif source=='COMPRESSION_EVENT':
                if x['vr']<1 or x['r6']*state<=0:reason='EVENT_END'
                elif held>=target_hold:reason='EVENT_END'
            else:
                if x['r6']*state<=0 and x['r12']*state<=0:reason='REVERSAL_END'
                elif held>=target_hold:reason='EVENT_END'
            if reason:close(ts,i,reason);continue
        if state:continue
        prev=v4.ctx(pair,candles,idx,ts-6*H)
        d,src,m,hold=entry_signal(pair,candles,idx,ts,x,prev,pr,th)
        if d:
            ei=i+1+delay
            if ei<len(c) and int(c[ei]['ts'])<end:
                state=d;entry_i=ei;entry_ts=int(c[ei]['ts']);signal_ts=ts;entry=float(c[ei]['open']);peak=entry;trough=entry;source=src;mult=m;target_hold=hold;extension=False
    if state:
        last=max(int(r['ts']) for r in c if start<=int(r['ts'])<end);close(last,idx[pair][last],'PERIOD_END')
    return vals,recs

def summary(vals,recs):
    m=v4.summary(vals,recs)
    m['sourceContribution']={}
    for r in recs:m['sourceContribution'][r['source']]=m['sourceContribution'].get(r['source'],0)+r['pnl']
    m['exitContribution']={}
    for r in recs:m['exitContribution'][r['exitReason']]=m['exitContribution'].get(r['exitReason'],0)+r['pnl']
    return m

def run(pair):
    candles,idx,_=v109.b.base.load();ps=v109.b.base.periods(candles);model=v109.train('regime_wave',pair,candles,idx,*ps['development'])
    dv,dr=simulate(pair,candles,idx,*ps['development'],v109.NORMAL_BPS,0,model)
    vv,vr=simulate(pair,candles,idx,*ps['validation'],v109.NORMAL_BPS,0,model)
    sv,sr=simulate(pair,candles,idx,*ps['validation'],v109.STRESS_BPS,1,model)
    bdev,_=v109.pair_trades('regime_wave',pair,candles,idx,*ps['development'],v109.NORMAL_BPS,0,model)
    bval,_=v109.pair_trades('regime_wave',pair,candles,idx,*ps['validation'],v109.NORMAL_BPS,0,model)
    out={'researchLine':'PAIRWISE_FINAL_V96_LINEAGE_V1','pair':pair,'role':ROLE[pair],'btcRole':'REFERENCE_ONLY_NO_BTC_POSITION','historyUsed':['V96/V98 structural families','V101/V102 pair-local event mechanisms','V109 regime-wave baseline','post-V109 ownership/event attribution through V4'],'confirmation':'UNTOUCHED','holdout':'UNTOUCHED','frozenV109Changed':False,
         'developmentBaselineV109':v109.metric(bdev),'development':summary(dv,dr),'validationBaselineV109':v109.metric(bval),'validation':summary(vv,vr),'validationStress':summary(sv,sr)}
    d=out['development'];v=out['validation'];s=out['validationStress']
    adequate=d.get('trades',0)>=8 and v.get('trades',0)>=6
    robust=d.get('returnPct',0)>0 and v.get('returnPct',0)>0 and (d.get('pf') or 0)>=1.2 and (v.get('pf') or 0)>=1.2 and (s.get('pf') or 0)>1 and v.get('maxDDPct',-999)>-20 and (v.get('pfWithoutBest') or 0)>=1
    out['gates']={'adequateTrades':adequate,'robustDVStress':robust};out['status']='PASS' if adequate and robust else 'FAIL'
    root=Path(os.environ.get('RESEARCH_STATE_DIR','.research-state'));root.mkdir(parents=True,exist_ok=True);p=root/f'{pair.lower()}-final-v96-lineage.json';p.write_text(json.dumps(out,indent=2),encoding='utf-8');print(json.dumps(out,indent=2))

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--pair',choices=PAIRS,required=True);run(ap.parse_args().pair)
