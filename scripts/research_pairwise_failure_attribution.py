"""Pairwise failure attribution for the completed 3Y clean-sheet research.

Instrumentation only. The diagnostic family per pair is frozen from the already
completed Pairwise Clean Sheet 3Y artifact before this script is run:
SOL=PULLBACK_REACCEL, LINK=TREND_PERSISTENCE, ETH=EXHAUSTION_REVERSAL,
BNB=EXHAUSTION_REVERSAL, AVAX=COMPRESSION_EXPANSION.

For each non-overlapping year, replay the frozen family in Normal conditions and
attribute losses into:
- ENTRY_NO_EXCURSION: losing trade whose MFE never reached +0.5% (entry had little
  favorable excursion to capture), versus
- EDGE_NOT_CAPTURED: losing trade whose MFE reached at least +0.5% (entry produced
  tradable favorable excursion but lifecycle/execution failed to retain it).

Also report winner/loser MAE/MFE/holding time, Long/Short metrics, exit-reason metrics,
and entry-context medians for the frozen causal context fields already computed by
research_pairwise_clean_sheet_3y._ctx. No thresholds are searched or changed.
No Fresh OOS, VPS, LIVE, orders, deployment, or production mutation.
"""
from __future__ import annotations
import json, os, statistics
from collections import defaultdict
from pathlib import Path
from typing import Any

import research_pairwise_clean_sheet_3y as pair
import research_lab_pair_specific_v109 as v109
import research_priority_router_v6_historical_robustness as hist

FAMILY={
    'SOL':'PULLBACK_REACCEL',
    'LINK':'TREND_PERSISTENCE',
    'ETH':'EXHAUSTION_REVERSAL',
    'BNB':'EXHAUSTION_REVERSAL',
    'AVAX':'COMPRESSION_EXPANSION',
}
PERIODS={
    'development':pair.PERIODS['development'],
    'validation':pair.PERIODS['validation'],
    'evaluation':pair.PERIODS['evaluation'],
}
CTX_FIELDS=('z3','z6','z12','z24','z72','z168','vr','breadth','eff','rp','rel24','rel72','btcZ72','rr12','rr48')
MFE_ENTRY_EDGE_FLOOR_PCT=0.5

def pf(vals):
    g=sum(x for x in vals if x>0);l=abs(sum(x for x in vals if x<0))
    return g/l if l>1e-12 else (999.0 if g>0 else None)

def med(vals):return statistics.median(vals) if vals else None

def basic(recs):
    vals=[float(r['netReturnPct']) for r in recs]
    return {
        'trades':len(recs),'returnPctPoints':sum(vals),'pf':pf(vals),
        'winRatePct':100*sum(x>0 for x in vals)/len(vals) if vals else 0.0,
        'medianTradePct':med(vals),
        'medianMfePct':med([float(r['mfePct']) for r in recs]),
        'medianMaePct':med([float(r['maePct']) for r in recs]),
        'medianHoldHours':med([(int(r['exitTs'])-int(r['entryTs']))/pair.HOUR for r in recs]),
    }

def context_summary(recs,candles,index):
    out={}
    for name,subset in [('winners',[r for r in recs if float(r['netReturnPct'])>0]),('losers',[r for r in recs if float(r['netReturnPct'])<=0])]:
        values=defaultdict(list)
        for r in subset:
            x=pair._ctx(r['symbol'],candles,index,int(r['signalTs']))
            if not x:continue
            for f in CTX_FIELDS:values[f].append(float(x[f]))
        out[name]={'count':len(subset),'median':{f:med(values[f]) for f in CTX_FIELDS}}
    return out

def loss_attribution(recs):
    losers=[r for r in recs if float(r['netReturnPct'])<=0]
    no=[r for r in losers if float(r['mfePct'])<MFE_ENTRY_EDGE_FLOOR_PCT]
    capture=[r for r in losers if float(r['mfePct'])>=MFE_ENTRY_EDGE_FLOOR_PCT]
    def bucket(rs):
        if not rs:return {'trades':0,'lossPctPoints':0.0,'medianMfePct':None,'medianMaePct':None,'medianHoldHours':None,'medianGivebackPct':None}
        return {
            'trades':len(rs),'lossPctPoints':sum(float(r['netReturnPct']) for r in rs),
            'medianMfePct':med([float(r['mfePct']) for r in rs]),
            'medianMaePct':med([float(r['maePct']) for r in rs]),
            'medianHoldHours':med([(int(r['exitTs'])-int(r['entryTs']))/pair.HOUR for r in rs]),
            'medianGivebackPct':med([float(r['mfePct'])-float(r['grossReturnPct']) for r in rs]),
        }
    return {
        'mfeEntryEdgeFloorPct':MFE_ENTRY_EDGE_FLOOR_PCT,
        'ENTRY_NO_EXCURSION':bucket(no),
        'EDGE_NOT_CAPTURED':bucket(capture),
        'lossTradeSharePct':{
            'entryNoExcursion':100*len(no)/len(losers) if losers else 0.0,
            'edgeNotCaptured':100*len(capture)/len(losers) if losers else 0.0,
        },
    }

def grouped(recs,keyfn):
    g=defaultdict(list)
    for r in recs:g[keyfn(r)].append(r)
    return {k:basic(v) for k,v in sorted(g.items())}

def diagnose_symbol(symbol,family,candles,index):
    out={}
    for label,(start,end) in PERIODS.items():
        _,recs=pair.simulate(symbol,family,candles,index,start,end,pair.NORMAL_BPS,0)
        out[label]={
            'summary':basic(recs),
            'lossAttribution':loss_attribution(recs),
            'side':grouped(recs,lambda r:r['side']),
            'exitReason':grouped(recs,lambda r:r['exitReason']),
            'entryContext':context_summary(recs,candles,index),
        }
    return out

def main():
    candles,index,_=v109.b.base.load()
    if pair.END_2026>hist.DATA_END:raise RuntimeError('HISTORICAL_BOUNDARY_EXCEEDS_FROZEN_DATA')
    symbols={s:{'diagnosticFamily':FAMILY[s],'periods':diagnose_symbol(s,FAMILY[s],candles,index)} for s in pair.TRADE_SYMBOLS}
    out={
        'researchLine':'PAIRWISE_FAILURE_ATTRIBUTION',
        'researchOnly':True,'instrumentationOnly':True,'strategyChanged':False,
        'familiesFrozenBeforeResults':FAMILY,
        'mfeEntryEdgeFloorPct':MFE_ENTRY_EDGE_FLOOR_PCT,
        'productionChanged':False,'vpsChanged':False,'liveChanged':False,'realTradingEnabled':False,
        'freshOosRead':False,'post20260701DataUsed':False,
        'symbols':symbols,
        'nextAction':'REBUILD_EACH_PAIR_FROM_DOMINANT_CAUSAL_FAILURE_NOT_FROM_OLD_SIGNAL',
    }
    root=Path(os.environ.get('RESEARCH_STATE_DIR','.research-state'));root.mkdir(parents=True,exist_ok=True)
    path=root/'pairwise-failure-attribution.json';path.write_text(json.dumps(out,indent=2,sort_keys=True),encoding='utf-8');print(json.dumps(out,indent=2,sort_keys=True))
if __name__=='__main__':main()
