"""Re-run the five latest configurations with PENGU1 and/or HYPE.

Same archived Core candidates and original allocator. Retained research gaps
remain explicit; no re-labeling as complete LIVE execution equivalence.
"""
import argparse
import json
from collections import Counter
from pathlib import Path
import hashlib
from scripts.research.pengu1_hype_engine import load_extended_engine,hype_lifecycle
from scripts.research.formal_core_ownership_audit import rows
from scripts.research import run_formal_core_overlay_diagnostic as base

def build_hype_candidates(data,features,end):
    bars={int(r['event_time_ms']):r for r in rows(data/'normalized/aster/klines/HYPEUSDT.jsonl')}
    out=[];reason=Counter()
    for f in rows(features):
        s=f['signal'];reason[s['reason']]+=1
        if not f['sourceCurrent'] or not s['accepted']:continue
        ts=f['decisionTs'];entry=bars.get(ts)
        if not entry:reason['ENTRY_BAR_MISSING']+=1;continue
        life=hype_lifecycle(bars,ts,s['stopDistance'],s['trailingDistance'],end)
        price=float(entry['open'])
        # Source runner risk budget5%, buffers 2*4+20+2 bps, cap1.5.
        gross=min(1.5,.05/(s['stopDistance']/price+.003))
        out.append({'strategy_id':'HYPE_LONG','symbol':'HYPEUSDT','side':'LONG',
            'signal_ts_ms':s['signalTsMs'],'entry_ts_ms':ts,'entry_price':price,
            'requested_gross':gross,'route':'HYPE_TREND_LONG','rank':None,
            'source_runtime_sha':'123df49950e3d5aba61e2d50e9ee1a37fae620d7',
            'stop_distance':s['stopDistance'],'tp_distance':s['trailingDistance'],**life})
    return out,dict(reason)

def main():
    p=argparse.ArgumentParser();p.add_argument('--baseline-root',type=Path,required=True)
    p.add_argument('--candidate-root',type=Path,required=True);p.add_argument('--features',type=Path,required=True)
    p.add_argument('--hype-features',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    p.add_argument('--variants',nargs='+',default=['PENGU1_HYPE']);p.add_argument('--costs',nargs='+',type=int,default=[8,10,20,30])
    a=p.parse_args();data=a.baseline_root/'market-Aster-H1-funding-and-manifests'
    hype,coverage=build_hype_candidates(data,a.hype_features,1786406400000)
    a.output.mkdir(parents=True,exist_ok=True)
    (a.output/'hype-candidates.jsonl').write_text(''.join(json.dumps(r,sort_keys=True)+'\n' for r in hype))
    original_engine=base.load_ownership_engine;reports=[]
    for variant in a.variants:
        if variant not in {'PENGU1','HYPE','PENGU1_HYPE'}:raise ValueError('UNKNOWN_VARIANT')
        def engine():
            m=load_extended_engine(pengu_fixed=variant!='HYPE')
            if variant!='PENGU1':
                reader=m._rows
                m._rows=lambda path:reader(path)+hype if Path(path)==a.candidate_root/'crypto-price-model-candidates.jsonl' else reader(path)
            return m
        base.load_ownership_engine=engine
        result=base.run(data,a.candidate_root,a.baseline_root/'v52-SHA-verified-original-ledger',a.features,a.output/variant,tuple(a.costs))
        result['variant']=variant
        reports.append(result)
    base.load_ownership_engine=original_engine
    report={'scope':'DIAGNOSTIC_PRICE_MODEL_NOT_LIVE_CERTIFICATION','base_sha':'123df49950e3d5aba61e2d50e9ee1a37fae620d7',
        'hype_signal_coverage':coverage,'hype_candidate_count':len(hype),'reports':reports,
        'pengu_change':'SIZING_ONLY_FIXED_1.0_ALL_FROZEN_ROUTES_NO_SIGNAL_RETUNING',
        'hype_exit':'ACTUAL_SOURCE_FIXED_ATR_STOP2.5_TP3_NOT_MOVING_TRAIL',
        'hype_history_window':360,'hype_admission':'ONE_SLOT_FULL_REQUEST_OR_BLOCK_LOWEST_PRIORITY',
        'hype_capacity_preemption':'SOURCE_PLANNER_UP_TO_50PCT_PER_CORE_CAPACITY_REQUEST',
        'unproven':['inherited incomplete annual Overlay/current-H1 Core eligibility evidence',
                    'venue filters and available-margin history; pending and asynchronous execution',
                    'operator-enabled HYPE preemption and tick-level stop/fill ordering',
                    'PENGU uses the frozen baseline lifecycle stream; not a fresh all-hour COMBINED_FILTERED replay']}
    (a.output/'summary.json').write_text(json.dumps(report,indent=2,sort_keys=True)+'\n')
    for r in reports:
        for s in r['scenarios']:
            path=a.output/r['variant']/s['configuration']/s['scenario_id']/'portfolio-trades.jsonl'
            trades=rows(path)
            if r['variant']!='HYPE':assert all(abs(t['accepted_gross']-1.)<1e-9 for t in trades if t['strategy_id']=='PENGU')
            assert s['ownership_conflicts']==0
    print('RESEARCH_COMPARISON_COMPLETE',flush=True)

if __name__=='__main__':main()
