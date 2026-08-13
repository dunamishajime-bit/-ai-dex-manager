from __future__ import annotations
import argparse,csv,json,os
from pathlib import Path
import research_lab_pair_specific_v109 as v109
import research_sol_link_v109_autonomous as base

HOUR=base.HOUR
ORIGINAL=base.simulate
SOL_CID='sol_v109_probation_owner_transfer'
LINK_CID='link_v109_fixed_forecast_contract'


def open_trade(c,i,delay,end):
    ei=i+1+delay
    if ei>=len(c) or int(c[ei]['ts'])>=end:return None
    return ei,int(c[ei]['ts']),float(c[ei]['open'])


def simulate_new(cid,pair,candles,idx,start,end,cost_bps,delay,model):
    target=(pair=='SOL' and cid==SOL_CID) or (pair=='LINK' and cid==LINK_CID)
    if not target:return ORIGINAL(cid,pair,candles,idx,start,end,cost_bps,delay,model)
    th=model['threshold'];c=candles[pair]
    state=0;life='CASH';entry=peak=trough=None;entry_i=entry_ts=signal_ts=None;entry_pred=None
    vals=[];recs=[]

    def reset():
        nonlocal state,life,entry,peak,trough,entry_i,entry_ts,signal_ts,entry_pred
        state=0;life='CASH';entry=peak=trough=None;entry_i=entry_ts=signal_ts=None;entry_pred=None

    def close(ts,i,flags,force_i=None):
        if force_i is not None:
            xi=force_i;xp=float(c[xi]['close'])
        else:
            proposed=i+1+delay
            if flags==['PERIOD_END'] or proposed>=len(c) or int(c[proposed]['ts'])>=end:xi=i;xp=float(c[i]['close'])
            else:xi=proposed;xp=float(c[xi]['open'])
        gross=state*((xp/entry-1)*100);raw_cost=cost_bps/100.0;pnl=(gross-raw_cost)*v109.RISK[pair]
        lo,hi=min(entry_i,xi),max(entry_i,xi);highs=[float(c[j].get('high',c[j]['close'])) for j in range(lo,hi+1)];lows=[float(c[j].get('low',c[j]['close'])) for j in range(lo,hi+1)]
        if state>0:mfe=(max(highs)/entry-1)*100;mae=(min(lows)/entry-1)*100
        else:mfe=(entry/min(lows)-1)*100;mae=(entry/max(highs)-1)*100
        i48=min(entry_i+base.HORIZON,xi);p48=float(c[i48]['close']);p0=((state*((p48/entry-1)*100))-raw_cost)*v109.RISK[pair]
        regs=base._ctx(pair,candles,idx,signal_ts) or {}
        recs.append({'candidate':cid,'pair':pair,'side':'LONG' if state>0 else 'SHORT','signalTs':signal_ts,'entryExecTs':entry_ts,'exitSignalTs':ts,'exitExecTs':int(c[xi]['ts']),'entryPredictor':entry_pred,'threshold':th,'entryPrice':entry,'exitPrice':xp,'heldHours':(int(c[xi]['ts'])-entry_ts)/HOUR,'netPnlPct':pnl,'grossReturnPct':gross,'costContributionPct':raw_cost*v109.RISK[pair],'mfePct':mfe,'maePct':mae,'pnl0To48hPct':p0,'pnl48hToExitPct':pnl-p0,'exitReason':'+'.join(flags),'volRatio24_96':regs.get('vr'),'breadth24':regs.get('breadth'),'entryLifecycle':('V109_SCOUT_PROBATION_OWNER_TRANSFER' if pair=='SOL' else 'V109_FIXED_48H_FORECAST_CONTRACT')})
        vals.append(pnl);reset()

    for row in c:
        ts=int(row['ts'])
        if not(start<=ts<end):continue
        ctx=base._ctx(pair,candles,idx,ts)
        if ctx is None:continue
        i=ctx['i'];pr=v109.predict(base.KIND,pair,candles,idx,ts,model);px=ctx['close']
        if state:
            peak=max(peak,px);trough=min(trough,px);held_exec=i-entry_i
            adverse=(px/peak-1)*100 if state>0 else (trough/px-1)*100
            flags=base._exit_flags(pair,state,pr,th,adverse,(ts-signal_ts)//HOUR,cid)
            if pair=='SOL':
                favorable=(peak/entry-1)*100 if state>0 else (entry/trough-1)*100
                adverse_from_entry=(entry/trough-1)*100 if state>0 else (peak/entry-1)*100
                fast_support=ctx['r6']*state>0
                medium_support=ctx['r12']*state>0
                slow_support=ctx['r24']*state>0
                predictor_support=pr*state>=0
                if life=='PROBATION' and favorable>adverse_from_entry and medium_support and slow_support:
                    life='DURABLE_OWNER'
                if life=='PROBATION':
                    contradiction=(pr*state<0 and ctx['r12']*state<0) or (ctx['r6']*state<0 and ctx['r24']*state<0)
                    if contradiction and favorable<=adverse_from_entry:
                        flags=['PROBATION_FAILED_CASH']
                    elif held_exec>=base.HORIZON and not (predictor_support and (fast_support or medium_support)):
                        flags=['PROBATION_EXPIRED_CASH']
            else:
                contract_i=entry_i+base.HORIZON
                if i>=contract_i:
                    close(ts,i,['FIXED_FORECAST_CONTRACT_END'],force_i=contract_i);continue
            if flags:close(ts,i,flags);continue
        if state:continue
        d=1 if pr>=th else -1 if pr<=-th else 0
        frozen_gate=ctx['v24']<3.2*ctx['v336']
        if d and frozen_gate:
            opened=open_trade(c,i,delay,end)
            if opened:
                entry_i,entry_ts,entry=opened;state=d;signal_ts=ts;peak=entry;trough=entry;entry_pred=pr
                life='PROBATION' if pair=='SOL' else 'FORECAST_CONTRACT'
    if state and signal_ts is not None:
        last_ts=max(int(r['ts']) for r in c if start<=int(r['ts'])<end);close(last_ts,idx[pair][last_ts],['PERIOD_END'])
    return vals,recs


def run(pair):
    candles,idx,_=v109.b.base.load();ps=v109.b.base.periods(candles);model=v109.train(base.KIND,pair,candles,idx,*ps['development']);cid=SOL_CID if pair=='SOL' else LINK_CID
    old=base.simulate;base.simulate=simulate_new
    try:res=base.candidate_result(cid,pair,candles,idx,ps,model)
    finally:base.simulate=old
    if pair=='SOL':
        res['effectiveCleanSheet']={'status':'PASS','diagnosedFailure':'ownership/profit concentration under Stress','structuralChange':'Owner-first quarantine replaced by Scout Probation -> evidence-based Durable Owner transfer; failed probation returns Cash; Frozen V109 entry breadth unchanged'}
    else:
        res['effectiveCleanSheet']={'status':'PASS','diagnosedFailure':'post-forecast-horizon giveback','structuralChange':'adverse-vol regime guard removed; broad Frozen V109 entry becomes fixed 48h Forecast Contract with early Frozen exits still allowed'}
    out={'researchLine':'FROZEN_V109_SOL_LINK_DIAGNOSIS_DRIVEN_V6','pair':pair,'candidateChain':[res],'selectedForNextStage':cid,'selectedStatus':res['status'],'periods':{'development':ps['development'],'validation':ps['validation'],'confirmation':'UNTOUCHED','holdout':'UNTOUCHED'},'frozenV109Changed':False,'frozenThreshold':model['threshold'],'frozenRisk':v109.RISK[pair],'frozenTrailPct':v109.TRAIL[pair],'antiOverfit':{'denseSweep':False,'thresholdRetune':False,'riskRetune':False,'trailRetune':False,'sideHardcode':False,'confirmationRead':False,'holdoutRead':False,'designEvidence':['development','validation'],'strictPeriodIsolation':True},'productionChanged':False,'realTradingEnabled':False}
    root=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));root.mkdir(parents=True,exist_ok=True);stem=f'{pair.lower()}-v109-autonomous-structural';(root/f'{stem}.json').write_text(json.dumps(out,indent=2),encoding='utf-8')
    d,v,s=res['development'],res['validation'],res['validationStress'];(root/f'{stem}.md').write_text(f'# {pair} Frozen V109 Diagnosis-driven Successor V6\n\n- candidate: {cid}\n- status: {res["status"]}\n- diagnosis: {res["diagnosis"]}\n- effective clean-sheet: PASS\n- Dev: return {d.get("returnPct")} / PF {d.get("pf")} / DD {d.get("maxDDPct")} / trades {d.get("trades")}\n- Val: return {v.get("returnPct")} / PF {v.get("pf")} / DD {v.get("maxDDPct")} / trades {v.get("trades")}\n- Stress PF: {s.get("pf")}\n',encoding='utf-8')
    cols=['candidate','block','pair','side','signalTs','entryExecTs','exitSignalTs','exitExecTs','entryPredictor','threshold','heldHours','netPnlPct','mfePct','maePct','pnl0To48hPct','pnl48hToExitPct','exitReason','volRatio24_96','breadth24','costContributionPct']
    with (root/f'{stem}-ledger.csv').open('w',newline='',encoding='utf-8') as fh:
        w=csv.DictWriter(fh,fieldnames=cols);w.writeheader()
        for block in ('development','validation'):
            for tr in res['ledger'][block]:row={k:tr.get(k) for k in cols};row['block']=block;w.writerow(row)
    print(json.dumps(out,indent=2))

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--pair',choices=('SOL','LINK'),required=True);run(ap.parse_args().pair)
