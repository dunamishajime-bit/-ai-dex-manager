from __future__ import annotations
import argparse,json,math,os,statistics
from pathlib import Path
import research_active4_v130_run as v130

engine=v130.engine; v109=v130.v109; HOUR=engine.HOUR
NORMAL_BPS=engine.NORMAL_BPS; STRESS_BPS=engine.STRESS_BPS

# V131 changes the research execution semantics, not tuned thresholds.
# Each candidate reuses a predeclared V130 signal family but is evaluated through a
# persistent legal-transition lifecycle: CASH->PRE_WAVE->PROBE->CORE->PULLBACK->CORE->EXIT/LOCKOUT.
CANDS={
 'btc_lifecycle_core_handoff':('BTC','btc_acceptance_rearm',.42),
 'btc_lifecycle_breadth_owner':('BTC','btc_breadth_sponsored_core',.40),
 'eth_lifecycle_selective_owner':('ETH','eth_leadership_probe_handoff',.38),
 'bnb_lifecycle_cash_release':('BNB','bnb_selective_release_rearm',.34),
 'avax_lifecycle_burst_handoff':('AVAX','avax_breadth_burst_rearm',.28),
}
WAVE_H=72; WAVE_ENTRY_H=24

def sig(cid,candles,idx,ts): return v130.state(CANDS[cid][1],candles,idx,ts)

def dyn_size(cid,candles,idx,ts):
    pair,old,base=CANDS[cid]; x=engine.feat(old,candles,idx,ts)
    if not x:return base*.5
    # Causal volatility risk normalization; broad caps are predeclared, not optimized.
    v=max(x['v'][168],1e-9); realized=v*math.sqrt(24)
    scale=max(.55,min(1.25,3.0/(realized+1e-9)))
    return max(.12,min(.62,base*scale))

def _px(c,i,delay):
    j=min(i+1+delay,len(c)-1);return float(c[j]['open']),j

def simulate(cid,candles,idx,period,cost_bps,delay=0):
    pair=CANDS[cid][0]; c=candles[pair]; start,end=period
    life='CASH'; side=0; pre_ts=None; lock_until=0
    size=0.; entry=0.; entry_ts=None; core_ts=None; peak=None; trough=None
    trades=[]; transitions=[]; probe_failed=0; probes=0
    def transition(ts,to,reason):
        nonlocal life
        transitions.append({'ts':ts,'from':life,'to':to,'reason':reason}); life=to
    def add(ts,i,amount,reason):
        nonlocal size,entry,entry_ts,peak,trough
        px,_=_px(c,i,delay)
        if size<=0:
            entry=px; entry_ts=ts; peak=px; trough=px
        else: entry=(entry*size+px*amount)/(size+amount)
        size+=amount
    def close(ts,i,reason):
        nonlocal size,entry,entry_ts,peak,trough,side,core_ts,lock_until,probe_failed
        if size<=0:return
        px,_=_px(c,i,delay); gross=side*(px/entry-1)*100*size
        fees=(cost_bps/100.0)*size; pnl=gross-fees
        hold=(ts-entry_ts)/HOUR if entry_ts is not None else 0
        fav=(peak/entry-1)*100 if side>0 else (entry/trough-1)*100
        adv=(trough/entry-1)*100 if side>0 else (entry/peak-1)*100
        give=max(0.,fav-(side*(px/entry-1)*100))
        if core_ts is None: probe_failed+=1
        trades.append({'entryTs':entry_ts,'exitTs':ts,'side':side,'pnl':pnl,'size':size,'heldHours':hold,
                       'entryReason':'PROBE_INITIATION','exitReason':reason,'coreAccepted':core_ts is not None,
                       'coreTs':core_ts,'mfePct':fav,'maePct':adv,'exitGivebackPct':give})
        size=0.;entry=0.;entry_ts=None;peak=None;trough=None;side=0;core_ts=None
        lock_until=ts+12*HOUR
    for row in c:
        ts=int(row['ts'])
        if not(start<=ts<end):continue
        i=idx[pair].get(ts)
        if i is None or i<900:continue
        z=sig(cid,candles,idx,ts); px=float(c[i]['close'])
        if size>0:
            peak=max(peak,px);trough=min(trough,px)
        if life=='LOCKOUT':
            if ts>=lock_until and not z['onset'] and not z['continue']:
                transition(ts,'CASH','LOCKOUT_CLEARED')
            continue
        if life=='CASH':
            if z['prewave']:
                side=int(z['prewave']);pre_ts=ts;transition(ts,'PRE_WAVE','COMPRESSION_OR_SETUP')
            continue
        if life=='PRE_WAVE':
            if z['onset']==side:
                probes+=1; add(ts,i,.35*dyn_size(cid,candles,idx,ts),'INITIATION'); transition(ts,'PROBE','LEGAL_INITIATION')
            elif z['prewave']==-side or (pre_ts is not None and ts-pre_ts>96*HOUR):
                side=0;transition(ts,'CASH','SETUP_EXPIRED')
            continue
        if life=='PROBE':
            if z['continue']==side:
                add(ts,i,.65*dyn_size(cid,candles,idx,ts),'ACCEPTED_EXPANSION'); core_ts=ts;transition(ts,'CORE','EXPANSION_ACCEPTED')
            elif z['reverse']==-side or z['exhaust']==side or z['bias']==-side:
                close(ts,i,'PROBE_FAIL');transition(ts,'LOCKOUT','PROBE_FAILED')
            elif entry_ts is not None and ts-entry_ts>72*HOUR:
                close(ts,i,'ACCEPTANCE_TIMEOUT');transition(ts,'LOCKOUT','NO_CORE_ACCEPTANCE')
            continue
        if life=='CORE':
            if z['reverse']==-side:
                close(ts,i,'STRUCTURAL_REVERSAL');transition(ts,'LOCKOUT','REVERSAL')
            elif z['exhaust']==side:
                close(ts,i,'EXHAUSTION');transition(ts,'LOCKOUT','EXHAUSTION')
            else:
                x=engine.feat(CANDS[cid][1],candles,idx,ts)
                if x and x['r'][24]*side<0 and z['bias'] in (0,side): transition(ts,'PULLBACK','FAST_COUNTERMOVE')
            continue
        if life=='PULLBACK':
            if z['reverse']==-side:
                close(ts,i,'PULLBACK_REVERSAL');transition(ts,'LOCKOUT','REVERSAL')
            elif z['reentry']==side or z['continue']==side:
                transition(ts,'CORE','REACCELERATION_ACCEPTED')
            elif z['exhaust']==side:
                close(ts,i,'PULLBACK_EXHAUSTION');transition(ts,'LOCKOUT','EXHAUSTION')
            continue
    # causal end-of-period flatten for metrics
    if size>0:
        last=max((int(r['ts']) for r in c if start<=int(r['ts'])<end),default=None)
        if last is not None: close(last,idx[pair][last],'PERIOD_END')
    return trades,transitions,probe_failed,probes

