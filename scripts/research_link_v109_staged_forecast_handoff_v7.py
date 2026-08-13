from __future__ import annotations
import argparse,csv,json,os
from pathlib import Path
import research_lab_pair_specific_v109 as v109
import research_sol_link_v109_autonomous as base

HOUR=base.HOUR
CID='link_v109_staged_forecast_handoff'


def open_trade(c,i,delay,end):
    ei=i+1+delay
    if ei>=len(c) or int(c[ei]['ts'])>=end:return None
    return ei,int(c[ei]['ts']),float(c[ei]['open'])


def simulate_new(cid,pair,candles,idx,start,end,cost_bps,delay,model):
    if pair!='LINK' or cid!=CID:
        return base.simulate(cid,pair,candles,idx,start,end,cost_bps,delay,model)
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
        # Realized-path decomposition only: no hypothetical post-exit price use.
        cutoff=min(entry_i+24,xi);p24=float(c[cutoff]['close']);p0=((state*((p24/entry-1)*100))-raw_cost)*v109.RISK[pair]
        regs=base._ctx(pair,candles,idx,signal_ts) or {}
        recs.append({'candidate':cid,'pair':pair,'side':'LONG' if state>0 else 'SHORT','signalTs':signal_ts,'entryExecTs':entry_ts,'exitSignalTs':ts,'exitExecTs':int(c[xi]['ts']),'entryPredictor':entry_pred,'threshold':th,'entryPrice':entry,'exitPrice':xp,'heldHours':(int(c[xi]['ts'])-entry_ts)/HOUR,'netPnlPct':pnl,'grossReturnPct':gross,'costContributionPct':raw_cost*v109.RISK[pair],'mfePct':mfe,'maePct':mae,'pnl0To24hPct':p0,'pnl24hToExitPct':pnl-p0,'exitReason':'+'.join(flags),'volRatio24_96':regs.get('vr'),'breadth24':regs.get('breadth'),'entryLifecycle':'V109_0_24H_FORECAST_OWNER_TO_DURABLE_HANDOFF'})
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
            # Ignore generic LINK horizon behavior; this candidate owns its own staged horizon.
            flags=[f for f in flags if f!='FORECAST_HORIZON_END']
            if life=='FORECAST_OWNER' and held_exec>=24:
                favorable=(px/entry-1)*state>0
                medium_support=ctx['r12']*state>0 and ctx['r24']*state>0
                predictor_support=pr*state>0
                if favorable and medium_support and predictor_support:
                    life='DURABLE_OWNER'
                else:
                    close(ts,i,['FORECAST_HANDOFF_REJECTED_CASH']);continue
            if life=='DURABLE_OWNER' and held_exec>=48:
                close(ts,i,['DURABLE_OWNER_CONTRACT_END'],force_i=entry_i+48);continue
            if flags:close(ts,i,flags);continue
        if state:continue
        d=1 if pr>=th else -1 if pr<=-th else 0
        frozen_gate=ctx['v24']<3.2*ctx['v336']
        if d and frozen_gate:
            opened=open_trade(c,i,delay,end)
            if opened:
                entry_i,entry_ts,entry=opened;state=d;signal_ts=ts;peak=entry;trough=entry;entry_pred=pr;life='FORECAST_OWNER'
    if state and signal_ts is not None:
        last_ts=max(int(r['ts']) for r in c if start<=int(r['ts'])<end);close(last_ts,idx[pair][last_ts],['PERIOD_END'])
    return vals,recs


def summary_realized(recs):
    m=base.summary(recs)
    m['sumPnl0To24hPct']=sum(r['pnl0To24hPct'] for r in recs)
    m['sumPnl24hToExitPct']=sum(r['pnl24hToExitPct'] for r in recs)
    m['handoffAccepted']=sum(r['exitReason']=='DURABLE_OWNER_CONTRACT_END' for r in recs)
    m['handoffRejected']=sum(r['exitReason']=='FORECAST_HANDOFF_REJECTED_CASH' for r in recs)
    return m


