from __future__ import annotations
import json, os, math
from pathlib import Path
import research_lab_pair_specific_v109 as v109
import research_pairwise_profit_attribution_v4 as v4

PAIRS=('SOL','LINK')
H=v109.HOUR
TOTAL_COST_BPS=v109.NORMAL_BPS
ONE_WAY_COST_FRAC=(TOTAL_COST_BPS/2.0)/10000.0


def build_schedules(candles,idx,ps):
    models={s:v109.train('regime_wave',s,candles,idx,*ps['development']) for s in PAIRS}
    schedules={}
    for s in PAIRS:
        arch='SOL_PROFIT_LOCK_REVALIDATE' if s=='SOL' else 'LINK_V2_STAGED_HANDOFF'
        _,recs=v4.simulate(s,arch,candles,idx,ps['fixedWindowStart'],ps['fixedWindowEndExclusive'],v109.NORMAL_BPS,0,models[s])
        for r in recs:
            sig_ts=int(r['entryTs'])-H
            pr=abs(v109.predict('regime_wave',s,candles,idx,sig_ts,models[s]))
            th=max(float(models[s]['threshold']),1e-9)
            r['entryStrength']=max(pr/th,1e-6)
        schedules[s]=recs
    return models,schedules


def active_trade(recs,ts):
    for r in recs:
        if int(r['entryTs']) <= ts < int(r['exitTs']):
            return r
    return None


def price_open(candles,idx,s,ts):
    i=idx[s].get(ts)
    if i is None:return None
    return float(candles[s][i]['open'])


def target_alloc(active,policy):
    names=[s for s in PAIRS if active.get(s)]
    if not names:return {s:0.0 for s in PAIRS}
    if len(names)==1:return {s:(1.0 if s==names[0] else 0.0) for s in PAIRS}
    if policy=='equal':return {'SOL':0.5,'LINK':0.5}
    strengths={s:max(float(active[s].get('entryStrength',1.0)),1e-9) for s in names}
    z=sum(strengths.values())
    return {s:(strengths[s]/z if s in strengths else 0.0) for s in PAIRS}


def run_policy(candles,idx,ps,schedules,policy):
    start=ps['fixedWindowStart'];end=ps['fixedWindowEndExclusive']
    ts_list=sorted(ts for ts in idx['SOL'] if start<=ts<end and ts in idx['LINK'])
    equity=1.0;peak=1.0;maxdd=0.0
    prev_eff={'SOL':0.0,'LINK':0.0}
    turnover=0.0;cost_paid=0.0
    only_sol=only_link=both=flat=0
    rebalances=0
    for k in range(len(ts_list)-1):
        ts=ts_list[k];tn=ts_list[k+1]
        active={s:active_trade(schedules[s],ts) for s in PAIRS}
        alloc=target_alloc(active,policy)
        if active['SOL'] and active['LINK']:both+=1
        elif active['SOL']:only_sol+=1
        elif active['LINK']:only_link+=1
        else:flat+=1
        eff={}
        for s in PAIRS:
            if active[s]:
                side=1.0 if str(active[s].get('side','LONG')).upper()=='LONG' else -1.0
                eff[s]=alloc[s]*v109.RISK[s]*side
            else:eff[s]=0.0
        turn=sum(abs(eff[s]-prev_eff[s]) for s in PAIRS)
        if turn>1e-12:
            c=turn*ONE_WAY_COST_FRAC
            equity*=max(0.0,1.0-c)
            turnover+=turn;cost_paid+=c;rebalances+=1
        gross=0.0
        for s in PAIRS:
            if abs(eff[s])<1e-15:continue
            p0=price_open(candles,idx,s,ts);p1=price_open(candles,idx,s,tn)
            if p0 is None or p1 is None or p0<=0:continue
            gross += eff[s]*(p1/p0-1.0)
        equity*=max(0.0,1.0+gross)
        peak=max(peak,equity);dd=(equity/peak-1.0)*100.0;maxdd=min(maxdd,dd)
        prev_eff=eff
    # close any remaining exposure at the end
    turn=sum(abs(prev_eff[s]) for s in PAIRS)
    if turn>1e-12:
        c=turn*ONE_WAY_COST_FRAC;equity*=max(0.0,1.0-c);turnover+=turn;cost_paid+=c;rebalances+=1
        peak=max(peak,equity);maxdd=min(maxdd,(equity/peak-1.0)*100.0)
    hrs=max(len(ts_list)-1,1)
    return {
        'policy':policy,
        'returnPct':(equity-1.0)*100.0,
        'maxDDPct':maxdd,
        'endingEquity':equity,
        'turnoverEffectiveExposure':turnover,
        'estimatedCostPctPoints':cost_paid*100.0,
        'rebalanceEvents':rebalances,
        'hours':hrs,
        'stateHours':{'SOL_ONLY':only_sol,'LINK_ONLY':only_link,'BOTH':both,'FLAT':flat},
        'statePct':{'SOL_ONLY':100*only_sol/hrs,'LINK_ONLY':100*only_link/hrs,'BOTH':100*both/hrs,'FLAT':100*flat/hrs},
    }


def run():
    candles,idx,_=v109.b.base.load();ps=v109.b.base.periods(candles)
    _,schedules=build_schedules(candles,idx,ps)
    equal=run_policy(candles,idx,ps,schedules,'equal')
    strength=run_policy(candles,idx,ps,schedules,'strength')
    out={
      'researchLine':'SOL_LINK_SHARED_ACCOUNT_V1',
      'window':{'start':ps['fixedWindowStart'],'endExclusive':ps['fixedWindowEndExclusive'],'hours':8760},
      'capitalModel':'ONE_SHARED_ACCOUNT_100PCT_DYNAMIC_REALLOCATION',
      'logic':{
        'SOL':'V109_BROAD_PLUS_V4_PROFIT_OWNER',
        'LINK':'V4_LINK_V2_STAGED_HANDOFF',
        'singleActive':'100pct account allocation to active pair, then strategy risk multiplier applies',
        'bothEqual':'50/50 account allocation, then pair risk multipliers apply',
        'bothStrength':'entry predictor strength normalized by frozen threshold, then pair risk multipliers apply',
        'afterExit':'remaining active pair returns to 100pct account allocation',
      },
      'costModel':{'roundTripEquivalentBps':TOTAL_COST_BPS,'oneWayTurnoverBps':TOTAL_COST_BPS/2.0,'rebalancingCostsIncluded':True},
      'equalConcurrent':equal,'strengthConcurrent':strength,
      'tradeCounts':{s:len(schedules[s]) for s in PAIRS},
      'btcRole':'REFERENCE_FEATURES_ONLY_NO_BTC_POSITION',
      'productionChanged':False,'realTradingEnabled':False,
    }
    root=Path(os.environ.get('RESEARCH_STATE_DIR','.research-state'));root.mkdir(parents=True,exist_ok=True)
    p=root/'sol-link-shared-account-v1.json';p.write_text(json.dumps(out,indent=2),encoding='utf-8');print(json.dumps(out,indent=2))

if __name__=='__main__':run()
