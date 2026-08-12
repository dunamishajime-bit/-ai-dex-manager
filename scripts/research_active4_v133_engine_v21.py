from __future__ import annotations
import argparse,json,math,os,statistics
from pathlib import Path
import research_active4_v132_transition_arch as v132
import research_active4_v131_lifecycle_v2 as v131

engine=v131.engine; v109=v131.v109; HOUR=engine.HOUR
NORMAL_BPS=engine.NORMAL_BPS; STRESS_BPS=engine.STRESS_BPS

# Structural redesign only. No Confirmation/Holdout access, no dense parameter sweep.
# Full persistent lifecycle: CASH->PRE_WAVE->INITIATION->PROBE->ACCEPTED_EXPANSION->CORE
# ->PULLBACK->REENTRY->CORE->EXHAUSTION/REVERSAL->LOCKOUT->CASH.
CANDS={
 'btc_breadth_state_v3':('BTC','btc_breadth_decay_owner',.38),
 'btc_consensus_state_v3':('BTC','btc_dual_consensus_owner',.38),
 'eth_leadership_state_v3':('ETH','eth_transition_owner',.36),
 'bnb_cash_state_v3':('BNB','bnb_neutral_compression_release',.32),
 'avax_burst_state_v3':('AVAX','avax_burst_scout_handoff',.22),
}
WAVE_H=72; WAVE_ENTRY_H=24; STALE_CORE_H=168

def sig(cid,candles,idx,ts):
    return v132.signal(CANDS[cid][1],candles,idx,ts)

def dyn_size(cid,candles,idx,ts):
    pair,old,base=CANDS[cid]; old2=v132.CANDS[old][1]
    x=engine.feat(old2,candles,idx,ts)
    if not x:return base*.5
    realized=max(x['v'][168]*math.sqrt(24),1e-9)
    scale=max(.55,min(1.25,3.0/realized))
    return max(.10,min(.62,base*scale))

def _px(c,i,delay):
    j=min(i+1+delay,len(c)-1);return float(c[j]['open']),j

