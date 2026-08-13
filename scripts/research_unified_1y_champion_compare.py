from __future__ import annotations
import json, os
from pathlib import Path
import research_lab_pair_specific_v109 as v109
import research_pairwise_profit_attribution_v4 as v4
import research_five_pair_champion_portfolio as five

NORMAL=v109.NORMAL_BPS
KIND='regime_wave'


def metric_events(events):
    events=sorted(events,key=lambda z:(int(z[0]),str(z[1])))
    vals=[float(z[2]) for z in events]
    m=v109.metric(vals)
    m['tradeEvents']=len(vals)
    m['sumPnlPctPoints']=sum(vals)
    return m


def v109_recs(pair,candles,idx,start,end,model):
    _,r=v109.pair_trades(KIND,pair,candles,idx,start,end,NORMAL,0,model)
    return r


def v4_recs(pair,arch,candles,idx,start,end,model):
    _,r=v4.simulate(pair,arch,candles,idx,start,end,NORMAL,0,model)
    return r


def sleeve_portfolio(recs_by_pair,weights):
    events=[]
    pair_metrics={}
    for pair,recs in recs_by_pair.items():
        w=float(weights[pair])
        vals=[]
        for r in recs:
            p=float(r['pnl'])*w
            vals.append(p)
            events.append((int(r['exitTs']),pair,p))
        pair_metrics[pair]=v109.metric(vals)
    m=metric_events(events)
    m['weights']=weights
    m['pairMetricsAtPortfolioWeight']=pair_metrics
    return m


def run():
    candles,idx,_=v109.b.base.load()
    ps=v109.b.base.periods(candles)
    start=int(ps['fixedWindowStart']); end=int(ps['fixedWindowEndExclusive'])
    models={p:v109.train(KIND,p,candles,idx,*ps['development']) for p in ('SOL','LINK','ETH','AVAX')}

    past_sol=v109_recs('SOL',candles,idx,start,end,models['SOL'])
    past_link=v109_recs('LINK',candles,idx,start,end,models['LINK'])
    cur_sol=v4_recs('SOL','SOL_PROFIT_LOCK_REVALIDATE',candles,idx,start,end,models['SOL'])
    cur_link=v4_recs('LINK','LINK_V2_STAGED_HANDOFF',candles,idx,start,end,models['LINK'])

    normalized={
      'pastSOL':sleeve_portfolio({'SOL':past_sol},{'SOL':1.0}),
      'currentSOL':sleeve_portfolio({'SOL':cur_sol},{'SOL':1.0}),
      'pastSOL_LINK':sleeve_portfolio({'SOL':past_sol,'LINK':past_link},{'SOL':0.5,'LINK':0.5}),
      'currentSOL_LINK':sleeve_portfolio({'SOL':cur_sol,'LINK':cur_link},{'SOL':0.5,'LINK':0.5}),
      'currentFivePair':five.portfolio(candles,idx,start,end,NORMAL,0,models),
    }
    # Also preserve the historical repository convention where pair PnLs were concatenated
    # without capital normalization. This is diagnostic only and is NOT the fair comparison ranking.
    legacy_additive={
      'pastSOL_LINK':sleeve_portfolio({'SOL':past_sol,'LINK':past_link},{'SOL':1.0,'LINK':1.0}),
      'currentSOL_LINK':sleeve_portfolio({'SOL':cur_sol,'LINK':cur_link},{'SOL':1.0,'LINK':1.0}),
    }
    out={
      'researchLine':'UNIFIED_ONE_YEAR_CHAMPION_COMPARE_V1',
      'window':{'start':start,'endExclusive':end,'hours':(end-start)//v109.HOUR},
      'costBps':NORMAL,'executionDelayBars':0,
      'trainingPeriod':ps['development'],
      'strategyMapping':{
        'pastSOL':'Frozen V109 regime_wave SOL',
        'currentSOL':'V109_BROAD_PLUS_V4_PROFIT_OWNER / SOL_PROFIT_LOCK_REVALIDATE',
        'pastSOL_LINK':'Frozen V109 regime_wave SOL + LINK',
        'currentSOL_LINK':'SOL V4 profit owner + LINK V4 staged handoff',
        'currentFivePair':five.CHAMPION,
      },
      'fairCapitalNormalized':normalized,
      'legacyAdditiveDiagnostic':legacy_additive,
      'notes':[
        'Fair comparison uses 100% for SOL-only, 50/50 fixed sleeves for SOL+LINK, and the existing five-pair fixed 20% sleeves including BNB cash.',
        'All variants use the exact same fixed one-year window, same normal cost, same zero-delay execution convention, and development-trained V109 regime-wave models.',
        'This requested comparison intentionally reads the full historical fixed window, including periods previously labeled confirmation/holdout; it must not be reused as untouched holdout evidence.'
      ],
      'productionChanged':False,'realTradingEnabled':False
    }
    root=Path(os.environ.get('RESEARCH_STATE_DIR','.research-state'));root.mkdir(parents=True,exist_ok=True)
    p=root/'unified-one-year-champion-compare-v1.json';p.write_text(json.dumps(out,indent=2),encoding='utf-8')
    print(json.dumps(out,indent=2))

if __name__=='__main__': run()