def metr(cid,candles,idx,period,cost,delay=0):
    tr,trans,pf,probes=simulate(cid,candles,idx,period,cost,delay)
    m=engine.metric([x['pnl'] for x in tr]); m.update({
      'avgHoldingHours':statistics.fmean([x['heldHours'] for x in tr]) if tr else 0,
      'medianExitGivebackPct':statistics.median([x['exitGivebackPct'] for x in tr]) if tr else 0,
      'falseStarts':pf,'falseStartRatePct':100*pf/probes if probes else 0,
      'coreAcceptedTrades':sum(x['coreAccepted'] for x in tr),
      'top5TradeContributionPct':(100*sum(sorted([x['pnl'] for x in tr],reverse=True)[:5])/sum(x['pnl'] for x in tr)) if tr and abs(sum(x['pnl'] for x in tr))>1e-9 else None,
      'lifecycleTransitions':len(trans)})
    return m,tr

def wave_diag(cid,candles,idx,period):
    pair=CANDS[cid][0]; c=candles[pair];start,end=period;tr,_=metr(cid,candles,idx,period,NORMAL_BPS,0)
    trades,_,_,_=simulate(cid,candles,idx,period,NORMAL_BPS,0)
    waves=[]; last_end=0
    for row in c:
        ts=int(row['ts']);i=idx[pair].get(ts)
        if not(start<=ts<end) or ts<last_end or i is None or i<336 or i+WAVE_H>=len(c):continue
        p0=float(c[i]['close']);v=engine.p.vol(c,i,168)
        highs=[float(c[j]['high']) for j in range(i+1,i+WAVE_H+1)];lows=[float(c[j]['low']) for j in range(i+1,i+WAVE_H+1)]
        up=100*(max(highs)/p0-1);dn=100*(p0/min(lows)-1);thr=max(3.0,2.0*v*math.sqrt(WAVE_H))
        mfe=max(up,dn)
        if mfe<thr:continue
        side=1 if up>=dn else -1; k=(highs.index(max(highs))+1) if side>0 else (lows.index(min(lows))+1)
        wend=int(c[i+k]['ts']); hit=next((x for x in trades if x['side']==side and ts<=x['entryTs']<=ts+WAVE_ENTRY_H*HOUR),None)
        cap=None;delayh=None
        if hit:
            delayh=(hit['entryTs']-ts)/HOUR;ei=idx[pair].get(hit['entryTs']);xi=idx[pair].get(min(hit['exitTs'],wend))
            if ei is not None and xi is not None and xi>=ei:
                ep=float(c[min(ei+1,len(c)-1)]['open']); xp=float(c[xi]['close']); realized=max(0.,side*(xp/ep-1)*100)
                cap=min(100.,100*realized/mfe) if mfe>0 else 0
        waves.append({'startTs':ts,'endTs':wend,'side':side,'mfePct':mfe,'captured':hit is not None,'delayHours':delayh,'mfeCapturedPct':cap})
        last_end=ts+WAVE_H*HOUR
    hit=[w for w in waves if w['captured']];caps=[w['mfeCapturedPct'] for w in hit if w['mfeCapturedPct'] is not None];delays=[w['delayHours'] for w in hit]
    return {'majorWaves':len(waves),'captured':len(hit),'captureRatePct':100*len(hit)/len(waves) if waves else 0,
            'medianEntryDelayHours':statistics.median(delays) if delays else None,
            'medianWaveMfeCapturedPct':statistics.median(caps) if caps else None,'missedWaves':len(waves)-len(hit),
            'falseStarts':tr['falseStarts'],'falseStartRatePct':tr['falseStartRatePct'],'averageHoldingHours':tr['avgHoldingHours'],
            'exitGivebackPct':tr['medianExitGivebackPct'],'top5TradeContributionPct':tr['top5TradeContributionPct']}