def simulate(cid,candles,idx,period,cost_bps,delay=0):
    pair=CANDS[cid][0]; c=candles[pair]; start,end=period
    life='CASH'; side=0; setup_ts=None; init_ts=None; core_ts=None; lock_until=0
    size=0.; target_size=0.; entry=0.; entry_ts=None; peak=None; trough=None
    trades=[]; transitions=[]; failure={'failedInitiation':0,'failedAcceptance':0,'wrongCoreOwnership':0,'staleHold':0,'reversalLag':0}
    def transition(ts,to,reason):
        nonlocal life
        transitions.append({'ts':ts,'from':life,'to':to,'reason':reason}); life=to
    def add(ts,i,amount,reason):
        nonlocal size,target_size,entry,entry_ts,peak,trough
        if amount<=0:return
        px,_=_px(c,i,delay)
        if size<=0:
            entry=px;entry_ts=ts;peak=px;trough=px
        else: entry=(entry*size+px*amount)/(size+amount)
        size+=amount;target_size=max(target_size,size)
        transitions.append({'ts':ts,'from':life,'to':life,'reason':'ADD_'+reason,'size':amount})
    def close(ts,i,reason):
        nonlocal size,target_size,entry,entry_ts,peak,trough,side,core_ts,lock_until
        if size<=0:return
        px,_=_px(c,i,delay);gross=side*(px/entry-1)*100*size;fees=(cost_bps/100.0)*size;pnl=gross-fees
        hold=(ts-entry_ts)/HOUR if entry_ts is not None else 0
        fav=(peak/entry-1)*100 if side>0 else (entry/trough-1)*100
        adv=(trough/entry-1)*100 if side>0 else (entry/peak-1)*100
        give=max(0.,fav-side*(px/entry-1)*100)
        trades.append({'entryTs':entry_ts,'exitTs':ts,'side':side,'pnl':pnl,'size':size,'heldHours':hold,
          'entryReason':'LEGAL_PREWAVE_INITIATION','exitReason':reason,'coreAccepted':core_ts is not None,
          'coreTs':core_ts,'mfePct':fav,'maePct':adv,'exitGivebackPct':give,'finalLifecycle':life})
        size=0.;target_size=0.;entry=0.;entry_ts=None;peak=None;trough=None;side=0;core_ts=None;lock_until=ts+12*HOUR
    for row in c:
        ts=int(row['ts'])
        if not(start<=ts<end):continue
        i=idx[pair].get(ts)
        if i is None or i<900:continue
        z=sig(cid,candles,idx,ts); px=float(c[i]['close'])
        if size>0: peak=max(peak,px);trough=min(trough,px)
        if life=='LOCKOUT':
            if ts>=lock_until and not z['onset'] and not z['continue'] and not z['reentry']:
                transition(ts,'CASH','NEW_CYCLE_REQUIRED')
            continue
        if life=='CASH':
            if z['prewave']:
                side=int(z['prewave']);setup_ts=ts;transition(ts,'PRE_WAVE','COMPRESSION_SETUP')
            continue
        if life=='PRE_WAVE':
            if z['onset']==side:
                target_size=dyn_size(cid,candles,idx,ts);add(ts,i,.25*target_size,'INITIATION_PROBE');init_ts=ts;transition(ts,'INITIATION','EARLY_WAVE_TRIGGER')
            elif z['prewave']==-side or (setup_ts is not None and ts-setup_ts>96*HOUR):
                side=0;transition(ts,'CASH','SETUP_EXPIRED')
            continue
        if life=='INITIATION':
            if z['reverse']==-side or z['exhaust']==side or z['bias']==-side:
                failure['failedInitiation']+=1;close(ts,i,'FAILED_INITIATION');transition(ts,'LOCKOUT','FAILED_INITIATION')
            elif z['onset']==side or z['bias']==side:
                transition(ts,'PROBE','INITIATION_PERSISTED')
            elif init_ts is not None and ts-init_ts>24*HOUR:
                failure['failedInitiation']+=1;close(ts,i,'INITIATION_TIMEOUT');transition(ts,'LOCKOUT','FAILED_INITIATION')
            continue
        if life=='PROBE':
            if z['continue']==side:
                transition(ts,'ACCEPTED_EXPANSION','MEDIUM_HORIZON_ACCEPTED')
            elif z['reverse']==-side or z['exhaust']==side or z['bias']==-side:
                failure['failedAcceptance']+=1;close(ts,i,'FAILED_ACCEPTANCE');transition(ts,'LOCKOUT','FAILED_ACCEPTANCE')
            elif init_ts is not None and ts-init_ts>72*HOUR:
                failure['failedAcceptance']+=1;close(ts,i,'ACCEPTANCE_TIMEOUT');transition(ts,'LOCKOUT','FAILED_ACCEPTANCE')
            continue
        if life=='ACCEPTED_EXPANSION':
            if z['reverse']==-side or z['exhaust']==side:
                failure['failedAcceptance']+=1;close(ts,i,'ACCEPTANCE_COLLAPSE');transition(ts,'LOCKOUT','FAILED_ACCEPTANCE')
            elif z['continue']==side or z['bias']==side:
                add(ts,i,max(0.,target_size-size),'CORE_HANDOFF');core_ts=ts;transition(ts,'CORE','CORE_OWNERSHIP')
            continue
        if life=='CORE':
            if core_ts is not None and ts-core_ts>STALE_CORE_H*HOUR:
                failure['staleHold']+=1;close(ts,i,'MAX_STALE_OWNERSHIP');transition(ts,'LOCKOUT','STALE_HOLD')
            elif z['reverse']==-side:
                transition(ts,'REVERSAL','STRUCTURAL_REVERSAL_DETECTED')
            elif z['exhaust']==side:
                transition(ts,'EXHAUSTION','EXPANSION_EXHAUSTED')
            else:
                old2=v132.CANDS[CANDS[cid][1]][1];x=engine.feat(old2,candles,idx,ts)
                if x and x['r'][24]*side<0 and z['bias'] in (0,side):transition(ts,'PULLBACK','FAST_COUNTERMOVE')
            continue
        if life=='PULLBACK':
            if z['reverse']==-side:transition(ts,'REVERSAL','PULLBACK_REVERSAL')
            elif z['exhaust']==side:transition(ts,'EXHAUSTION','PULLBACK_EXHAUSTION')
            elif z['reentry']==side or z['continue']==side:transition(ts,'REENTRY','REACCELERATION_SIGNAL')
            continue
        if life=='REENTRY':
            if z['reverse']==-side:transition(ts,'REVERSAL','REENTRY_FAILED')
            elif z['continue']==side or z['bias']==side:transition(ts,'CORE','REENTRY_ACCEPTED')
            elif z['exhaust']==side:transition(ts,'EXHAUSTION','REENTRY_EXHAUSTED')
            continue
        if life=='EXHAUSTION':
            close(ts,i,'EXHAUSTION');transition(ts,'LOCKOUT','EXHAUSTION_EXIT');continue
        if life=='REVERSAL':
            if core_ts is not None and ts-core_ts>48*HOUR: failure['reversalLag']+=1
            if core_ts is not None: failure['wrongCoreOwnership']+=1
            close(ts,i,'STRUCTURAL_REVERSAL');transition(ts,'LOCKOUT','REVERSAL_EXIT');continue
    if size>0:
        last=max((int(r['ts']) for r in c if start<=int(r['ts'])<end),default=None)
        if last is not None:close(last,idx[pair][last],'PERIOD_END')
    return trades,transitions,failure