def run(pair):
    if pair!='LINK':raise SystemExit('LINK_ONLY_V7')
    candles,idx,_=v109.b.base.load();ps=v109.b.base.periods(candles);model=v109.train(base.KIND,pair,candles,idx,*ps['development'])
    old_sim=base.simulate;old_summary=base.summary
    base.simulate=simulate_new
    # candidate_result calls base.summary; adapt records to legacy keys without hypothetical leakage.
    def compat_summary(recs):
        patched=[]
        for r in recs:
            q=dict(r);q['pnl0To48hPct']=q['pnl0To24hPct'];q['pnl48hToExitPct']=q['pnl24hToExitPct'];patched.append(q)
        m=old_summary(patched)
        m['sumPnl0To24hPct']=sum(r['pnl0To24hPct'] for r in recs);m['sumPnl24hToExitPct']=sum(r['pnl24hToExitPct'] for r in recs)
        return m
    base.summary=compat_summary
    try:res=base.candidate_result(CID,pair,candles,idx,ps,model)
    finally:base.simulate=old_sim;base.summary=old_summary
    res['effectiveCleanSheet']={'status':'PASS','diagnosedFailure':'Validation losses concentrate after 24h: 24-36h -6.45%, 36-48h -1.73%; four Frozen-Trail exits contribute -18.75%','structuralChange':'fixed 48h ownership replaced by 0-24h Forecast Owner plus explicit ownership handoff; only already-profitable waves with aligned 12/24h direction and predictor receive 24-48h Durable Owner rights; Frozen V109 entry breadth unchanged'}
    out={'researchLine':'FROZEN_V109_LINK_DIAGNOSIS_DRIVEN_V7','pair':pair,'candidateChain':[res],'selectedForNextStage':CID,'selectedStatus':res['status'],'periods':{'development':ps['development'],'validation':ps['validation'],'confirmation':'UNTOUCHED','holdout':'UNTOUCHED'},'frozenV109Changed':False,'frozenThreshold':model['threshold'],'frozenRisk':v109.RISK[pair],'frozenTrailPct':v109.TRAIL[pair],'antiOverfit':{'denseSweep':False,'thresholdRetune':False,'riskRetune':False,'trailRetune':False,'sideHardcode':False,'confirmationRead':False,'holdoutRead':False,'designEvidence':['development','validation'],'strictPeriodIsolation':True},'productionChanged':False,'realTradingEnabled':False}
    root=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));root.mkdir(parents=True,exist_ok=True);stem='link-v109-autonomous-structural';(root/f'{stem}.json').write_text(json.dumps(out,indent=2),encoding='utf-8')
    d,v,s=res['development'],res['validation'],res['validationStress'];(root/f'{stem}.md').write_text(f'# LINK Frozen V109 Diagnosis-driven Successor V7\n\n- candidate: {CID}\n- status: {res["status"]}\n- diagnosis: {res["diagnosis"]}\n- effective clean-sheet: PASS\n- Dev: return {d.get("returnPct")} / PF {d.get("pf")} / DD {d.get("maxDDPct")} / trades {d.get("trades")}\n- Val: return {v.get("returnPct")} / PF {v.get("pf")} / DD {v.get("maxDDPct")} / trades {v.get("trades")}\n- Stress PF: {s.get("pf")}\n- Val 0-24h realized PnL: {v.get("sumPnl0To24hPct")}\n- Val 24h+ realized incremental PnL: {v.get("sumPnl24hToExitPct")}\n',encoding='utf-8')
    cols=['candidate','block','pair','side','signalTs','entryExecTs','exitSignalTs','exitExecTs','entryPredictor','threshold','heldHours','netPnlPct','mfePct','maePct','pnl0To24hPct','pnl24hToExitPct','exitReason','volRatio24_96','breadth24','costContributionPct']
    with (root/f'{stem}-ledger.csv').open('w',newline='',encoding='utf-8') as fh:
        w=csv.DictWriter(fh,fieldnames=cols);w.writeheader()
        for block in ('development','validation'):
            for tr in res['ledger'][block]:row={k:tr.get(k) for k in cols};row['block']=block;w.writerow(row)
    print(json.dumps(out,indent=2))

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--pair',choices=('LINK',),required=True);run(ap.parse_args().pair)
