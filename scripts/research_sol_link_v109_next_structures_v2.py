from __future__ import annotations
import argparse,csv,json,os
from pathlib import Path
import research_lab_pair_specific_v109 as v109
import research_sol_link_v109_autonomous as base

HOUR=base.HOUR
ORIGINAL=base.simulate
SOL_CID='sol_wrong_wave_acceptance_watch'
LINK_CID='link_vol_sponsor_handshake_owner'

def open_trade(c,i,delay,end):
    ei=i+1+delay
    if ei>=len(c) or int(c[ei]['ts'])>=end:return None
    return ei,int(c[ei]['ts']),float(c[ei]['open'])

def simulate_new(cid,pair,candles,idx,start,end,cost_bps,delay,model):
    target = (pair=='SOL' and cid==SOL_CID) or (pair=='LINK' and cid==LINK_CID)
    if not target:return ORIGINAL(cid,pair,candles,idx,start,end,cost_bps,delay,model)
    th=model['threshold'];c=candles[pair];state=0;life='CASH';side=0;mark_ts=None;watch_ts=None;rearm=True
    entry=peak=trough=None;entry_i=entry_ts=signal_ts=None;entry_pred=None;vals=[];recs=[];prev_ctx=None
    def reset():
        nonlocal state,life,side,mark_ts,watch_ts,entry,peak,trough,entry_i,entry_ts,signal_ts,entry_pred
        state=0;life='CASH';side=0;mark_ts=None;watch_ts=None;entry=peak=trough=None;entry_i=entry_ts=signal_ts=None;entry_pred=None
    def close(ts,i,flags):
        nonlocal rearm
        proposed=i+1+delay
        if flags==['PERIOD_END'] or proposed>=len(c) or int(c[proposed]['ts'])>=end:xi=i;xp=float(c[i]['close'])
        else:xi=proposed;xp=float(c[xi]['open'])
        gross=state*((xp/entry-1)*100);raw_cost=cost_bps/100.0;pnl=(gross-raw_cost)*v109.RISK[pair]
        lo,hi=min(entry_i,xi),max(entry_i,xi);highs=[float(c[j].get('high',c[j]['close'])) for j in range(lo,hi+1)];lows=[float(c[j].get('low',c[j]['close'])) for j in range(lo,hi+1)]
        if state>0:mfe=(max(highs)/entry-1)*100;mae=(min(lows)/entry-1)*100
        else:mfe=(entry/min(lows)-1)*100;mae=(entry/max(highs)-1)*100
        i48=min(entry_i+base.HORIZON,xi);p48=float(c[i48]['close']);p0=((state*((p48/entry-1)*100))-raw_cost)*v109.RISK[pair]
        regs=base._ctx(pair,candles,idx,signal_ts) or {}
        recs.append({'candidate':cid,'pair':pair,'side':'LONG' if state>0 else 'SHORT','signalTs':signal_ts,'entryExecTs':entry_ts,'exitSignalTs':ts,'exitExecTs':int(c[xi]['ts']),'entryPredictor':entry_pred,'threshold':th,'entryPrice':entry,'exitPrice':xp,'heldHours':(ts-signal_ts)/HOUR,'netPnlPct':pnl,'grossReturnPct':gross,'costContributionPct':raw_cost*v109.RISK[pair],'mfePct':mfe,'maePct':mae,'pnl0To48hPct':p0,'pnl48hToExitPct':pnl-p0,'exitReason':'+'.join(flags),'volRatio24_96':regs.get('vr'),'breadth24':regs.get('breadth'),'entryLifecycle':('LATCHED_SHADOW_ACCEPTANCE_WATCH' if pair=='SOL' else 'VOL_REQUALIFICATION_SPONSOR_HANDSHAKE_48H_OWNER')})
        vals.append(pnl);rearm=False if pair=='LINK' else rearm;reset()
    for row in c:
        ts=int(row['ts'])
        if not(start<=ts<end):continue
        ctx=base._ctx(pair,candles,idx,ts)
        if ctx is None:continue
        i=ctx['i'];pr=v109.predict(base.KIND,pair,candles,idx,ts,model);px=ctx['close']
        if pair=='LINK' and state==0 and life=='CASH' and not rearm and ctx['vr']<1.0:rearm=True
        if state:
            peak=max(peak,px);trough=min(trough,px);held=(ts-signal_ts)//HOUR;adverse=(px/peak-1)*100 if state>0 else (trough/px-1)*100
            flags=base._exit_flags(pair,state,pr,th,adverse,held,cid)
            if flags:close(ts,i,flags);prev_ctx=ctx;continue
        d=1 if pr>=th else -1 if pr<=-th else 0;frozen_gate=ctx['v24']<3.2*ctx['v336']
        if pair=='SOL':
            if life=='CASH' and d and frozen_gate:side=d;mark_ts=ts;life='LATCHED_SHADOW';continue
            if life=='LATCHED_SHADOW':
                elapsed=(ts-mark_ts)//HOUR;pred_against=pr*side<0;medium_against=ctx['r12']*side<0;slow_against=ctx['r24']*side<0;fast_support=ctx['r3']*side>0 and ctx['r6']*side>0
                if slow_against and (medium_against or pred_against):reset();continue
                if elapsed>=2 and fast_support and ctx['r12']*side>=0 and ctx['r24']*side>=0:life='ACCEPTANCE_WATCH';watch_ts=ts;continue
                if elapsed>12:reset();continue
            elif life=='ACCEPTANCE_WATCH':
                pred_against=pr*side<0;medium_against=ctx['r12']*side<0;slow_against=ctx['r24']*side<0;fast_support=ctx['r3']*side>0 and ctx['r6']*side>0
                if (pred_against and medium_against) or slow_against:reset();continue
                if fast_support and ctx['r12']*side>=0:
                    opened=open_trade(c,i,delay,end)
                    if opened:entry_i,entry_ts,entry=opened;state=side;signal_ts=ts;peak=entry;trough=entry;entry_pred=pr;life='CORE'
                    continue
                if (ts-watch_ts)//HOUR>3:life='LATCHED_SHADOW'
        else:
            fresh=prev_ctx is not None and prev_ctx['vr']<1.0 and ctx['vr']>=1.0
            if life=='CASH' and rearm and fresh and d and frozen_gate:side=d;mark_ts=ts;life='VOL_PROBE';prev_ctx=ctx;continue
            if life=='VOL_PROBE':
                elapsed=(ts-mark_ts)//HOUR;pred_reject=pr*side<0;fast_support=ctx['r3']*side>0 and ctx['r6']*side>0;medium_ok=ctx['r12']*side>=0
                breadth_dir=1 if ctx['breadth']>.5 else -1 if ctx['breadth']<.5 else 0;sponsor=(breadth_dir==side)
                if pred_reject or ctx['vr']<1.0:reset();rearm=ctx['vr']<1.0
                elif elapsed>=1 and fast_support and medium_ok and sponsor:
                    opened=open_trade(c,i,delay,end)
                    if opened:entry_i,entry_ts,entry=opened;state=side;signal_ts=ts;peak=entry;trough=entry;entry_pred=pr;life='FORECAST_OWNER';rearm=False
                elif elapsed>12:reset();rearm=False
        prev_ctx=ctx
    if state and signal_ts is not None:
        last_ts=max(int(r['ts']) for r in c if start<=int(r['ts'])<end);close(last_ts,idx[pair][last_ts],['PERIOD_END'])
    return vals,recs