def metr(cid,candles,idx,period,cost,delay=0):
    tr,trans,fail=simulate(cid,candles,idx,period,cost,delay);m=engine.metric([x['pnl'] for x in tr])
    m.update({'avgHoldingHours':statistics.fmean([x['heldHours'] for x in tr]) if tr else 0,
      'medianExitGivebackPct':statistics.median([x['exitGivebackPct'] for x in tr]) if tr else 0,
      'falseStarts':fail['failedInitiation']+fail['failedAcceptance'],
      'falseStartRatePct':100*(fail['failedInitiation']+fail['failedAcceptance'])/len(tr) if tr else 0,
      'coreAcceptedTrades':sum(x['coreAccepted'] for x in tr),'failureTaxonomy':fail,
      'top5TradeContributionPct':(100*sum(sorted([x['pnl'] for x in tr],reverse=True)[:5])/sum(x['pnl'] for x in tr)) if tr and abs(sum(x['pnl'] for x in tr))>1e-9 else None,
      'lifecycleTransitions':len(trans)})
    return m,tr

def wave_diag(cid,candles,idx,period):
    pair=CANDS[cid][0];c=candles[pair];start,end=period;m,tr=metr(cid,candles,idx,period,NORMAL_BPS,0);waves=[];last_end=0
    for row in c:
        ts=int(row['ts']);i=idx[pair].get(ts)
        if not(start<=ts<end) or ts<last_end or i is None or i<336 or i+WAVE_H>=len(c):continue
        p0=float(c[i]['close']);vol=engine.p.vol(c,i,168);hs=[float(c[j]['high']) for j in range(i+1,i+WAVE_H+1)];ls=[float(c[j]['low']) for j in range(i+1,i+WAVE_H+1)]
        up=100*(max(hs)/p0-1);dn=100*(p0/min(ls)-1);thr=max(3.0,2.0*vol*math.sqrt(WAVE_H));mfe=max(up,dn)
        if mfe<thr:continue
        side=1 if up>=dn else -1;k=(hs.index(max(hs))+1) if side>0 else (ls.index(min(ls))+1);wend=int(c[i+k]['ts'])
        hit=next((x for x in tr if x['side']==side and ts<=x['entryTs']<=ts+WAVE_ENTRY_H*HOUR),None);cap=None;delayh=None
        if hit:
            delayh=(hit['entryTs']-ts)/HOUR;ei=idx[pair].get(hit['entryTs']);xi=idx[pair].get(min(hit['exitTs'],wend))
            if ei is not None and xi is not None and xi>=ei:
                ep=float(c[min(ei+1,len(c)-1)]['open']);xp=float(c[xi]['close']);real=max(0.,side*(xp/ep-1)*100);cap=min(100.,100*real/mfe) if mfe>0 else 0
        waves.append({'startTs':ts,'endTs':wend,'side':side,'mfePct':mfe,'captured':hit is not None,'delayHours':delayh,'mfeCapturedPct':cap});last_end=ts+WAVE_H*HOUR
    hit=[w for w in waves if w['captured']];caps=[w['mfeCapturedPct'] for w in hit if w['mfeCapturedPct'] is not None];delays=[w['delayHours'] for w in hit]
    return {'majorWaves':len(waves),'captured':len(hit),'captureRatePct':100*len(hit)/len(waves) if waves else 0,'medianEntryDelayHours':statistics.median(delays) if delays else None,'medianWaveMfeCapturedPct':statistics.median(caps) if caps else None,'missedWaves':len(waves)-len(hit),'falseStarts':m['falseStarts'],'falseStartRatePct':m['falseStartRatePct'],'averageHoldingHours':m['avgHoldingHours'],'exitGivebackPct':m['medianExitGivebackPct'],'top5TradeContributionPct':m['top5TradeContributionPct']}