def folds(cid,candles,idx,period):
    a,b=period; step=(b-a)//3;out=[]
    for k in range(3):
        x=a+k*step;y=b if k==2 else a+(k+1)*step;m,_=metr(cid,candles,idx,(x,y),NORMAL_BPS,0);out.append(m)
    return {'folds':out,'positivePfFolds':sum((x.get('pf') or 0)>1 for x in out),'positiveReturnFolds':sum(x.get('returnPct',0)>0 for x in out)}

def run(cid):
    candles,idx,_=v109.b.base.load();ps=v109.b.base.periods(candles)
    dm,_=metr(cid,candles,idx,ps['development'],NORMAL_BPS,0);vm,_=metr(cid,candles,idx,ps['validation'],NORMAL_BPS,0);vs,_=metr(cid,candles,idx,ps['validation'],STRESS_BPS,1)
    dw=wave_diag(cid,candles,idx,ps['development']);vw=wave_diag(cid,candles,idx,ps['validation']);df=folds(cid,candles,idx,ps['development']);vf=folds(cid,candles,idx,ps['validation'])
    adequate=dm.get('trades',0)>=8 and vm.get('trades',0)>=4
    stable=df['positivePfFolds']>=2 and vf['positivePfFolds']>=2
    broad=vw['captureRatePct']>=20 and (vw['medianWaveMfeCapturedPct'] or 0)>=20 and vw['falseStartRatePct']<=40
    promote=adequate and stable and broad and (dm.get('pf') or 0)>=1.2 and dm.get('returnPct',0)>0 and (vm.get('pf') or 0)>=1.2 and vm.get('returnPct',0)>0 and (vs.get('pf') or 0)>1 and vm.get('maxDDPct',-999)>-20
    res={'strategyId':'V131_'+cid.upper(),'pair':CANDS[cid][0],'periods':{'development':ps['development'],'validation':ps['validation'],'confirmation':'UNTOUCHED','holdout':'UNTOUCHED'},
         'development':dm,'validation':vm,'validationStress':vs,'waveDiagnostics':{'development':dw,'validation':vw},'walkForward':{'development':df,'validation':vf},
         'status':'FROZEN_SURVIVOR' if promote else 'FAIL','reason':'DEV_VALIDATION_GATE','architecture':'PERSISTENT_LIFECYCLE_V2','productionChanged':False,'realTradingEnabled':False}
    out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));out.mkdir(parents=True,exist_ok=True);stem='active4-v131-'+cid;txt=json.dumps(res,indent=2)
    (out/f'{stem}.json').write_text(txt);(out/f'{stem}.md').write_text('# '+res['strategyId']+'\n\n```json\n'+txt+'\n```\n');print(txt)
if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--candidate',choices=sorted(CANDS),required=True);run(ap.parse_args().candidate)