def run(pair):
    candles,idx,_=v109.b.base.load();ps=v109.b.base.periods(candles);model=v109.train(base.KIND,pair,candles,idx,*ps['development']);cid=SOL_CID if pair=='SOL' else LINK_CID
    old=base.simulate;base.simulate=simulate_new
    try:res=base.candidate_result(cid,pair,candles,idx,ps,model)
    finally:base.simulate=old
    out={'researchLine':'FROZEN_V109_SOL_LINK_NEXT_STRUCTURAL_V2','pair':pair,'candidateChain':[res],'selectedForNextStage':cid,'selectedStatus':res['status'],'nextCandidateGeneration':None if res['status']=='FROZEN_SURVIVOR' else {'sourceDiagnosis':res['diagnosis'],'policy':'NEXT_RUN_NEW_STRUCTURAL_MECHANISM_ONLY_NO_NUMERIC_RETUNE','structuralDirection':('wrong-wave acceptance-watch/rejection mechanism only' if pair=='SOL' else 'volatility-aware Cash plus breadth sponsor handshake and 48h ownership only')},'periods':{'development':ps['development'],'validation':ps['validation'],'confirmation':'UNTOUCHED','holdout':'UNTOUCHED'},'frozenV109Changed':False,'frozenThreshold':model['threshold'],'frozenRisk':v109.RISK[pair],'frozenTrailPct':v109.TRAIL[pair],'researchMultiplicity':{'evaluatedThisRun':1,'priorCatalog':7 if pair=='SOL' else 5,'cumulative':8 if pair=='SOL' else 6},'antiOverfit':{'denseSweep':False,'thresholdRetune':False,'riskRetune':False,'trailRetune':False,'sideHardcode':False,'confirmationRead':False,'holdoutRead':False,'designEvidence':['development','validation'],'strictPeriodIsolation':True},'productionChanged':False,'realTradingEnabled':False}
    root=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));root.mkdir(parents=True,exist_ok=True);stem=f'{pair.lower()}-v109-autonomous-structural';(root/f'{stem}.json').write_text(json.dumps(out,indent=2),encoding='utf-8')
    d,v,s=res['development'],res['validation'],res['validationStress'];(root/f'{stem}.md').write_text(f'# {pair} Frozen V109 Structural Successor V2\n\n- candidate: {cid}\n- status: {res["status"]}\n- diagnosis: {res["diagnosis"]}\n- Dev: return {d.get("returnPct")} / PF {d.get("pf")} / DD {d.get("maxDDPct")} / trades {d.get("trades")}\n- Val: return {v.get("returnPct")} / PF {v.get("pf")} / DD {v.get("maxDDPct")} / trades {v.get("trades")}\n- Stress PF: {s.get("pf")}\n',encoding='utf-8')
    cols=['candidate','block','pair','side','signalTs','entryExecTs','exitSignalTs','exitExecTs','entryPredictor','threshold','heldHours','netPnlPct','mfePct','maePct','pnl0To48hPct','pnl48hToExitPct','exitReason','volRatio24_96','breadth24','costContributionPct']
    with (root/f'{stem}-ledger.csv').open('w',newline='',encoding='utf-8') as fh:
        w=csv.DictWriter(fh,fieldnames=cols);w.writeheader()
        for block in ('development','validation'):
            for tr in res['ledger'][block]:row={k:tr.get(k) for k in cols};row['block']=block;w.writerow(row)
    print(json.dumps(out,indent=2))
if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--pair',choices=('SOL','LINK'),required=True);run(ap.parse_args().pair)