def folds(cid,candles,idx,period):
    a,b=period;step=(b-a)//3;out=[]
    for k in range(3):
        x=a+k*step;y=b if k==2 else a+(k+1)*step;q,_=metr(cid,candles,idx,(x,y),NORMAL_BPS,0);out.append(q)
    return {'folds':out,'positivePfFolds':sum((x.get('pf') or 0)>1 for x in out),'positiveReturnFolds':sum(x.get('returnPct',0)>0 for x in out)}

def run(cid):
    candles,idx,_=v109.b.base.load();ps=v109.b.base.periods(candles)
    dm,_=metr(cid,candles,idx,ps['development'],NORMAL_BPS,0);vm,_=metr(cid,candles,idx,ps['validation'],NORMAL_BPS,0);vs,_=metr(cid,candles,idx,ps['validation'],STRESS_BPS,1)
    dw=wave_diag(cid,candles,idx,ps['development']);vw=wave_diag(cid,candles,idx,ps['validation']);df=folds(cid,candles,idx,ps['development']);vf=folds(cid,candles,idx,ps['validation'])
    adequate=dm.get('trades',0)>=8 and vm.get('trades',0)>=4;stable=df['positivePfFolds']>=2 and vf['positivePfFolds']>=2;broad=vw['captureRatePct']>=20 and (vw['medianWaveMfeCapturedPct'] or 0)>=20 and vw['falseStartRatePct']<=40
    promote=adequate and stable and broad and (dm.get('pf') or 0)>=1.2 and dm.get('returnPct',0)>0 and (vm.get('pf') or 0)>=1.2 and vm.get('returnPct',0)>0 and (vs.get('pf') or 0)>1 and vm.get('maxDDPct',-999)>-20
    res={'strategyId':'V133_'+cid.upper(),'pair':CANDS[cid][0],'periods':{'development':ps['development'],'validation':ps['validation'],'confirmation':'UNTOUCHED','holdout':'UNTOUCHED'},'development':dm,'validation':vm,'validationStress':vs,'waveDiagnostics':{'development':dw,'validation':vw},'walkForward':{'development':df,'validation':vf},'status':'FROZEN_SURVIVOR' if promote else 'FAIL','reason':'DEV_VALIDATION_GATE','architecture':'FULL_PERSISTENT_LIFECYCLE_V21','productionChanged':False,'realTradingEnabled':False}
    out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));out.mkdir(parents=True,exist_ok=True);stem='active4-v133-'+cid;txt=json.dumps(res,indent=2);(out/f'{stem}.json').write_text(txt);(out/f'{stem}.md').write_text('# '+res['strategyId']+'\n\n```json\n'+txt+'\n```\n');print(txt)
if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--candidate',choices=sorted(CANDS),required=True);run(ap.parse_args().candidate)
