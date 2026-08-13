from __future__ import annotations
import json,os
from pathlib import Path
import research_lab_pair_specific_v109 as v109
import research_pairwise_profit_attribution_v4 as v4

PAIRS=('SOL','LINK','ETH','BNB','AVAX')
WEIGHT={s:.20 for s in PAIRS}
CHAMPION={
 'SOL':'V109_BROAD_PLUS_V4_PROFIT_OWNER',
 'LINK':'V4_LINK_V2_STAGED_HANDOFF',
 'ETH':'V109_PRIMARY_ONLY',
 'BNB':'CASH_FIRST_NO_POSITION',
 'AVAX':'V109_PRIMARY_ONLY',
}

def recs_for(pair,candles,idx,start,end,cost,delay,models):
    if pair=='BNB': return []
    if pair=='SOL':
        _,r=v4.simulate('SOL','SOL_PROFIT_LOCK_REVALIDATE',candles,idx,start,end,cost,delay,models['SOL']);return r
    if pair=='LINK':
        _,r=v4.simulate('LINK','LINK_V2_STAGED_HANDOFF',candles,idx,start,end,cost,delay,models['LINK']);return r
    _,r=v109.pair_trades('regime_wave',pair,candles,idx,start,end,cost,delay,models[pair]);return r

def portfolio(candles,idx,start,end,cost,delay,models):
    events=[]; pair={}; contribution={}
    for s in PAIRS:
        rr=recs_for(s,candles,idx,start,end,cost,delay,models)
        vals=[]
        for r in rr:
            p=float(r['pnl'])*WEIGHT[s]
            vals.append(p);events.append((int(r['exitTs']),s,p))
        pair[s]=v109.metric(vals)
        contribution[s]=sum(vals)
    events.sort(key=lambda z:(z[0],z[1]))
    vals=[x[2] for x in events]
    m=v109.metric(vals)
    m['capitalModel']='FIXED_EQUAL_SLEEVES_20PCT_NO_LENDING'
    m['btcWeight']=0.0
    m['bnbCashWeight']=WEIGHT['BNB']
    m['investableTradingWeight']=sum(WEIGHT[s] for s in PAIRS if s!='BNB')
    m['pairContributionPctPoints']=contribution
    m['pairMetricsAtPortfolioWeight']=pair
    m['tradeEvents']=len(vals)
    return m

def run():
    candles,idx,_=v109.b.base.load();ps=v109.b.base.periods(candles)
    models={s:v109.train('regime_wave',s,candles,idx,*ps['development']) for s in ('SOL','LINK','ETH','AVAX')}
    dev=portfolio(candles,idx,*ps['development'],v109.NORMAL_BPS,0,models)
    val=portfolio(candles,idx,*ps['validation'],v109.NORMAL_BPS,0,models)
    stress=portfolio(candles,idx,*ps['validation'],v109.STRESS_BPS,1,models)
    out={
      'researchLine':'FIVE_PAIR_CHAMPION_PORTFOLIO_V1',
      'pairs':list(PAIRS),'weights':WEIGHT,'champions':CHAMPION,
      'btcRole':'REFERENCE_FEATURES_ONLY_WEIGHT_0_NO_POSITION',
      'bnbRole':'CASH_FIRST_FIXED_20PCT_SLEEVE_NO_LENDING',
      'selectionPolicy':'HISTORICAL_LINEAGE_CHAMPIONS_FIXED_BEFORE_THIS_PORTFOLIO_RUN',
      'portfolioAccounting':'capital-weighted trade PnL ordered by realized exit; fixed sleeves; no cross-sleeve lending',
      'confirmation':'UNTOUCHED','holdout':'UNTOUCHED','productionChanged':False,'realTradingEnabled':False,
      'development':dev,'validation':val,'validationStress':stress,
    }
    v=val;s=stress
    out['readout']={
      'validationReturnPct':v.get('returnPct'),'validationMaxDDPct':v.get('maxDDPct'),'validationPF':v.get('pf'),
      'stressReturnPct':s.get('returnPct'),'stressMaxDDPct':s.get('maxDDPct'),'stressPF':s.get('pf'),
      'returnToAbsDD':(v.get('returnPct')/abs(v.get('maxDDPct'))) if v.get('maxDDPct') not in (None,0) else None,
    }
    root=Path(os.environ.get('RESEARCH_STATE_DIR','.research-state'));root.mkdir(parents=True,exist_ok=True)
    p=root/'five-pair-champion-portfolio-v1.json';p.write_text(json.dumps(out,indent=2),encoding='utf-8');print(json.dumps(out,indent=2))

if __name__=='__main__':run()
